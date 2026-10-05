import fs from 'node:fs';
import path from 'node:path';

export function SessionPath(houseDir) {
	return path.join(houseDir, 'session.jsonl');
}

/**
 * @param {string} houseDir
 * @returns {object[]}
 */
export function LoadSession(houseDir) {
	const p = SessionPath(houseDir);
	if (!fs.existsSync(p)) return [];
	const out = [];
	for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			continue;
		}
	}
	return out;
}

/**
 * @param {string} houseDir
 * @param {object} msg
 */
export function AppendSession(houseDir, msg) {
	const row = { ...msg, at: new Date().toISOString() };
	fs.appendFileSync(SessionPath(houseDir), JSON.stringify(row) + '\n', 'utf8');
	return row;
}

/**
 * @param {string} houseDir
 * @param {object[]} messages
 */
export function WriteSession(houseDir, messages) {
	const body = (messages || []).map((m) => JSON.stringify(m)).join('\n');
	fs.writeFileSync(SessionPath(houseDir), body ? body + '\n' : '', 'utf8');
}

export function ClearSession(houseDir) {
	WriteSession(houseDir, []);
}

const TURN_STAMP_LEN = 11;

function IsHourMinSec(value) {
	const s = String(value || '');
	if (s.length !== 8 || s[2] !== ':' || s[5] !== ':') return false;
	const digits = s[0] + s[1] + s[3] + s[4] + s[6] + s[7];
	for (let i = 0; i < digits.length; i++) {
		if (digits[i] < '0' || digits[i] > '9') return false;
	}
	return true;
}

function HasTurnStamp(text) {
	const head = String(text || '').slice(0, TURN_STAMP_LEN);
	if (head.length < TURN_STAMP_LEN) return false;
	if (head[0] !== '[' || head[9] !== ']' || head[10] !== '\n') return false;
	return IsHourMinSec(head.slice(1, 9));
}

export function StampTurnTime(text, time) {
	const stamp = String(time || '').trim();
	const body = String(text || '');
	if (!IsHourMinSec(stamp)) return body;
	if (HasTurnStamp(body)) return body;
	return '[' + stamp + ']\n' + body;
}

export function StripTurnTime(text) {
	const raw = String(text || '');
	return HasTurnStamp(raw) ? raw.slice(TURN_STAMP_LEN) : raw;
}

export function IsCompactNotice(msg) {
	if (!msg || typeof msg !== 'object') return false;
	if (msg._loci_compact) return true;
	return String(msg.role || '').toLowerCase() === 'compact';
}

/**
 * Keep through the last user row; drop a trailing assistant/tool fragment.
 * Compact notices that sit after that user stay (they belong to this keep-tail).
 * @param {string} houseDir
 * @returns {object | null} the last user message
 */
export function TruncateToLastUser(houseDir) {
	const rows = LoadSession(houseDir);
	let last = -1;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i] && rows[i].role === 'user') last = i;
	}
	if (last < 0) return null;
	let end = last;
	for (let i = last + 1; i < rows.length; i++) {
		if (IsCompactNotice(rows[i])) end = i;
		else break;
	}
	WriteSession(houseDir, rows.slice(0, end + 1));
	return rows[last];
}

/**
 * Anthropic rows store only content_blocks; other providers store content and tool_calls.
 * @param {object} msg
 */
export function AssistantText(msg) {
	const blocks = msg && msg.content_blocks;
	if (Array.isArray(blocks) && blocks.length) {
		let text = '';
		for (const b of blocks) {
			if (b && b.type === 'text' && b.text) text += b.text;
		}
		return text;
	}
	return String(msg && msg.content || '');
}

export function UserImages(msg) {
	if (!msg || !Array.isArray(msg.images)) return [];
	return msg.images.filter((img) => img && img.media_type && img.data);
}

export function AssistantToolCalls(msg) {
	const blocks = msg && msg.content_blocks;
	if (Array.isArray(blocks) && blocks.length) {
		const calls = [];
		for (const b of blocks) {
			if (!b || b.type !== 'tool_use') continue;
			calls.push({
				id: b.id,
				name: b.name,
				arguments: b.input == null ? {} : b.input
			});
		}
		return calls;
	}
	return Array.isArray(msg && msg.tool_calls) ? msg.tool_calls : [];
}

/**
 * Speech-only lines for the chat log (no tool traces). A user row with `from`
 * was a game, alarm, DM, or stamp wake, not the user typing.
 * @param {object[]} messages
 * @returns {{ role: string, text: string, from?: string }[]}
 */
export function SpeechFromSession(messages) {
	const out = [];
	for (const m of messages || []) {
		if (!m) continue;
		if (m.role === 'assistant') {
			const text = AssistantText(m).trim();
			if (text) out.push({ role: 'assistant', text });
			continue;
		}
		if (m.role !== 'user') continue;
		const text = StripTurnTime(String(m.content || '')).trim();
		const images = UserImages(m).map((img) => ({
			name: img.name || '',
			media_type: img.media_type,
			data: img.data
		}));
		if (!text && !images.length) continue;
		const line = { role: 'user', text };
		if (m.from) line.from = String(m.from);
		if (images.length) line.images = images;
		out.push(line);
	}
	return out.slice(-200);
}
