import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppendSession, AssistantToolCalls, IsCompactNotice, LoadSession, UserImages } from './session.js';

const DEFAULT_PROMPT = path.join(import.meta.dirname, 'templates', 'compact_prompt.txt');
const SUMMARY_MAX = 16384;

const META_MARKERS = [
	'okay, let\'s tackle',
	'the user wants a compaction summary',
	'write the compaction summary',
	'output only the summary text'
];

export function IsSummaryMessage(msg) {
	return !!(msg && msg._loci_summary);
}

export function FindLastCompactNotice(messages) {
	let idx = -1;
	let notice = null;
	for (let i = 0; i < (messages || []).length; i++) {
		if (IsCompactNotice(messages[i])) {
			idx = i;
			notice = messages[i];
		}
	}
	return { idx, notice };
}

/**
 * Index of the last real user message (not a compact notice or synthetic summary).
 * @param {object[]} messages
 */
export function FindKeepTailStart(messages) {
	const msgs = messages || [];
	let last = -1;
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i];
		if (!m || IsCompactNotice(m) || IsSummaryMessage(m)) continue;
		if (m.role === 'user') last = i;
	}
	if (last < 0) return msgs.length;
	return last;
}

/**
 * Keep-tail start from the last compact notice (0 when none — full session on the wire).
 * @param {object[]} messages
 */
export function DeriveKeepStart(messages) {
	const raw = messages || [];
	const { idx, notice } = FindLastCompactNotice(raw);
	if (idx < 0) return 0;
	if (notice && notice.keep_back != null) {
		const n = Number(notice.keep_back);
		if (Number.isFinite(n)) return Math.max(0, idx - n);
	}
	if (idx === 0) return Math.min(1, raw.length);
	return FindKeepTailStart(raw.slice(0, idx));
}

function CompactCount(notice) {
	const n = Number(notice && notice.compact_count);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Model-facing session: optional summary user + keep-tail. Notices stay in the file.
 * @param {object[]} raw
 */
export function BuildWireSession(raw) {
	const rows = raw || [];
	const until = DeriveKeepStart(rows);
	const { notice } = FindLastCompactNotice(rows);
	const summary = notice ? String(notice.content || '') : '';
	const count = CompactCount(notice) || (summary ? 1 : 0);
	const out = [];
	if (summary) {
		out.push({
			role: 'user',
			content: '[Conversation summary after compaction #' + count + ']\n' + summary,
			_loci_summary: true
		});
	}
	let open = [];
	for (const m of rows.slice(until)) {
		if (!m || IsCompactNotice(m)) continue;
		if (m.role === 'tool') {
			open = open.filter((call) => call.id !== m.tool_call_id);
			out.push(m);
			continue;
		}
		CloseCalls(out, open);
		open = m.role === 'assistant' ? AssistantToolCalls(m).filter((call) => call.id) : [];
		out.push(m);
	}
	CloseCalls(out, open);
	return out;
}

/**
 * A turn stopped between tool calls leaves calls with no result. Both APIs refuse
 * that history, so each gets a stopped result before the next message.
 */
function CloseCalls(out, open) {
	for (const call of open) {
		out.push({
			role: 'tool',
			tool_call_id: call.id,
			name: call.name,
			content: JSON.stringify({ ok: false, error: 'Stopped before this tool ran.' })
		});
	}
	open.length = 0;
}

/**
 * Stored turns that are not on the current model wire (folded, oldest first).
 * Skips compact notices. Empty when nothing has been compacted.
 * @param {object[]} raw
 */
export function HiddenHistoryMessages(raw) {
	const rows = raw || [];
	const until = DeriveKeepStart(rows);
	const hidden = [];
	for (let i = 0; i < until; i++) {
		const m = rows[i];
		if (!m || IsCompactNotice(m)) continue;
		hidden.push(m);
	}
	return hidden;
}

export function PrefixHasReasoningArtifacts(messages) {
	for (const m of messages || []) {
		if (!m || !Array.isArray(m.content_blocks)) continue;
		for (const b of m.content_blocks) {
			if (b && (b.type === 'thinking' || b.type === 'redacted_thinking')) return true;
		}
	}
	return false;
}

/**
 * Live wire minus the unanswered user message (and anything after it).
 * @param {object[]} wire
 */
export function SummarizerPrefix(wire) {
	const msgs = wire || [];
	const idx = FindKeepTailStart(msgs);
	if (idx < 0 || idx >= msgs.length) return [];
	return msgs.slice(0, idx);
}

export function HeuristicTokensFromText(text) {
	return Math.max(0, Math.floor((String(text || '').length + 3) / 4));
}

function MessageText(m) {
	if (!m) return '';
	const parts = [];
	if (Array.isArray(m.content_blocks) && m.content_blocks.length) {
		for (const b of m.content_blocks) {
			if (!b || typeof b !== 'object') continue;
			if (b.type === 'text' && b.text) parts.push(String(b.text));
			else if (b.type === 'tool_use') parts.push(JSON.stringify(b));
			else if (b.type === 'thinking' && b.thinking) parts.push(String(b.thinking));
			else if (b.type === 'redacted_thinking') parts.push(JSON.stringify(b));
		}
	} else {
		parts.push(String(m.content || ''));
		if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
			parts.push(JSON.stringify(m.tool_calls));
		}
	}
	for (const img of UserImages(m)) {
		parts.push('[image: ' + (img.name || 'attached') + ']');
	}
	return parts.join('\n');
}

/**
 * The newest assistant row that carries `context_tokens` is the API's own count of that
 * request plus its reply (system and tools included). Only rows after it are guessed from
 * characters, which undercounts JSON and misses reasoning carried in signatures.
 */
export function EstimatePromptTokens(session, system, tools) {
	const rows = session || [];
	let from = 0;
	let n = 0;
	for (let i = rows.length - 1; i >= 0; i--) {
		const counted = Number(rows[i] && rows[i].context_tokens);
		if (counted > 0) {
			n = counted;
			from = i + 1;
			break;
		}
	}
	if (!from) {
		n = HeuristicTokensFromText(system);
		if (tools && tools.length) n += HeuristicTokensFromText(JSON.stringify(tools));
	}
	for (let i = from; i < rows.length; i++) {
		n += 4 + HeuristicTokensFromText(MessageText(rows[i]));
		n += UserImages(rows[i]).length * 1600;
	}
	return n;
}

// Every stored image is resent on each request, and the APIs cap a whole request
// (Claude at 32 MB). Fold older turns well before that, whatever the token count.
export const WIRE_IMAGE_MAX = 16 * 1024 * 1024;

export function WireImageBytes(rows) {
	let n = 0;
	for (const row of rows || []) {
		for (const img of UserImages(row)) n += String(img.data).length;
	}
	return n;
}

export function ShouldCompact(promptTokens, maxTokens, compactAt) {
	const at = Number(compactAt) || 0;
	if (at <= 0) return false;
	const n = Number(promptTokens) || 0;
	const gen = Number(maxTokens) || 0;
	return n + gen > at;
}

function OverridePath(housesRoot) {
	if (housesRoot) return path.join(path.dirname(path.resolve(housesRoot)), 'compact_prompt.txt');
	return path.join(os.homedir(), '.loci', 'compact_prompt.txt');
}

export function LoadCompactPrompt(housesRoot) {
	const override = OverridePath(housesRoot);
	try {
		if (fs.existsSync(override)) {
			const text = fs.readFileSync(override, 'utf8').trim();
			if (text) return text;
		}
	} catch {
		// bundled template
	}
	try {
		const text = fs.readFileSync(DEFAULT_PROMPT, 'utf8').trim();
		if (text) return text;
	} catch {
		//
	}
	return '';
}

function SummarizeInstruction(housesRoot, strict) {
	let text = String(LoadCompactPrompt(housesRoot) || '').trim();
	text += '\n\nWrite the compaction summary now. Output only the summary text. Do not call tools.';
	if (strict) {
		text += '\n\nCRITICAL: Your previous attempt was invalid meta-commentary. '
			+ 'Start immediately with the handoff facts. No greeting, no planning.';
	}
	return text;
}

function CleanSummaryText(text) {
	let s = String(text || '').trim();
	s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();
	return s;
}

function LooksLikeMetaSummary(text) {
	const s = String(text || '').trim();
	if (!s) return true;
	const low = s.toLowerCase();
	const head = low.slice(0, 240);
	for (const marker of META_MARKERS) {
		if (head.includes(marker) || low.slice(0, 500).includes(marker)) return true;
	}
	return false;
}

/**
 * If over budget, continue the live prefix and ask for a handoff summary.
 * Appends a compact notice to session.jsonl; does not store the summarizer reply.
 * @returns {Promise<boolean>}
 */
export async function CompactIfNeeded(opts) {
	const at = Number(opts && opts.compactAt) || 0;
	if (at <= 0) return false;
	const houseDir = opts && opts.houseDir;
	if (!houseDir) return false;
	const raw = LoadSession(houseDir);
	const keepStart = FindKeepTailStart(raw);
	const priorStart = DeriveKeepStart(raw);
	if (keepStart <= priorStart) return false;

	const wire = BuildWireSession(raw);
	const prefix = SummarizerPrefix(wire);
	if (!prefix.length) return false;

	const maxTokens = Number(opts.maxTokens) || 0;
	const n = EstimatePromptTokens(wire, opts.system, opts.tools);
	if (!ShouldCompact(n, maxTokens, at) && WireImageBytes(wire) <= WIRE_IMAGE_MAX) return false;
	if (typeof opts.complete !== 'function') return false;

	const askedCap = Number(opts.summaryMax);
	const cap = Number.isFinite(askedCap) && askedCap > 0 ? askedCap : SUMMARY_MAX;
	const summaryMax = Math.max(256, Math.min(cap, maxTokens || cap));
	const keepThinking = PrefixHasReasoningArtifacts(prefix);
	const ask = async (strict) => {
		const session = prefix.concat([{
			role: 'user',
			content: SummarizeInstruction(opts.housesRoot, strict)
		}]);
		const extra = {
			session,
			toolChoice: 'none',
			maxTokens: summaryMax
		};
		if (!keepThinking) extra.reasoningEffort = 'off';
		return opts.complete(extra);
	};

	let round;
	try {
		round = await ask(false);
	} catch {
		return false;
	}
	let summary = CleanSummaryText(round && round.text);
	if (LooksLikeMetaSummary(summary) || (round && round.toolCalls && round.toolCalls.length)) {
		try {
			round = await ask(true);
		} catch {
			return false;
		}
		summary = CleanSummaryText(round && round.text);
	}
	if (!summary || LooksLikeMetaSummary(summary)) return false;
	if (round && round.toolCalls && round.toolCalls.length) return false;

	const { notice } = FindLastCompactNotice(raw);
	const count = (CompactCount(notice) || 0) + 1;
	AppendSession(houseDir, {
		role: 'compact',
		content: summary,
		_loci_compact: true,
		compact_count: count,
		keep_back: Math.max(0, raw.length - keepStart)
	});
	return true;
}

const MAX_HISTORY_MSGS = 32;
const MAX_CATALOG_MSGS = 200;
const MAX_HISTORY_CHARS = 100000;
const MAX_MSG_CHARS = 32000;

function AsNegIndex(value, name) {
	if (value == null || value === '') return null;
	if (typeof value === 'boolean') {
		throw new Error(name + ' must be a negative integer');
	}
	const n = Number(value);
	if (!Number.isInteger(n)) throw new Error(name + ' must be a negative integer');
	if (n >= 0) throw new Error('indices must be negative (-1 is the newest hidden message)');
	return n;
}

function InclSlice(seq, start, end) {
	if (end === -1) return seq.slice(start);
	return seq.slice(start, end + 1);
}

function RelRange(lo, hi) {
	const stop = hi === -1 ? 0 : hi + 1;
	const out = [];
	for (let i = lo; i < stop; i++) out.push(i);
	return out;
}

function NormQuery(raw) {
	if (raw == null || raw === false) return [];
	let parts;
	if (typeof raw === 'string') {
		const s = raw.trim();
		if (!s) return [];
		if (s.startsWith('[')) {
			try {
				const parsed = JSON.parse(s);
				if (Array.isArray(parsed)) parts = parsed;
			} catch {
				parts = [s];
			}
		} else {
			parts = [s];
		}
	} else if (Array.isArray(raw)) {
		parts = raw;
	} else {
		throw new Error('query must be a string or a list of strings');
	}
	const terms = [];
	const seen = new Set();
	for (const p of parts) {
		if (p == null || typeof p === 'boolean') continue;
		const s = String(p).trim();
		if (!s) continue;
		const key = s.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		terms.push(s);
	}
	return terms;
}

function QueryHits(msg, terms) {
	if (!terms.length) return true;
	const blob = (String(msg.name || '') + '\n' + MessageText(msg)).toLowerCase();
	return terms.some((t) => blob.includes(t.toLowerCase()));
}

function HistoryEntry(msg, index, catalog, charBudget) {
	const text = MessageText(msg);
	const item = {
		index,
		role: String(msg.role || ''),
		at: String(msg.at || ''),
		chars: text.length
	};
	if (msg.name) item.name = String(msg.name);
	if (catalog) return { item, nchars: 0 };
	let body = text;
	let truncated = false;
	if (charBudget != null && charBudget <= 0) {
		item.content = '';
		item.truncated = true;
		return { item, nchars: 0 };
	}
	let limit = MAX_MSG_CHARS;
	if (charBudget != null) limit = Math.min(limit, charBudget);
	if (body.length > limit) {
		body = body.slice(0, limit);
		truncated = true;
	}
	item.content = body;
	if (truncated) item.truncated = true;
	return { item, nchars: body.length };
}

/**
 * Speech and tool rows folded off the live wire. Indices are negative:
 * -1 is the newest hidden message.
 * @param {object[]} raw
 * @param {object} [args]
 */
export function ChatHistory(raw, args) {
	const a = args && typeof args === 'object' ? args : {};
	const terms = NormQuery(a.query);
	const hidden = HiddenHistoryMessages(raw);
	const n = hidden.length;
	const indexRange = n ? { start: -n, end: -1 } : null;
	let startI = AsNegIndex(a.start, 'start');
	let endI = a.end == null || a.end === '' ? null : AsNegIndex(a.end, 'end');

	if (startI == null) {
		if (endI != null) throw new Error('end requires start');
		if (!terms.length) {
			return {
				hidden: n,
				index_range: indexRange,
				messages: []
			};
		}
		startI = n ? -n : -1;
		endI = -1;
	} else if (endI == null) {
		endI = startI;
	}

	if (n <= 0) {
		return { hidden: 0, index_range: null, messages: [] };
	}
	if (startI < -n || endI < -n) {
		throw new Error('index out of range (valid ' + (-n) + ' to -1)');
	}
	const lo = startI > endI ? endI : startI;
	const hi = startI > endI ? startI : endI;
	let relIndices = RelRange(lo, hi);
	let picked = InclSlice(hidden, lo, hi);
	if (terms.length) {
		const filtered = [];
		for (let i = 0; i < picked.length; i++) {
			if (QueryHits(picked[i], terms)) filtered.push({ rel: relIndices[i], msg: picked[i] });
		}
		relIndices = filtered.map((p) => p.rel);
		picked = filtered.map((p) => p.msg);
	}
	const wantCatalog = !!a.catalog;
	const cap = wantCatalog ? MAX_CATALOG_MSGS : MAX_HISTORY_MSGS;
	let truncated = false;
	const matched = picked.length;
	if (picked.length > cap) {
		picked = picked.slice(-cap);
		relIndices = relIndices.slice(-cap);
		truncated = true;
	}
	const messages = [];
	let used = 0;
	for (let i = 0; i < picked.length; i++) {
		if (!wantCatalog && used >= MAX_HISTORY_CHARS) {
			truncated = true;
			break;
		}
		const budget = wantCatalog ? null : Math.max(0, MAX_HISTORY_CHARS - used);
		const { item, nchars } = HistoryEntry(picked[i], relIndices[i], wantCatalog, budget);
		messages.push(item);
		used += nchars;
	}
	if (messages.some((m) => m.truncated)) truncated = true;
	const out = {
		start: lo,
		end: hi,
		catalog: wantCatalog,
		hidden: n,
		index_range: indexRange,
		messages
	};
	if (terms.length) {
		out.query = terms;
		out.matched = matched;
	}
	if (truncated) out.truncated = true;
	return out;
}
