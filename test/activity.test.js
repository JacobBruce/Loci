import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ActivityFromTool, SearchActivity } from '../src/activity.js';
import { CallTool } from '../src/tools.js';
import { PalacePose } from '../src/world.js';

function Setup() {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-activity-'));
	const houseDir = path.join(base, 'house');
	const workspace = path.join(base, 'project');
	fs.mkdirSync(path.join(houseDir, 'cabinet', 'old'), { recursive: true });
	fs.mkdirSync(path.join(workspace, 'src', 'deep'), { recursive: true });
	const lociHome = path.join(base, 'loci');
	fs.mkdirSync(path.join(lociHome, 'skills'), { recursive: true });
	fs.writeFileSync(path.join(houseDir, 'NOTES.md'), '# Notes\n', 'utf8');
	return {
		houseDir,
		workspace,
		ctx: { houseDir, workspaces: [workspace], lociHome, name: 'Maple', slug: 'maple' }
	};
}

test('searching with no path or the house root says house', () => {
	const { ctx, houseDir } = Setup();
	assert.equal(SearchActivity(undefined, ctx), 'Searching house');
	assert.equal(SearchActivity('', ctx), 'Searching house');
	assert.equal(SearchActivity('.', ctx), 'Searching house');
	assert.equal(SearchActivity(houseDir, ctx), 'Searching house');
});

test('searching a house folder names the top folder at any depth', () => {
	const { ctx, houseDir } = Setup();
	assert.equal(SearchActivity('cabinet', ctx), 'Searching cabinet');
	assert.equal(SearchActivity('cabinet/', ctx), 'Searching cabinet');
	assert.equal(SearchActivity('./cabinet/old', ctx), 'Searching cabinet');
	assert.equal(SearchActivity(path.join(houseDir, 'cabinet', 'old'), ctx), 'Searching cabinet');
	assert.equal(SearchActivity('cabinet/old/2026.md', ctx), 'Searching cabinet');
});

test('a file at the top of the house is not named as a folder', () => {
	const { ctx } = Setup();
	assert.equal(SearchActivity('NOTES.md', ctx), 'Searching house');
});

test('anywhere in a workspace says workspace, not the folder name', () => {
	const { ctx, workspace } = Setup();
	assert.equal(SearchActivity(workspace, ctx), 'Searching workspace');
	assert.equal(SearchActivity(path.join(workspace, 'src'), ctx), 'Searching workspace');
	assert.equal(SearchActivity(path.join(workspace, 'src', 'deep'), ctx), 'Searching workspace');
	assert.equal(SearchActivity('src', ctx), 'Searching workspace');
});

test('shared rule and skill folders are named, and bad paths do not throw', () => {
	const { ctx } = Setup();
	assert.equal(SearchActivity('loci-skills/', ctx), 'Searching loci-skills');
	assert.equal(SearchActivity('../outside', ctx), 'Searching files');
	assert.equal(SearchActivity('/definitely/not/here', ctx), 'Searching files');
});

test('ActivityFromTool uses the search label and keeps the file wording', () => {
	const { ctx, workspace } = Setup();
	const search = { name: 'search_files', arguments: { mode: 'glob', pattern: '*', path: path.join(workspace, 'src') } };
	assert.equal(ActivityFromTool(search, undefined, ctx), 'Searching workspace');
	assert.equal(ActivityFromTool({ name: 'search_files', arguments: { mode: 'grep', pattern: 'x' } }, undefined, ctx), 'Searching house');
	assert.equal(ActivityFromTool({ name: 'read_file', arguments: { path: '/home/me/Loci/a.js' } }), 'Reading a file');
	assert.equal(ActivityFromTool({ name: 'write_file', arguments: { path: 'a.md' } }), 'Writing a file');
	assert.equal(ActivityFromTool({ name: 'edit_file', arguments: { path: 'a.md' } }), 'Editing a file');
});

test('set_status has no activity of its own and tool calls do not change it', async () => {
	const { ctx, houseDir } = Setup();
	const call = { name: 'send_action', arguments: { action: 'set_status', target: 'pc', payload: 'curious' } };
	assert.equal(ActivityFromTool(call, undefined, ctx), '');
	const set = await CallTool(ctx, 'send_action', call.arguments);
	assert.equal(set.ok, true);
	assert.equal(ActivityFromTool(call, set, ctx), '');
	await CallTool(ctx, 'read_file', { path: 'NOTES.md' });
	await CallTool(ctx, 'search_files', { mode: 'glob', pattern: '*', path: 'cabinet' });
	await CallTool(ctx, 'send_action', { action: 'examine', target: 'clock' });
	await CallTool(ctx, 'send_action', { action: 'go', target: 'library' });
	assert.equal(PalacePose(houseDir).status, 'curious');
	const cleared = await CallTool(ctx, 'send_action', { action: 'set_status', target: 'pc', payload: '' });
	assert.equal(cleared.ok, true);
	assert.equal(PalacePose(houseDir).status, '');
});
