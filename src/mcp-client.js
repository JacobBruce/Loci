import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
	ExpandMcpCfg,
	LoadMcpConfig,
	PrefixedToolName,
	SanitizeId,
	WorkspaceFolder
} from './mcp-store.js';

const CONNECT_MS = 20_000;
const CALL_MS = 60_000;

/** @type {Map<string, { client: import('@modelcontextprotocol/sdk/client/index.js').Client, tools: object[], fingerprint: string, error: string }>} */
const sessions = new Map();
/** @type {Map<string, object[]>} */
const toolCache = new Map();
/** @type {Map<string, Promise<object>>} */
const inflight = new Map();
/** @type {Map<string, number>} */
const epoch = new Map();

function SessionKey(slug, serverId) {
	return String(slug || '') + '::' + String(serverId || '');
}

function SpawnEnv(extra) {
	const out = { ...getDefaultEnvironment() };
	for (const [k, v] of Object.entries(extra || {})) {
		if (v == null) continue;
		out[String(k)] = String(v);
	}
	return out;
}

function Fingerprint(cfg) {
	return JSON.stringify({
		command: cfg.command,
		args: cfg.args,
		cwd: cfg.cwd,
		env: cfg.env
	});
}

async function WithTimeout(promise, ms, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(label + ' timed out')), ms);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

function TextFromMcp(result) {
	if (!result) return '';
	if (result.structuredContent != null) {
		try {
			return JSON.stringify(result.structuredContent);
		} catch {
			// fall through to content parts
		}
	}
	const parts = [];
	for (const item of result.content || []) {
		if (item && item.text != null) parts.push(String(item.text));
		else if (item) parts.push(JSON.stringify(item));
	}
	return parts.join('\n').trim();
}

function SpecFromMcp(serverId, tool) {
	const bare = String(tool && tool.name || '').trim();
	if (!bare) return null;
	const prefixed = PrefixedToolName(serverId, bare);
	if (!prefixed) return null;
	const schema = (tool.inputSchema && typeof tool.inputSchema === 'object')
		? tool.inputSchema
		: { type: 'object', properties: {} };
	return {
		type: 'function',
		function: {
			name: prefixed,
			description: String(tool.description || ''),
			parameters: schema
		},
		_mcp: { serverId, bare }
	};
}

async function ListAllTools(client) {
	const tools = [];
	let cursor;
	do {
		const res = await client.listTools(cursor ? { cursor } : {});
		tools.push(...(res.tools || []));
		cursor = res.nextCursor;
	} while (cursor);
	return tools;
}

function ServerCfg(serverId) {
	const file = LoadMcpConfig();
	const raw = file.mcpServers && file.mcpServers[serverId];
	if (!raw) return null;
	return { ...raw, id: serverId };
}

function SessionEpoch(key) {
	return epoch.get(key) || 0;
}

function BumpSessionEpoch(key) {
	const n = SessionEpoch(key) + 1;
	epoch.set(key, n);
	return n;
}

async function DropSession(key) {
	const row = sessions.get(key);
	sessions.delete(key);
	if (!row || !row.client) return;
	try {
		await row.client.close();
	} catch {
		// already dead
	}
}

export async function CloseMcpSession(slug, serverId) {
	const key = SessionKey(slug, serverId);
	BumpSessionEpoch(key);
	inflight.delete(key);
	await DropSession(key);
}

function SessionKeyParts(k) {
	const i = String(k).indexOf('::');
	return { slug: k.slice(0, i), id: k.slice(i + 2) };
}

function KnownSessionKeys() {
	return new Set([...sessions.keys(), ...inflight.keys()]);
}

export async function CloseAllMcpSessions() {
	await Promise.all([...KnownSessionKeys()].map((k) => {
		const { slug, id } = SessionKeyParts(k);
		return CloseMcpSession(slug, id);
	}));
}

export async function CloseMcpSessionsForServer(serverId) {
	const id = String(serverId || '');
	const keys = [...KnownSessionKeys()].filter((k) => SessionKeyParts(k).id === id);
	await Promise.all(keys.map((k) => {
		const parts = SessionKeyParts(k);
		return CloseMcpSession(parts.slug, parts.id);
	}));
}

export async function CloseMcpSessionsForSlug(slug) {
	const prefix = String(slug || '') + '::';
	const keys = [...KnownSessionKeys()].filter((k) => k.startsWith(prefix));
	await Promise.all(keys.map((k) => {
		const parts = SessionKeyParts(k);
		return CloseMcpSession(parts.slug, parts.id);
	}));
}

/**
 * @param {string} slug
 * @param {string} serverId
 * @returns {{ state: 'running'|'connecting'|'error'|'stopped', error?: string }}
 */
export function PeekMcpStatus(slug, serverId) {
	const key = SessionKey(slug, serverId);
	if (inflight.has(key)) return { state: 'connecting' };
	const row = sessions.get(key);
	if (!row) return { state: 'stopped' };
	if (row.client && !row.error) return { state: 'running' };
	if (row.error) return { state: 'error', error: row.error };
	return { state: 'stopped' };
}

export async function WaitMcpForSlug(slug) {
	const prefix = String(slug || '') + '::';
	const pending = [];
	for (const [k, p] of inflight) {
		if (k.startsWith(prefix)) pending.push(p);
	}
	await Promise.all(pending.map((p) => p.catch(() => {})));
}

export function CachedMcpTools(slug, serverId) {
	const key = SessionKey(slug, serverId);
	const row = sessions.get(key);
	if (row && row.tools && row.tools.length) return row.tools;
	return toolCache.get(key) || [];
}

/**
 * Connect (or reuse) a stdio session for this house and server.
 * @param {object} ctx
 * @param {string} serverId
 */
export async function EnsureMcpSession(ctx, serverId) {
	const slug = String(ctx && ctx.slug || '');
	const id = String(serverId || '').trim();
	const raw = ServerCfg(id);
	if (!raw) throw new Error('Unknown MCP server: ' + id);
	if (!String(raw.command || '').trim()) {
		const error = 'MCP server "' + id + '" has no command';
		sessions.set(SessionKey(slug, id), { client: null, tools: [], fingerprint: '', error });
		throw new Error(error);
	}
	const expanded = ExpandMcpCfg(raw, WorkspaceFolder(ctx));
	expanded.id = id;
	const fp = Fingerprint(expanded);
	const key = SessionKey(slug, id);
	const prev = sessions.get(key);
	if (prev && prev.client && prev.fingerprint === fp && !prev.error) return prev;
	const pending = inflight.get(key);
	if (pending) return pending;

	const started = SessionEpoch(key);
	let settle;
	const work = new Promise((resolve, reject) => {
		settle = { resolve, reject };
	});
	inflight.set(key, work);
	(async () => {
		try {
			if (sessions.get(key)) await DropSession(key);
			if (SessionEpoch(key) !== started) throw new Error('MCP ' + id + ' closed');

			const transport = new StdioClientTransport({
				command: expanded.command,
				args: expanded.args,
				cwd: expanded.cwd || undefined,
				env: SpawnEnv(expanded.env),
				stderr: 'ignore'
			});
			const client = new Client({ name: 'loci', version: '0.0.1' });
			try {
				await WithTimeout(client.connect(transport), CONNECT_MS, 'MCP ' + id);
				const tools = await WithTimeout(ListAllTools(client), CONNECT_MS, 'MCP ' + id + ' listTools');
				if (SessionEpoch(key) !== started) {
					try {
						await client.close();
					} catch {
						// ignore
					}
					throw new Error('MCP ' + id + ' closed');
				}
				const row = { client, tools, fingerprint: fp, error: '' };
				sessions.set(key, row);
				toolCache.set(key, tools);
				settle.resolve(row);
			} catch (err) {
				try {
					await client.close();
				} catch {
					// ignore
				}
				if (SessionEpoch(key) !== started) throw err;
				const error = err && err.message ? String(err.message) : String(err);
				sessions.set(key, { client: null, tools: [], fingerprint: fp, error });
				throw new Error(error);
			}
		} catch (err) {
			settle.reject(err instanceof Error ? err : new Error(String(err)));
		} finally {
			if (inflight.get(key) === work) inflight.delete(key);
		}
	})();
	return work;
}

/**
 * OpenAI-style specs for one MCP server (prefixed names).
 * @param {object} ctx
 * @param {string} serverId
 */
export async function McpToolSpecs(ctx, serverId) {
	const row = await EnsureMcpSession(ctx, serverId);
	const out = [];
	for (const tool of row.tools || []) {
		const spec = SpecFromMcp(serverId, tool);
		if (spec) out.push(spec);
	}
	return out;
}

/**
 * List bare tools for the pack UI.
 * @param {object} ctx
 * @param {string} serverId
 * @param {{ connect?: boolean }} [opts]
 */
export async function ListMcpTools(ctx, serverId, opts) {
	const connect = !opts || opts.connect !== false;
	const mapTools = (tools) => (tools || []).map((t) => {
		const hint = t && t.annotations && t.annotations.readOnlyHint;
		return {
			name: String(t.name || ''),
			description: String(t.description || ''),
			capability: hint === true ? 'read-only' : 'can write'
		};
	}).filter((t) => t.name);
	if (!connect) {
		return { ok: true, tools: mapTools(CachedMcpTools(ctx && ctx.slug, serverId)) };
	}
	try {
		const row = await EnsureMcpSession(ctx, serverId);
		return { ok: true, tools: mapTools(row.tools) };
	} catch (err) {
		const cached = mapTools(CachedMcpTools(ctx && ctx.slug, serverId));
		return {
			ok: false,
			error: err && err.message ? String(err.message) : String(err),
			tools: cached
		};
	}
}

function SplitPrefixed(name) {
	const file = LoadMcpConfig();
	const servers = Object.keys(file.mcpServers || {});
	const hits = [];
	for (const id of servers) {
		const prefix = SanitizeId(id) + '_';
		if (name.startsWith(prefix) && name.length > prefix.length) {
			hits.push({ serverId: id, prefix });
		}
	}
	hits.sort((a, b) => b.prefix.length - a.prefix.length);
	return hits[0] || null;
}

function FindMcpTool(tools, serverId, prefixed) {
	for (const tool of tools || []) {
		if (PrefixedToolName(serverId, tool.name) === prefixed) return tool;
	}
	return null;
}

function PackAllowsMcp(ctx, serverId, bare) {
	if (!ctx || !ctx.tool_packs) return true;
	const row = ctx.tool_packs[serverId];
	if (!row || !row.enabled) return false;
	return !(row.disabled || []).includes(String(bare || ''));
}

/**
 * @param {object} ctx
 * @param {string} name prefixed tool name
 * @param {object} [args]
 */
export async function CallMcpTool(ctx, name, args) {
	const prefixed = String(name || '');
	const hit = SplitPrefixed(prefixed);
	if (!hit) return { ok: false, error: 'Unknown tool: ' + name };
	if (ctx && ctx.tool_packs) {
		const row = ctx.tool_packs[hit.serverId];
		if (!row || !row.enabled) {
			return { ok: false, error: 'MCP pack "' + hit.serverId + '" is disabled for this house.' };
		}
	}
	let session;
	try {
		session = await EnsureMcpSession(ctx, hit.serverId);
	} catch (err) {
		return { ok: false, error: err && err.message ? String(err.message) : String(err) };
	}
	const tool = FindMcpTool(session.tools, hit.serverId, prefixed);
	if (!tool) return { ok: false, error: 'Unknown tool: ' + name };
	if (!PackAllowsMcp(ctx, hit.serverId, tool.name)) {
		return { ok: false, error: tool.name + ' is disabled for this house.' };
	}
	try {
		const result = await WithTimeout(
			session.client.callTool({
				name: tool.name,
				arguments: args && typeof args === 'object' ? args : {}
			}),
			CALL_MS,
			hit.serverId + '_' + tool.name
		);
		const text = TextFromMcp(result);
		if (result && result.isError) {
			return { ok: false, error: text || 'MCP tool error' };
		}
		return { ok: true, text };
	} catch (err) {
		return { ok: false, error: err && err.message ? String(err.message) : String(err) };
	}
}
