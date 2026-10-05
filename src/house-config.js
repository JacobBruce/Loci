import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EFFORTS = new Set(['off', 'none', 'auto', 'low', 'medium', 'high', 'xhigh']);

const CONFIG_HEADER = [
	'// max_tokens: output cap (default 32768). The Anthropic SDK requires a request timeout above ~21k; Loci sets that from this value.',
	'// max_tool_rounds: model replies with tool calls allowed in one turn (default 128, max 1024). One reply may hold several calls.',
	'// max_tool_result: bytes of one tool result kept in the conversation (default 81920).',
	'// command_timeout: seconds before run_command is killed when the agent gives no timeout (default 600 / 10 min).',
	'// command_timeout_max: the most seconds the agent may ask for with timeout_ms (default 1800 / 30 min, max 86400).',
	'// compact_at: compact when prompt tokens + max_tokens would exceed this (default 131072 / 128K; 0 = off).',
	'// summary_max: output cap for context compaction summary (default 16384).',
	'// reasoning_effort: auto (default), off (omit the field — older models), none (send "none" — GPT-5 / OpenRouter), low, medium, high, xhigh',
	'// playbook: per-house on/off for Rule Book paths. A missing key is off.',
	'// game_console: address, idle, and tool-round settings for the Game Console.',
	''
].join('\n');

export function DefaultHouseConfig() {
	return {
		max_tokens: 32768,
		max_tool_rounds: 128,
		max_tool_result: 80 * 1024,
		command_timeout: 600,
		command_timeout_max: 1800,
		compact_at: 131072,
		summary_max: 16384,
		reasoning_effort: 'auto',
		prompt_cache: true,
		playbook: {},
		game_console: NormalizeGameConsole(null)
	};
}

function FallbackHousesRoot() {
	return path.join(os.homedir(), '.loci', 'houses');
}

/**
 * Sibling of the houses folder: `~/.loci/config/` when houses are `~/.loci/houses/`.
 * @param {string} [housesRoot]
 */
export function ConfigRoot(housesRoot) {
	const root = path.resolve(housesRoot || FallbackHousesRoot());
	return path.join(path.dirname(root), 'config');
}

export function ConfigPath(housesRoot, slug) {
	return path.join(ConfigRoot(housesRoot), slug + '.json');
}

function ClampInt(n, min, max, fallback) {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(v)));
}

function NormalizeEffort(raw) {
	const v = String(raw == null ? 'auto' : raw).trim().toLowerCase();
	if (v === 'false' || v === '0') return 'off';
	if (v === 'minimal') return 'low';
	if (v === 'max') return 'xhigh';
	if (EFFORTS.has(v)) return v;
	return 'off';
}

function ParseConfigText(text) {
	const stripped = String(text || '')
		.split('\n')
		.filter((line) => !/^\s*\/\//.test(line))
		.join('\n')
		.replace(/\/\*[\s\S]*?\*\//g, '');
	return JSON.parse(stripped);
}

/**
 * @param {object} [raw]
 */
export function NormalizeHouseConfig(raw) {
	const d = DefaultHouseConfig();
	const src = (raw && typeof raw === 'object') ? raw : {};
	d.max_tokens = ClampInt(src.max_tokens, 256, 200000, d.max_tokens);
	d.max_tool_rounds = ClampInt(src.max_tool_rounds, 1, 1024, d.max_tool_rounds);
	d.max_tool_result = ClampInt(src.max_tool_result, 1024, 2 * 1024 * 1024, d.max_tool_result);
	d.command_timeout_max = ClampInt(src.command_timeout_max, 1, 86400, d.command_timeout_max);
	// The default never exceeds the ceiling.
	d.command_timeout = ClampInt(src.command_timeout, 1, d.command_timeout_max, Math.min(d.command_timeout, d.command_timeout_max));
	d.compact_at = ClampInt(src.compact_at, 0, 2000000, d.compact_at);
	d.summary_max = ClampInt(src.summary_max, 256, 200000, d.summary_max);
	d.reasoning_effort = NormalizeEffort(src.reasoning_effort);
	d.prompt_cache = src.prompt_cache !== false;
	if (src.tool_packs && typeof src.tool_packs === 'object' && !Array.isArray(src.tool_packs)) {
		d.tool_packs = src.tool_packs;
	}
	d.playbook = NormalizePlaybook(src.playbook);
	d.game_console = NormalizeGameConsole(src.game_console);
	return d;
}

function NormalizeGameConsole(raw) {
	const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	const url = String(src.url || '').trim();
	return {
		url: url ? url.slice(0, 200) : 'http://127.0.0.1:24740',
		idle_sec: ClampInt(src.idle_sec, 1, 3600, 30),
		idle_off: src.idle_off === true,
		max_tool_rounds: ClampInt(src.max_tool_rounds, 1, 256, 32),
		cap_off: src.cap_off === true
	};
}

function NormalizePlaybook(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [key, value] of Object.entries(raw)) {
		if (typeof key !== 'string' || !key || key.length > 200) continue;
		if (typeof value !== 'boolean') continue;
		out[key] = value;
	}
	return out;
}

/**
 * Merge `patch` into the runtime file. Regenerates the comment header.
 * @param {string} housesRoot
 * @param {string} slug
 * @param {object} patch
 */
export function PatchHouseConfig(housesRoot, slug, patch) {
	const current = LoadHouseConfig(housesRoot, slug);
	const next = NormalizeHouseConfig({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
	const p = ConfigPath(housesRoot, slug);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, CONFIG_HEADER + JSON.stringify(next, null, '\t') + '\n', 'utf8');
	return next;
}

/**
 * Write defaults only if the file is missing. Never overwrites user edits.
 * @param {string} housesRoot
 * @param {string} slug
 */
export function SeedHouseConfig(housesRoot, slug) {
	const p = ConfigPath(housesRoot, slug);
	if (fs.existsSync(p)) return LoadHouseConfig(housesRoot, slug);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	const cfg = DefaultHouseConfig();
	fs.writeFileSync(p, CONFIG_HEADER + JSON.stringify(cfg, null, '\t') + '\n', 'utf8');
	return cfg;
}

/**
 * @param {string} housesRoot
 * @param {string} slug
 */
export function LoadHouseConfig(housesRoot, slug) {
	const p = ConfigPath(housesRoot, slug);
	if (!fs.existsSync(p)) return DefaultHouseConfig();
	try {
		return NormalizeHouseConfig(ParseConfigText(fs.readFileSync(p, 'utf8')));
	} catch {
		return DefaultHouseConfig();
	}
}
