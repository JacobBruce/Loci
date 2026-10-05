import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StoryBoard } from '../src/stories.js';
import { CallTool } from '../src/tools.js';

function House() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'loci-story-'));
}

test('StoryBoard lists folders then markdown, one level at a time', () => {
	const dir = House();
	assert.equal(StoryBoard(dir, '').atRoot, true);
	assert.equal(StoryBoard(dir, '').items.length, 0);
	const root = path.join(dir, 'stories', 'skyrim');
	fs.mkdirSync(path.join(root, 'lydia'), { recursive: true });
	fs.writeFileSync(path.join(root, 'HISTORY.md'), '# History\n', 'utf8');
	fs.writeFileSync(path.join(root, 'notes.txt'), 'nope\n', 'utf8');
	fs.writeFileSync(path.join(root, '.hidden.md'), 'nope\n', 'utf8');
	fs.writeFileSync(path.join(root, 'lydia', 'PROFILE.md'), '# Lydia\n', 'utf8');
	const top = StoryBoard(dir, '');
	assert.equal(top.path, 'stories/');
	assert.deepEqual(top.items.map((row) => row.name), ['skyrim']);
	assert.equal(top.items[0].kind, 'dir');
	const game = StoryBoard(dir, 'skyrim');
	assert.equal(game.atRoot, false);
	assert.equal(game.parent, '');
	assert.deepEqual(game.items.map((row) => row.name), ['lydia', 'HISTORY.md']);
	assert.equal(game.items[0].kind, 'dir');
	assert.equal(game.items[1].file, 'stories/skyrim/HISTORY.md');
	const who = StoryBoard(dir, 'skyrim/lydia');
	assert.equal(who.parent, 'skyrim');
	assert.deepEqual(who.items.map((row) => row.file), ['stories/skyrim/lydia/PROFILE.md']);
	assert.throws(() => StoryBoard(dir, 'skyrim/../SOUL.md'), /not allowed/);
});

test('stories/ accepts markdown and refuses other files', async () => {
	const houseDir = House();
	const ctx = { houseDir, workspaces: [] };
	const ok = await CallTool(ctx, 'write_file', {
		path: 'stories/skyrim/lydia/PROFILE.md',
		text: '# Lydia\nA guard.\n'
	});
	assert.equal(ok.ok, true);
	assert.equal(ok.path, 'stories/skyrim/lydia/PROFILE.md');
	const read = await CallTool(ctx, 'read_file', { path: 'stories/skyrim/lydia/PROFILE.md' });
	assert.match(read.text, /A guard/);
	const png = await CallTool(ctx, 'write_file', { path: 'stories/skyrim/shot.png', text: 'x' });
	assert.equal(png.ok, false);
	assert.match(png.error, /markdown/);
	const folder = await CallTool(ctx, 'write_file', { path: 'stories/skyrim', text: 'x' });
	assert.equal(folder.ok, false);
});
