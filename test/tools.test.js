import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallTool, ToolSpecs } from '../src/tools.js';

function TempDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('search_files without path stays in the house', async () => {
	const houseDir = TempDir('loci-search-house-');
	const ws = TempDir('loci-search-ws-');
	fs.writeFileSync(path.join(houseDir, 'NOTES.md'), 'palace\n', 'utf8');
	fs.writeFileSync(path.join(ws, 'secret.txt'), 'workspace\n', 'utf8');
	const ctx = { houseDir, workspaces: [ws], name: 'Maple', slug: 'maple' };

	const listed = await CallTool(ctx, 'search_files', { mode: 'glob', pattern: '*' });
	assert.equal(listed.ok, true);
	assert.ok(listed.matches.some((m) => m.path === 'NOTES.md' && m.root === 'house'));
	assert.equal(listed.matches.some((m) => m.path === 'secret.txt'), false);

	const wsHit = await CallTool(ctx, 'search_files', { mode: 'glob', pattern: '*', path: ws });
	assert.equal(wsHit.ok, true);
	assert.ok(wsHit.matches.some((m) => m.path === 'secret.txt' && m.root === 'workspace'));
});

test('relative path is ambiguous when two workspaces share it', async () => {
	const houseDir = TempDir('loci-amb-house-');
	const a = TempDir('loci-amb-a-');
	const b = TempDir('loci-amb-b-');
	fs.mkdirSync(path.join(a, 'src'));
	fs.mkdirSync(path.join(b, 'src'));
	fs.writeFileSync(path.join(a, 'src', 'main.js'), 'a\n', 'utf8');
	fs.writeFileSync(path.join(b, 'src', 'main.js'), 'b\n', 'utf8');
	const ctx = { houseDir, workspaces: [a, b], name: 'Maple', slug: 'maple' };
	const hit = await CallTool(ctx, 'read_file', { path: 'src/main.js' });
	assert.equal(hit.ok, false);
	assert.match(hit.error, /ambiguous/);
	const abs = await CallTool(ctx, 'read_file', { path: path.join(a, 'src', 'main.js') });
	assert.equal(abs.ok, true);
	assert.match(abs.text, /a/);
	assert.equal(abs.root, 'workspace');
});

test('chat_history surfaces folded turns, not session.jsonl', async () => {
	const houseDir = TempDir('loci-history-');
	fs.writeFileSync(path.join(houseDir, 'session.jsonl'), [
		JSON.stringify({ role: 'user', content: 'U1' }),
		JSON.stringify({ role: 'assistant', content: 'A1' }),
		JSON.stringify({ role: 'user', content: 'U2' }),
		JSON.stringify({ role: 'compact', content: 'folded U1 A1', _loci_compact: true, compact_count: 1, keep_back: 1 })
	].join('\n') + '\n', 'utf8');
	const ctx = { houseDir, name: 'Maple', slug: 'maple' };
	const probe = await CallTool(ctx, 'chat_history', {});
	assert.equal(probe.ok, true);
	assert.equal(probe.hidden, 2);
	const row = await CallTool(ctx, 'chat_history', { start: -2, end: -1 });
	assert.equal(row.ok, true);
	assert.equal(row.messages[0].content, 'U1');
	assert.equal(row.messages[1].content, 'A1');
});

function CommandCtx(extra) {
	const houseDir = TempDir('loci-cmd-house-');
	const ws = TempDir('loci-cmd-ws-');
	return { houseDir, workspaces: [ws], name: 'Maple', slug: 'maple', run_command: true, ...extra };
}

test('run_command returns output and exit code', { skip: process.platform === 'win32' }, async () => {
	const out = await CallTool(CommandCtx(), 'run_command', { command: 'echo hi; echo err >&2; exit 3' });
	assert.equal(out.ok, true);
	assert.equal(out.stdout, 'hi\n');
	assert.equal(out.stderr, 'err\n');
	assert.equal(out.exit_code, 3);
	assert.equal(out.timed_out, undefined);
});

test('run_command timeout kills the whole tree, not only the shell', { skip: process.platform === 'win32' }, async () => {
	const started = Date.now();
	// The subshell keeps stdout open; killing only the shell used to leave it holding the pipe.
	const out = await CallTool(CommandCtx(), 'run_command', { command: '(sleep 30); echo never', timeout_ms: 300 });
	assert.equal(out.ok, true);
	assert.equal(out.timed_out, true);
	assert.equal(out.stdout, '');
	assert.ok(Date.now() - started < 5000);
});

test('run_command stops when the turn is stopped', { skip: process.platform === 'win32' }, async () => {
	const controller = new AbortController();
	const started = Date.now();
	setTimeout(() => controller.abort(), 200);
	const out = await CallTool(CommandCtx({ signal: controller.signal }), 'run_command', { command: 'sleep 30' });
	assert.equal(out.ok, true);
	assert.equal(out.stopped, true);
	assert.ok(Date.now() - started < 5000);
});

test('run_command does not wait on a background job that holds the pipes', { skip: process.platform === 'win32' }, async () => {
	const started = Date.now();
	const out = await CallTool(CommandCtx(), 'run_command', { command: 'sleep 3 & echo started' });
	assert.equal(out.ok, true);
	assert.equal(out.stdout, 'started\n');
	assert.equal(out.exit_code, 0);
	assert.ok(Date.now() - started < 2800);
});

test('private house files stay unreadable whatever the case', async () => {
	const houseDir = TempDir('loci-case-house-');
	fs.writeFileSync(path.join(houseDir, 'house.json'), '{}\n', 'utf8');
	const ctx = { houseDir, workspaces: [], name: 'Maple', slug: 'maple' };
	for (const name of ['house.json', 'House.JSON', 'WORLD.json']) {
		const out = await CallTool(ctx, 'read_file', { path: path.join(houseDir, name) });
		assert.equal(out.ok, false);
		assert.match(out.error, /not readable/);
	}
});

test('search_files glob expands {a,b} alternatives', async () => {
	const ws = TempDir('loci-brace-ws-');
	fs.mkdirSync(path.join(ws, 'src', 'deep'), { recursive: true });
	for (const rel of ['a.js', 'b.ts', 'c.md', 'src/d.js', 'src/deep/e.ts', 'x{y}.txt', 'p,q.txt']) {
		fs.writeFileSync(path.join(ws, rel), 'x\n', 'utf8');
	}
	const ctx = { houseDir: TempDir('loci-brace-house-'), workspaces: [ws], name: 'Maple', slug: 'maple' };
	const Glob = async (pattern) => {
		const out = await CallTool(ctx, 'search_files', { mode: 'glob', pattern, path: ws });
		assert.equal(out.ok, true);
		return out.matches.map((m) => m.path).sort();
	};
	assert.deepEqual(await Glob('*.{js,ts}'), ['a.js', 'b.ts']);
	assert.deepEqual(await Glob('**/*.{js,ts}'), ['a.js', 'b.ts', 'src/d.js', 'src/deep/e.ts']);
	assert.deepEqual(await Glob('{src/**/,}*.{js,{md,txt}}'), ['a.js', 'c.md', 'p,q.txt', 'src/d.js', 'x{y}.txt']);
	// One alternative or an unclosed brace stays literal, as in the shell.
	assert.deepEqual(await Glob('x{y}.txt'), ['x{y}.txt']);
	assert.deepEqual(await Glob('x{y*'), ['x{y}.txt']);
	assert.deepEqual(await Glob('p,q.txt'), ['p,q.txt']);
});

test('run_command keeps the start and the end of long output', { skip: process.platform === 'win32' }, async () => {
	const out = await CallTool(CommandCtx(), 'run_command', {
		command: 'echo FIRST; i=0; while [ $i -lt 20000 ]; do echo line$i; i=$((i+1)); done; echo LAST'
	});
	assert.equal(out.ok, true);
	assert.equal(out.truncated, true);
	assert.match(out.stdout, /^FIRST\n/);
	assert.match(out.stdout, /LAST\n$/);
	assert.match(out.stdout, /characters cut/);
	assert.ok(out.stdout.length < 40 * 1024);
});

test('run_command timeouts come from the runtime config', { skip: process.platform === 'win32' }, async () => {
	const ctx = CommandCtx({ command_timeout: 1, command_timeout_max: 2 });
	const started = Date.now();
	const def = await CallTool(ctx, 'run_command', { command: 'sleep 30' });
	assert.equal(def.timed_out, true);
	const asked = await CallTool(ctx, 'run_command', { command: 'sleep 30', timeout_ms: 60_000 });
	assert.equal(asked.timed_out, true);
	assert.ok(Date.now() - started < 8000);
	const spec = ToolSpecs(ctx).find((s) => s.function.name === 'run_command');
	assert.match(spec.function.parameters.properties.timeout_ms.description, /Default 1 s, max 2 s/);
});
