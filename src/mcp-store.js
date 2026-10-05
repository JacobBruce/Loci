import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN_RE = /\$\{([^}]+)\}/g;

let mcpPathOverride = '';

export function LociHome() {
	return path.join(os.homedir(), '.loci');
}

export function SetMcpPathForTest(p) {
	mcpPathOverride = p ? path.resolve(p) : '';
}

export function McpPath() {
	return mcpPathOverride || path.join(LociHome(), 'mcp.json');
}

export function DefaultMcpConfig() {
	return { mcpServers: {} };
}

export function SanitizeId(serverId) {
	const parts = [];
	for (const ch of String(serverId || '')) {
		parts.push(/[a-zA-Z0-9_]/.test(ch) ? ch : '_');
	}
	return parts.join('').replace(/^_+|_+$/g, '') || 'mcp';
}

export function PrintablePackName(id) {
	let s = String(id || '');
	s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
	s = s.replace(/\s+/g, ' ').trim();
	if (s.length > 80) s = s.slice(0, 80);
	return s || SanitizeId(id);
}

export function SanitizeToolName(name) {
	let out = '';
	for (const ch of String(name || '')) {
		if (ch === ' ' || ch === '\t') out += '_';
		else if (/[a-zA-Z0-9._-]/.test(ch)) out += ch;
	}
	return out.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

export function PrefixedToolName(serverId, toolName) {
	const bare = SanitizeToolName(toolName);
	if (!bare) return '';
	return SanitizeId(serverId) + '_' + bare;
}

export function RealPath(p) {
	const abs = path.resolve(String(p || '').trim() || '.');
	try {
		return fs.realpathSync(abs);
	} catch {
		return abs;
	}
}

/**
 * @param {string} s
 * @param {string} folder workspaceFolder
 * @param {string} [lociHome]
 */
export function ExpandMcpValue(s, folder, lociHome) {
	if (typeof s !== 'string' || !s.includes('${')) return s;
	const root = String(folder || '').replace(/[\\/]+$/, '');
	const home = os.homedir();
	const loci = String(lociHome || LociHome());
	const base = path.basename(root) || root;
	const sep = path.sep;
	return s.replace(TOKEN_RE, (all, name) => {
		if (name === 'workspaceFolder') return root;
		if (name === 'workspaceFolderBasename') return base;
		if (name === 'userHome') return home;
		if (name === 'lociHome') return loci;
		if (name === 'pathSeparator' || name === '/') return sep;
		if (name.startsWith('env:')) return process.env[name.slice(4)] || '';
		return all;
	});
}

export function ExpandMcpCfg(cfg, folder, lociHome) {
	const src = cfg && typeof cfg === 'object' ? cfg : {};
	const envIn = (src.env && typeof src.env === 'object' && !Array.isArray(src.env)) ? src.env : {};
	const env = {};
	for (const [k, v] of Object.entries(envIn)) {
		env[String(k)] = ExpandMcpValue(String(v), folder, lociHome);
	}
	const args = Array.isArray(src.args) ? src.args.map((a) => ExpandMcpValue(String(a), folder, lociHome)) : [];
	const cwdRaw = ExpandMcpValue(String(src.cwd || ''), folder, lociHome).trim();
	return {
		command: ExpandMcpValue(String(src.command || ''), folder, lociHome),
		args,
		cwd: cwdRaw,
		env,
		id: String(src.id || '')
	};
}

/**
 * First attached workspace, else the house folder.
 * @param {{ houseDir?: string, workspaces?: string[] }} ctx
 */
export function WorkspaceFolder(ctx) {
	const house = RealPath(String(ctx && ctx.houseDir || '').trim() || '.');
	const list = Array.isArray(ctx && ctx.workspaces) ? ctx.workspaces : [];
	for (const item of list) {
		const ws = RealPath(String(item || '').trim());
		if (!ws) continue;
		const rel = path.relative(house, ws);
		const up = path.relative(ws, house);
		if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) continue;
		if (up === '' || (!up.startsWith('..') && !path.isAbsolute(up))) continue;
		return ws;
	}
	return house;
}

export function NormalizeServer(id, cfg) {
	const c = cfg && typeof cfg === 'object' ? cfg : {};
	const args = Array.isArray(c.args) ? c.args.map((a) => String(a)) : [];
	const env = (c.env && typeof c.env === 'object' && !Array.isArray(c.env)) ? { ...c.env } : {};
	const envOut = {};
	for (const [k, v] of Object.entries(env)) envOut[String(k)] = String(v);
	return {
		command: String(c.command || ''),
		args,
		cwd: String(c.cwd || ''),
		env: envOut
	};
}

export function NormalizeMcpConfig(raw) {
	const servers = (raw && raw.mcpServers && typeof raw.mcpServers === 'object') ? raw.mcpServers : {};
	const out = { mcpServers: {} };
	const seen = new Map();
	const warnings = [];
	for (const id of Object.keys(servers)) {
		const key = String(id || '').trim();
		if (!key) {
			warnings.push('Ignored MCP server with empty id');
			continue;
		}
		const lower = key.toLowerCase();
		if (seen.has(lower)) {
			warnings.push('Duplicate MCP server id ignored: "' + key + '"');
			continue;
		}
		const prefix = SanitizeId(key);
		if (seen.has('prefix:' + prefix)) {
			warnings.push('MCP server id "' + key + '" collides after sanitize with "' + seen.get('prefix:' + prefix) + '"');
			continue;
		}
		seen.set(lower, key);
		seen.set('prefix:' + prefix, key);
		out.mcpServers[key] = NormalizeServer(key, servers[key]);
	}
	if (warnings.length) out.warnings = warnings;
	return out;
}

export function LoadMcpConfig() {
	const p = McpPath();
	if (!fs.existsSync(p)) return DefaultMcpConfig();
	try {
		const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			const out = DefaultMcpConfig();
			out.error = 'mcp.json must be a JSON object.';
			return out;
		}
		return NormalizeMcpConfig(parsed);
	} catch (err) {
		const out = DefaultMcpConfig();
		out.error = 'mcp.json is not valid JSON: ' + (err && err.message ? err.message : String(err));
		return out;
	}
}

export function EnsureMcpFile() {
	const p = McpPath();
	if (!fs.existsSync(p)) {
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, JSON.stringify(DefaultMcpConfig(), null, '\t') + '\n', 'utf8');
	}
	return p;
}

export function ReadMcpText() {
	const p = EnsureMcpFile();
	return { path: p, text: fs.readFileSync(p, 'utf8') };
}

/**
 * @param {string} text
 */
export function WriteMcpText(text) {
	const raw = String(text || '');
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error('mcp.json is not valid JSON: ' + (err && err.message ? err.message : String(err)));
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('mcp.json must be a JSON object.');
	}
	const norm = NormalizeMcpConfig(parsed);
	const body = { mcpServers: norm.mcpServers };
	const p = McpPath();
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(body, null, '\t') + '\n', 'utf8');
	return { path: p, warnings: norm.warnings || [] };
}

function ParseJsonField(raw, empty, label) {
	const text = String(raw || '').trim();
	if (!text) return empty;
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new Error(label + ' is not valid JSON: ' + (err && err.message ? err.message : String(err)));
	}
}

/**
 * @param {string} id
 */
export function GetMcpServer(id) {
	const key = String(id || '').trim();
	const cfg = LoadMcpConfig().mcpServers[key];
	if (!cfg) return null;
	return { id: key, ...cfg };
}

/**
 * @param {string} id
 * @param {{ command?: string, args?: string[]|string, cwd?: string, env?: object|string }} patch
 */
export function UpdateMcpServer(id, patch) {
	const key = String(id || '').trim();
	const file = LoadMcpConfig();
	const prev = file.mcpServers[key];
	if (!prev) throw new Error('Unknown MCP server: ' + key);
	let args = patch && patch.args != null ? patch.args : prev.args;
	if (typeof args === 'string') {
		args = ParseJsonField(args, [], 'Args');
	}
	if (!Array.isArray(args)) throw new Error('Args must be a JSON array.');
	let env = patch && patch.env != null ? patch.env : prev.env;
	if (typeof env === 'string') {
		env = ParseJsonField(env, {}, 'Env');
	}
	if (!env || typeof env !== 'object' || Array.isArray(env)) {
		throw new Error('Env must be a JSON object.');
	}
	file.mcpServers[key] = NormalizeServer(key, {
		...prev,
		command: patch && patch.command != null ? patch.command : prev.command,
		args,
		cwd: patch && patch.cwd != null ? patch.cwd : prev.cwd,
		env
	});
	return WriteMcpText(JSON.stringify({ mcpServers: file.mcpServers }, null, '\t'));
}
