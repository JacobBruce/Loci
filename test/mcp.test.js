import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	ExpandMcpCfg,
	ExpandMcpValue,
	GetMcpServer,
	LociHome,
	LoadMcpConfig,
	PrefixedToolName,
	PrintablePackName,
	SanitizeId,
	SanitizeToolName,
	SetMcpPathForTest,
	UpdateMcpServer,
	WorkspaceFolder,
	WriteMcpText
} from '../src/mcp-store.js';
import { CallMcpTool, CloseAllMcpSessions, EnsureMcpSession, ListMcpTools, PeekMcpStatus, WaitMcpForSlug } from '../src/mcp-client.js';
import {
	AGPI_AGENT_TOOLS,
	AGPI_PACK_TOOLS,
	DefaultToolPacks,
	HouseToolSpecs,
	KickMcpForHouse,
	ListPacksForHouse,
	ListPackTools,
	NormalizeToolPacks,
	PackCatalog,
	PacksFromConfig,
	PackSettings,
	PackToolEnabled,
	PackToolWanted,
	SkipCollidingSpecs
} from '../src/tool-packs.js';
import { CallTool, McpPalaceBlocked, ToolSpecs } from '../src/tools.js';
import { PatchHouseConfig } from '../src/house-config.js';

const echoServer = path.join(import.meta.dirname, 'fixtures', 'mcp-echo.js');
const delayExit = path.join(import.meta.dirname, 'fixtures', 'mcp-delay-exit.js');

function TempDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('SanitizeId and prefixes', () => {
	assert.equal(SanitizeId('cait'), 'cait');
	assert.equal(SanitizeId('my-cait'), 'my_cait');
	assert.equal(SanitizeToolName('read file'), 'read_file');
	assert.equal(SanitizeToolName('read.file'), 'read.file');
	assert.equal(SanitizeToolName('read-file'), 'read-file');
	assert.equal(SanitizeToolName('read@file'), 'readfile');
	assert.equal(PrefixedToolName('cait', 'read_file'), 'cait_read_file');
	assert.equal(PrefixedToolName('cait', 'read file'), 'cait_read_file');
	assert.equal(PrefixedToolName('list', 'actions'), 'list_actions');
	assert.equal(PrefixedToolName('cait', '@@@'), '');
	assert.equal(PrintablePackName('cait'), 'cait');
	assert.equal(PrintablePackName('my-cait'), 'my-cait');
	assert.equal(PrintablePackName('cait\n\u202Etool'), 'caittool');
	assert.equal(PrintablePackName('\u0000\u0001'), 'mcp');
});

test('token expansion uses house workspace and lociHome', () => {
	const folder = '/tmp/project';
	const loci = '/home/me/.loci';
	assert.equal(ExpandMcpValue('${workspaceFolder}/src', folder, loci), '/tmp/project/src');
	assert.equal(ExpandMcpValue('${lociHome}/mcp.json', folder, loci), '/home/me/.loci/mcp.json');
	assert.equal(ExpandMcpValue('${userHome}', folder, loci), os.homedir());
	const cfg = ExpandMcpCfg({
		command: '${workspaceFolder}/bin',
		args: ['--root', '${workspaceFolder}'],
		cwd: '${lociHome}',
		env: { CAIT_WORKSPACE: '${workspaceFolder}' }
	}, folder, loci);
	assert.equal(cfg.command, '/tmp/project/bin');
	assert.deepEqual(cfg.args, ['--root', '/tmp/project']);
	assert.equal(cfg.cwd, '/home/me/.loci');
	assert.equal(cfg.env.CAIT_WORKSPACE, '/tmp/project');
});

test('WorkspaceFolder is first attached workspace else house', () => {
	const house = TempDir('loci-ws-house-');
	const ws = TempDir('loci-ws-proj-');
	assert.equal(WorkspaceFolder({ houseDir: house, workspaces: [] }), path.resolve(house));
	assert.equal(WorkspaceFolder({ houseDir: house, workspaces: [ws] }), path.resolve(ws));
	const link = path.join(path.dirname(house), 'ws-link-' + process.pid);
	fs.symlinkSync(house, link);
	try {
		assert.equal(WorkspaceFolder({ houseDir: house, workspaces: [link] }), path.resolve(house));
	} finally {
		fs.unlinkSync(link);
	}
});

test('run_command seeds Loci pack until tool_packs is saved', () => {
	const off = PacksFromConfig({}, { run_command: false });
	assert.equal(PackToolEnabled(off, 'loci', 'read_file'), true);
	assert.equal(PackToolEnabled(off, 'loci', 'run_command'), false);
	const on = PacksFromConfig(null, { run_command: true });
	assert.equal(PackToolEnabled(on, 'loci', 'run_command'), true);
	const saved = PacksFromConfig({
		tool_packs: { loci: { enabled: true, disabled: ['run_command', 'chat_history'] }, agpi: { enabled: true, disabled: [] } }
	}, { run_command: true });
	assert.equal(PackToolEnabled(saved, 'loci', 'run_command'), false);
	assert.equal(PackToolEnabled(saved, 'loci', 'chat_history'), false);
});

test('MCP tools that collide with Loci or AGPI names are skipped', () => {
	const taken = new Set(['read_file']);
	const specs = SkipCollidingSpecs([
		{ type: 'function', function: { name: 'list_actions' }, _mcp: { bare: 'actions' } },
		{ type: 'function', function: { name: 'echo_ping' }, _mcp: { bare: 'ping' } },
		{ type: 'function', function: { name: 'read_file' }, _mcp: { bare: 'read_file' } }
	], taken);
	assert.deepEqual(specs.map((s) => s.function.name), ['echo_ping']);
});

test('disabling the Loci pack drops native tools from ToolSpecs', () => {
	const ctx = {
		houseDir: '/tmp',
		run_command: false,
		tool_packs: NormalizeToolPacks({
			loci: { enabled: false, disabled: [] },
			agpi: { enabled: true, disabled: ['lock_body'] }
		})
	};
	const names = ToolSpecs(ctx).map((s) => s.function.name);
	assert.equal(names.includes('read_file'), false);
	assert.equal(names.includes('list_actions'), true);
	assert.equal(names.includes('lock_body'), false);
});

test('MCP palace path filter blocks SOUL.md and allows artifacts', () => {
	const housesRoot = TempDir('loci-mcp-houses-');
	const houseDir = path.join(housesRoot, 'maple');
	const other = path.join(housesRoot, 'cedar');
	fs.mkdirSync(houseDir);
	fs.mkdirSync(other);
	fs.mkdirSync(path.join(houseDir, 'artifacts'));
	fs.writeFileSync(path.join(houseDir, 'SOUL.md'), 'x');
	fs.writeFileSync(path.join(other, 'SOUL.md'), 'y');
	const ws = TempDir('loci-mcp-ws-');
	const ctx = { houseDir, housesRoot, workspaces: [ws] };
	assert.equal(McpPalaceBlocked(ctx, { path: 'SOUL.md' }), 'SOUL.md');
	assert.equal(McpPalaceBlocked(ctx, { path: path.join(houseDir, 'artifacts', 'out.txt') }), '');
	assert.equal(McpPalaceBlocked(ctx, { path: 'stories/skyrim/HISTORY.md' }), '');
	assert.equal(McpPalaceBlocked(ctx, { path: path.join(ws, 'main.js') }), '');
	assert.equal(McpPalaceBlocked(ctx, { path: 'artifacts/../SOUL.md' }), 'SOUL.md');
	assert.equal(McpPalaceBlocked({ houseDir, housesRoot, workspaces: [] }, { path: '.' }), '.');
	assert.equal(McpPalaceBlocked(ctx, { path: 'file://' + houseDir + '/SOUL.md' }), 'SOUL.md');
	assert.equal(McpPalaceBlocked(ctx, { path: path.join(other, 'SOUL.md') }), path.join('cedar', 'SOUL.md'));
	assert.equal(McpPalaceBlocked(ctx, { text: 'hi' }), '');
});

test('stdio MCP client prefixes tools and calls echo', async () => {
	const dir = TempDir('loci-mcp-json-');
	const mcpFile = path.join(dir, 'mcp.json');
	SetMcpPathForTest(mcpFile);
	WriteMcpText(JSON.stringify({
		mcpServers: {
			echo: {
				command: process.execPath,
				args: [echoServer],
				name: 'Echo'
			}
		}
	}, null, '\t'));
	const houseDir = TempDir('loci-mcp-house-');
	const ctx = {
		houseDir,
		slug: 'maple',
		workspaces: [],
		run_command: false,
		tool_packs: {
			loci: { enabled: true, disabled: ['run_command'] },
			agpi: { enabled: true, disabled: [] },
			echo: { enabled: true, disabled: [] }
		}
	};
	try {
		const specs = await HouseToolSpecs(ctx);
		const names = specs.map((s) => s.function.name);
		assert.ok(names.includes('echo_echo'));
		assert.ok(names.includes('echo_ping'));
		assert.ok(names.includes('read_file'));
		const listed = await ListMcpTools(ctx, 'echo');
		assert.equal(listed.tools.find((t) => t.name === 'ping').capability, 'read-only');
		assert.equal(listed.tools.find((t) => t.name === 'echo').capability, 'can write');
		const ping = await CallTool(ctx, 'echo_ping', {});
		assert.equal(ping.ok, true);
		assert.equal(ping.text, 'pong');
		const echoed = await CallMcpTool(ctx, 'echo_echo', { text: 'hi' });
		assert.equal(echoed.ok, true);
		assert.equal(echoed.text, 'hi');
		const blocked = await CallTool(ctx, 'echo_echo', { text: path.join(houseDir, 'SOUL.md') });
		assert.equal(blocked.ok, false);
		assert.match(blocked.error, /artifacts/);
	} finally {
		await CloseAllMcpSessions();
		SetMcpPathForTest('');
	}
});

test('disabled MCP pack or tool is not callable', async () => {
	const dir = TempDir('loci-mcp-off-');
	SetMcpPathForTest(path.join(dir, 'mcp.json'));
	WriteMcpText(JSON.stringify({
		mcpServers: {
			echo: { command: process.execPath, args: [echoServer] }
		}
	}));
	const houseDir = TempDir('loci-mcp-off-house-');
	const base = {
		houseDir,
		slug: 'maple',
		workspaces: [],
		run_command: false
	};
	try {
		const off = await CallTool({
			...base,
			tool_packs: {
				loci: { enabled: true, disabled: ['run_command'] },
				agpi: { enabled: true, disabled: [] },
				echo: { enabled: false, disabled: [] }
			}
		}, 'echo_echo', { text: 'leaked' });
		assert.equal(off.ok, false);
		assert.match(off.error, /disabled/);
		const toolOff = {
			...base,
			tool_packs: {
				loci: { enabled: true, disabled: ['run_command'] },
				agpi: { enabled: true, disabled: [] },
				echo: { enabled: true, disabled: ['echo'] }
			}
		};
		const blocked = await CallTool(toolOff, 'echo_echo', { text: 'leaked' });
		assert.equal(blocked.ok, false);
		assert.match(blocked.error, /disabled/);
		const ping = await CallTool(toolOff, 'echo_ping', {});
		assert.equal(ping.ok, true);
		assert.equal(ping.text, 'pong');
	} finally {
		await CloseAllMcpSessions();
		SetMcpPathForTest('');
	}
});

test('WriteMcpText drops name; the server id is the label', () => {
	const dir = TempDir('loci-mcp-name-');
	const mcpFile = path.join(dir, 'mcp.json');
	SetMcpPathForTest(mcpFile);
	try {
		WriteMcpText(JSON.stringify({
			mcpServers: { cait: { command: 'npx', args: ['-y', '@cait/mcp'], name: 'cait' } }
		}));
		const disk = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
		assert.equal(Object.prototype.hasOwnProperty.call(disk.mcpServers.cait, 'name'), false);
		assert.equal(disk.mcpServers.cait.command, 'npx');
	} finally {
		SetMcpPathForTest('');
	}
});

test('LoadMcpConfig surfaces invalid JSON without wiping the file', () => {
	const dir = TempDir('loci-mcp-bad-');
	const mcpFile = path.join(dir, 'mcp.json');
	SetMcpPathForTest(mcpFile);
	fs.writeFileSync(mcpFile, '{ not json', 'utf8');
	try {
		const cfg = LoadMcpConfig();
		assert.deepEqual(cfg.mcpServers, {});
		assert.match(cfg.error, /valid JSON/);
		assert.equal(fs.readFileSync(mcpFile, 'utf8'), '{ not json');
	} finally {
		SetMcpPathForTest('');
	}
});

test('LociHome is ~/.loci', () => {
	assert.equal(LociHome(), path.join(os.homedir(), '.loci'));
	assert.deepEqual(DefaultToolPacks(false).loci.disabled, ['run_command']);
});

test('PackToolWanted is independent of pack enabled', () => {
	const packs = NormalizeToolPacks({
		loci: { enabled: false, disabled: ['run_command'] },
		agpi: { enabled: true, disabled: [] }
	});
	assert.equal(PackToolWanted(packs, 'loci', 'read_file'), true);
	assert.equal(PackToolWanted(packs, 'loci', 'run_command'), false);
	assert.equal(PackToolEnabled(packs, 'loci', 'read_file'), false);
	assert.equal(PackToolEnabled(packs, 'loci', 'run_command'), false);
});

test('AGPI pack list and the agent wire both include send_msg', () => {
	assert.equal(AGPI_PACK_TOOLS.includes('send_msg'), true);
	assert.equal(AGPI_AGENT_TOOLS.includes('send_msg'), true);
	assert.equal(AGPI_AGENT_TOOLS.includes('list_actions'), true);
});

test('PackCatalog labels Native vs MCP and mutes disabled packs', () => {
	const dir = TempDir('loci-pack-cat-');
	const mcpFile = path.join(dir, 'mcp.json');
	SetMcpPathForTest(mcpFile);
	try {
		WriteMcpText(JSON.stringify({
			mcpServers: { cait: { command: 'npx', args: ['-y', '@cait/mcp'] } }
		}, null, '\t'));
		const packs = {
			loci: { enabled: true, disabled: [] },
			agpi: { enabled: false, disabled: [] },
			cait: { enabled: false, disabled: [] }
		};
		const rows = PackCatalog(LoadMcpConfig(), packs, 'maple');
		const loci = rows.find((r) => r.id === 'loci');
		const agpi = rows.find((r) => r.id === 'agpi');
		const cait = rows.find((r) => r.id === 'cait');
		assert.equal(loci.kindLabel, 'Native');
		assert.equal(loci.status, 'running');
		assert.equal(agpi.kindLabel, 'Native');
		assert.equal(agpi.status, 'off');
		assert.equal(cait.name, 'cait');
		assert.equal(cait.kindLabel, 'MCP');
		assert.equal(cait.status, 'off');
		assert.equal(cait.statusLabel, 'Disabled');
	} finally {
		SetMcpPathForTest('');
	}
});

test('ListPackTools keeps wanted checkboxes when the pack is off', async () => {
	const housesRoot = path.join(TempDir('loci-pack-tools-houses-'), 'houses');
	const house = { slug: 'maple', path: path.join(housesRoot, 'maple'), workspaces: [], run_command: false };
	PatchHouseConfig(housesRoot, 'maple', {
		tool_packs: {
			loci: { enabled: false, disabled: ['run_command'] },
			agpi: { enabled: true, disabled: [] }
		}
	});
	const listed = await ListPackTools(housesRoot, house, 'loci');
	assert.equal(listed.ok, true);
	assert.equal(listed.packEnabled, false);
	assert.equal(listed.kind, 'native');
	const read = listed.tools.find((t) => t.name === 'read_file');
	const run = listed.tools.find((t) => t.name === 'run_command');
	assert.equal(read.enabled, true);
	assert.equal(read.capability, 'read-only');
	assert.ok(read.description);
	assert.equal(run.enabled, false);
	assert.equal(run.capability, 'can write');
	const agpi = await ListPackTools(housesRoot, house, 'agpi');
	const send = agpi.tools.find((t) => t.name === 'send_msg');
	assert.ok(send);
	assert.ok(send.description);
	assert.equal(send.enabled, true);
	assert.equal(send.capability, 'can write');
	assert.equal(agpi.tools.find((t) => t.name === 'list_actions').capability, 'read-only');
});

test('MCP pack settings use server id (no display name) and UpdateMcpServer patches command', () => {
	const dir = TempDir('loci-pack-set-');
	const mcpFile = path.join(dir, 'mcp.json');
	SetMcpPathForTest(mcpFile);
	try {
		WriteMcpText(JSON.stringify({
			mcpServers: { echo: { command: 'node', args: ['a.js'], cwd: '', env: {} } }
		}, null, '\t'));
		assert.equal(PackSettings('loci'), null);
		const cfg = PackSettings('echo');
		assert.equal(cfg.id, 'echo');
		assert.equal(cfg.command, 'node');
		assert.equal(GetMcpServer('echo').command, 'node');
		UpdateMcpServer('echo', {
			command: 'npx',
			args: '["-y","echo"]',
			cwd: '/tmp',
			env: '{"FOO":"1"}'
		});
		const next = GetMcpServer('echo');
		assert.equal(next.command, 'npx');
		assert.deepEqual(next.args, ['-y', 'echo']);
		assert.equal(next.cwd, '/tmp');
		assert.equal(next.env.FOO, '1');
		assert.equal(Object.prototype.hasOwnProperty.call(next, 'name'), false);
		const disk = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
		assert.equal(Object.prototype.hasOwnProperty.call(disk.mcpServers.echo, 'name'), false);
		assert.throws(() => UpdateMcpServer('echo', { args: '[' }), /Args is not valid JSON/);
	} finally {
		SetMcpPathForTest('');
	}
});

test('disabled MCP pack does not spawn just to list tools', async () => {
	const dir = TempDir('loci-pack-off-mcp-');
	SetMcpPathForTest(path.join(dir, 'mcp.json'));
	const housesRoot = path.join(TempDir('loci-pack-off-houses-'), 'houses');
	WriteMcpText(JSON.stringify({
		mcpServers: {
			echo: { command: process.execPath, args: [echoServer] }
		}
	}, null, '\t'));
	const house = { slug: 'cedar', path: path.join(housesRoot, 'cedar'), workspaces: [] };
	PatchHouseConfig(housesRoot, 'cedar', {
		tool_packs: {
			loci: { enabled: true, disabled: ['run_command'] },
			agpi: { enabled: true, disabled: [] },
			echo: { enabled: false, disabled: [] }
		}
	});
	try {
		const listed = await ListPackTools(housesRoot, house, 'echo');
		assert.equal(listed.ok, true);
		assert.equal(listed.packEnabled, false);
		assert.equal(listed.tools.length, 0);
		assert.match(listed.note || '', /Enable this pack/);
	} finally {
		await CloseAllMcpSessions();
		SetMcpPathForTest('');
	}
});

test('ListPacksForHouse does not spawn MCP', async () => {
	const dir = TempDir('loci-pack-list-');
	SetMcpPathForTest(path.join(dir, 'mcp.json'));
	const housesRoot = path.join(TempDir('loci-pack-list-houses-'), 'houses');
	WriteMcpText(JSON.stringify({
		mcpServers: {
			echo: { command: 'loci-mcp-should-not-spawn', args: [] }
		}
	}));
	const house = { slug: 'maple', path: path.join(housesRoot, 'maple'), workspaces: [] };
	PatchHouseConfig(housesRoot, 'maple', {
		tool_packs: {
			loci: { enabled: true, disabled: ['run_command'] },
			agpi: { enabled: true, disabled: [] },
			echo: { enabled: true, disabled: [] }
		}
	});
	try {
		const rows = await ListPacksForHouse(housesRoot, house);
		const echo = rows.find((r) => r.id === 'echo');
		assert.equal(echo.status, 'stopped');
		assert.equal(PeekMcpStatus('maple', 'echo').state, 'stopped');
	} finally {
		await CloseAllMcpSessions();
		SetMcpPathForTest('');
	}
});

test('PeekMcpStatus is connecting while spawn is in flight', async () => {
	const dir = TempDir('loci-mcp-connecting-');
	SetMcpPathForTest(path.join(dir, 'mcp.json'));
	WriteMcpText(JSON.stringify({
		mcpServers: {
			hang: { command: process.execPath, args: [delayExit] }
		}
	}));
	const ctx = { slug: 'oak', houseDir: dir, workspaces: [] };
	const packs = {
		loci: { enabled: true, disabled: ['run_command'] },
		agpi: { enabled: true, disabled: [] },
		hang: { enabled: true, disabled: [] }
	};
	try {
		const pending = EnsureMcpSession(ctx, 'hang');
		const second = EnsureMcpSession(ctx, 'hang');
		assert.equal(PeekMcpStatus('oak', 'hang').state, 'connecting');
		const row = PackCatalog(LoadMcpConfig(), packs, 'oak').find((r) => r.id === 'hang');
		assert.equal(row.status, 'connecting');
		assert.equal(row.statusLabel, 'Connecting');
		await Promise.allSettled([pending, second]);
		assert.equal(PeekMcpStatus('oak', 'hang').state, 'error');
	} finally {
		await CloseAllMcpSessions();
		SetMcpPathForTest('');
	}
});

test('KickMcpForHouse starts enabled servers and skips disabled packs', async () => {
	const dir = TempDir('loci-mcp-kick-');
	SetMcpPathForTest(path.join(dir, 'mcp.json'));
	const housesRoot = path.join(TempDir('loci-mcp-kick-houses-'), 'houses');
	WriteMcpText(JSON.stringify({
		mcpServers: {
			hang: { command: process.execPath, args: [delayExit] },
			off: { command: 'loci-mcp-should-not-spawn', args: [] }
		}
	}));
	const house = { slug: 'pine', path: path.join(housesRoot, 'pine'), workspaces: [] };
	PatchHouseConfig(housesRoot, 'pine', {
		tool_packs: {
			loci: { enabled: true, disabled: ['run_command'] },
			agpi: { enabled: true, disabled: [] },
			hang: { enabled: true, disabled: [] },
			off: { enabled: false, disabled: [] }
		}
	});
	try {
		KickMcpForHouse(housesRoot, house);
		assert.equal(PeekMcpStatus('pine', 'hang').state, 'connecting');
		assert.equal(PeekMcpStatus('pine', 'off').state, 'stopped');
		const rows = await ListPacksForHouse(housesRoot, house);
		assert.equal(rows.find((r) => r.id === 'hang').status, 'connecting');
		assert.equal(rows.find((r) => r.id === 'off').status, 'off');
		await WaitMcpForSlug('pine');
		assert.equal(PeekMcpStatus('pine', 'hang').state, 'error');
		assert.equal(PeekMcpStatus('pine', 'off').state, 'stopped');
	} finally {
		await CloseAllMcpSessions();
		SetMcpPathForTest('');
	}
});
