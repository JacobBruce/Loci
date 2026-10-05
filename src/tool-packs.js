import { LoadHouseConfig, PatchHouseConfig } from './house-config.js';
import { GetMcpServer, LoadMcpConfig, PrefixedToolName, PrintablePackName } from './mcp-store.js';
import {
	CallMcpTool,
	CloseMcpSession,
	EnsureMcpSession,
	ListMcpTools,
	McpToolSpecs,
	PeekMcpStatus
} from './mcp-client.js';
import { ToolSpecs } from './tools.js';
import { AgpiSpecs } from './agpi.js';

export const LOCI_PACK_ID = 'loci';
export const AGPI_PACK_ID = 'agpi';

export const LOCI_TOOL_NAMES = [
	'read_file',
	'write_file',
	'edit_file',
	'search_files',
	'chat_history',
	'run_command'
];

export const AGPI_AGENT_TOOLS = [
	'list_actions',
	'list_objects',
	'send_action',
	'send_msg',
	'get_state',
	'lock_body',
	'get_screen'
];

export const AGPI_PACK_TOOLS = AGPI_AGENT_TOOLS;

const RESERVED = new Set([...LOCI_TOOL_NAMES, ...AGPI_PACK_TOOLS]);

function UniqueNames(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = new Set();
	for (const name of raw) {
		const n = String(name || '').trim();
		if (!n || seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	return out;
}

export function DefaultToolPacks(runCommand) {
	return {
		[LOCI_PACK_ID]: { enabled: true, disabled: runCommand ? [] : ['run_command'] },
		[AGPI_PACK_ID]: { enabled: true, disabled: [] }
	};
}

function NormalizeEntry(raw, fallbackEnabled) {
	const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	const disabled = UniqueNames(src.disabled != null ? src.disabled : src.disabledTools);
	const enabled = src.enabled == null ? fallbackEnabled : !!src.enabled;
	return { enabled, disabled };
}

/**
 * @param {object} [raw] runtime.tool_packs
 * @param {{ run_command?: boolean }} [opts]
 */
export function NormalizeToolPacks(raw, opts) {
	const seeded = DefaultToolPacks(!!(opts && opts.run_command));
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return seeded;
	const out = {};
	const ids = new Set([...Object.keys(seeded), ...Object.keys(raw)]);
	for (const id of ids) {
		const builtin = id === LOCI_PACK_ID || id === AGPI_PACK_ID;
		out[id] = raw[id] == null
			? (builtin ? seeded[id] : { enabled: false, disabled: [] })
			: NormalizeEntry(raw[id], builtin);
	}
	return out;
}

export function PacksFromConfig(runtime, house) {
	const runCommand = !!(house && house.run_command);
	if (!runtime || runtime.tool_packs == null) return DefaultToolPacks(runCommand);
	return NormalizeToolPacks(runtime.tool_packs, { run_command: runCommand });
}

export function PackEnabled(packs, id) {
	const row = packs && packs[id];
	if (!row) return id === LOCI_PACK_ID || id === AGPI_PACK_ID;
	return !!row.enabled;
}

export function PackToolWanted(packs, packId, toolName) {
	const disabled = (packs && packs[packId] && packs[packId].disabled) || [];
	return !disabled.includes(String(toolName || ''));
}

export function PackToolEnabled(packs, packId, toolName) {
	return PackEnabled(packs, packId) && PackToolWanted(packs, packId, toolName);
}

export function BuiltinPackCatalog() {
	return [
		{ id: LOCI_PACK_ID, name: 'Loci', kind: 'native' },
		{ id: AGPI_PACK_ID, name: 'AGPI', kind: 'native' }
	];
}

function StatusForPack(kind, enabled, slug, id) {
	if (!enabled) {
		return { status: 'off', statusLabel: 'Disabled' };
	}
	if (kind !== 'mcp') {
		return { status: 'running', statusLabel: 'Running' };
	}
	const peek = PeekMcpStatus(slug, id);
	if (peek.state === 'running') return { status: 'running', statusLabel: 'Running' };
	if (peek.state === 'connecting') return { status: 'connecting', statusLabel: 'Connecting' };
	if (peek.state === 'error') {
		return {
			status: 'error',
			statusLabel: peek.error ? 'Failed to start: ' + peek.error : 'Failed to start'
		};
	}
	return { status: 'stopped', statusLabel: 'Stopped' };
}

export function PackCatalog(mcpCfg, packs, slug) {
	const rows = BuiltinPackCatalog().map((row) => {
		const enabled = PackEnabled(packs, row.id);
		return {
			...row,
			kindLabel: 'Native',
			enabled,
			...StatusForPack(row.kind, enabled, slug, row.id)
		};
	});
	const servers = (mcpCfg && mcpCfg.mcpServers) || {};
	for (const id of Object.keys(servers)) {
		const enabled = PackEnabled(packs, id);
		rows.push({
			id,
			name: PrintablePackName(id),
			kind: 'mcp',
			kindLabel: 'MCP',
			enabled,
			...StatusForPack('mcp', enabled, slug, id)
		});
	}
	return rows;
}

function ReservedNames(packs) {
	const names = new Set();
	if (PackEnabled(packs, LOCI_PACK_ID)) {
		for (const n of LOCI_TOOL_NAMES) {
			if (PackToolEnabled(packs, LOCI_PACK_ID, n)) names.add(n);
		}
	}
	if (PackEnabled(packs, AGPI_PACK_ID)) {
		for (const n of AGPI_AGENT_TOOLS) {
			if (PackToolEnabled(packs, AGPI_PACK_ID, n)) names.add(n);
		}
	}
	return names;
}

/**
 * Drop MCP tools whose prefixed name collides with Loci, AGPI, or an earlier pack.
 * @param {object[]} specs specs with function.name and optional _mcp
 * @param {Set<string>} taken
 */
export function SkipCollidingSpecs(specs, taken) {
	const out = [];
	const seen = new Set(taken);
	for (const spec of specs || []) {
		const name = spec && spec.function && spec.function.name;
		if (!name || seen.has(name) || RESERVED.has(name)) continue;
		seen.add(name);
		out.push(spec);
	}
	return out;
}

function StripMcpMeta(specs) {
	return (specs || []).map((s) => {
		const spec = { type: s.type, function: s.function };
		return spec;
	});
}

/**
 * Native + AGPI + enabled MCP specs for this house.
 * @param {object} ctx ToolContextFromHouse
 */
export async function HouseToolSpecs(ctx) {
	const packs = ctx && ctx.tool_packs ? ctx.tool_packs : DefaultToolPacks(!!(ctx && ctx.run_command));
	const native = ToolSpecs(ctx);
	const taken = new Set(native.map((s) => s.function.name));
	const mcpSpecs = [];
	const file = LoadMcpConfig();
	const ids = Object.keys(file.mcpServers || {}).filter((id) => PackEnabled(packs, id));
	const listed = await Promise.all(ids.map(async (id) => {
		try {
			return { id, specs: await McpToolSpecs(ctx, id) };
		} catch {
			return { id, specs: [] };
		}
	}));
	for (const { id, specs } of listed) {
		const allowed = specs.filter((s) => {
			const bare = s._mcp && s._mcp.bare;
			return PackToolEnabled(packs, id, bare);
		});
		const kept = SkipCollidingSpecs(allowed, taken);
		mcpSpecs.push(...kept);
		for (const s of kept) taken.add(s.function.name);
	}
	return native.concat(StripMcpMeta(mcpSpecs));
}

function ToolDescriptions(names, specs) {
	const map = new Map();
	for (const spec of specs || []) {
		const n = spec && spec.function && spec.function.name;
		if (!n) continue;
		map.set(n, String(spec.function.description || ''));
	}
	return names.map((name) => ({
		name,
		description: map.get(name) || ''
	}));
}

function CapabilityLabel(readOnly) {
	return readOnly === true ? 'read-only' : 'can write';
}

const NATIVE_READONLY = new Set([
	'read_file',
	'search_files',
	'chat_history',
	'list_actions',
	'list_objects',
	'get_state',
	'get_screen'
]);

function ToolRows(names, specs, wanted) {
	const described = ToolDescriptions(names, specs);
	return described.map((t) => ({
		...t,
		enabled: wanted(t.name),
		capability: CapabilityLabel(NATIVE_READONLY.has(t.name))
	}));
}

export function PacksForHouse(housesRoot, house) {
	const runtime = LoadHouseConfig(housesRoot, house.slug);
	return PacksFromConfig(runtime, house);
}

export function KickMcpForHouse(housesRoot, house) {
	const mcp = LoadMcpConfig();
	if (mcp.error) return;
	const packs = PacksForHouse(housesRoot, house);
	const ctx = { slug: house.slug, houseDir: house.path, workspaces: house.workspaces };
	for (const id of Object.keys(mcp.mcpServers || {})) {
		if (!PackEnabled(packs, id)) continue;
		EnsureMcpSession(ctx, id).catch(() => {});
	}
}

export async function ListPacksForHouse(housesRoot, house) {
	const packs = PacksForHouse(housesRoot, house);
	const mcp = LoadMcpConfig();
	return PackCatalog(mcp, packs, house.slug);
}

export async function ListPackTools(housesRoot, house, packId) {
	const packs = PacksForHouse(housesRoot, house);
	const id = String(packId || '');
	const packEnabled = PackEnabled(packs, id);
	const wanted = (name) => PackToolWanted(packs, id, name);
	if (id === LOCI_PACK_ID) {
		const specs = ToolSpecs({ run_command: true });
		return {
			ok: true,
			packEnabled,
			kind: 'native',
			tools: ToolRows(LOCI_TOOL_NAMES, specs, wanted)
		};
	}
	if (id === AGPI_PACK_ID) {
		const specs = AgpiSpecs();
		return {
			ok: true,
			packEnabled,
			kind: 'native',
			tools: ToolRows(AGPI_PACK_TOOLS, specs, wanted)
		};
	}
	const ctx = { slug: house.slug, houseDir: house.path, workspaces: house.workspaces };
	const listed = await ListMcpTools(ctx, id, { connect: packEnabled });
	const tools = (listed.tools || []).map((t) => ({
		...t,
		enabled: wanted(t.name)
	}));
	if (!packEnabled && !tools.length) {
		return {
			ok: true,
			packEnabled,
			kind: 'mcp',
			tools: [],
			note: 'Enable this pack to start the server and list its tools.'
		};
	}
	if (!listed.ok && packEnabled && !tools.length) {
		return { ok: false, packEnabled, kind: 'mcp', error: listed.error, tools: [] };
	}
	return {
		ok: true,
		packEnabled,
		kind: 'mcp',
		error: listed.ok ? '' : listed.error,
		tools
	};
}

export function PackSettings(packId) {
	const id = String(packId || '');
	if (id === LOCI_PACK_ID || id === AGPI_PACK_ID) return null;
	return GetMcpServer(id);
}

/**
 * @param {string} housesRoot
 * @param {object} house
 * @param {string} packId
 * @param {{ enabled?: boolean, disabled?: string[], tool?: string, toolEnabled?: boolean }} patch
 */
export async function SetPackForHouse(housesRoot, house, packId, patch) {
	const packs = PacksForHouse(housesRoot, house);
	const id = String(packId || '');
	const builtin = id === LOCI_PACK_ID || id === AGPI_PACK_ID;
	const prev = packs[id] || { enabled: builtin, disabled: [] };
	const next = {
		enabled: patch && patch.enabled != null ? !!patch.enabled : prev.enabled,
		disabled: UniqueNames(patch && patch.disabled != null ? patch.disabled : prev.disabled)
	};
	if (patch && patch.tool) {
		const tool = String(patch.tool);
		const on = patch.toolEnabled !== false;
		next.disabled = next.disabled.filter((n) => n !== tool);
		if (!on) next.disabled.push(tool);
	}
	packs[id] = next;
	PatchHouseConfig(housesRoot, house.slug, { tool_packs: packs });
	if (id === LOCI_PACK_ID) {
		const run = next.enabled && !next.disabled.includes('run_command');
		return { packs, run_command: run };
	}
	if (!next.enabled && !builtin) {
		await CloseMcpSession(house.slug, id);
	}
	return { packs, run_command: PackToolEnabled(packs, LOCI_PACK_ID, 'run_command') };
}

export { CallMcpTool, PrefixedToolName, ReservedNames };
