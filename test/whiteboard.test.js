import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallAgpi } from '../src/agpi.js';
import { CallTool } from '../src/tools.js';
import { CreateBoardItem, NOTE_CAP, PLAN_CAP, WhiteboardBoard } from '../src/whiteboard.js';

function House() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-board-'));
	fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({
		room: 'bedroom',
		turns: 0
	}, null, '\t') + '\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'NOTES.md'), 'scratch pad\n', 'utf8');
	return { path: dir, slug: 'maple', name: 'Maple' };
}

function Ctx(house) {
	return { houseDir: house.path, name: 'Maple', slug: 'maple', workspaces: [], run_command: false };
}

test('create_plan writes plans/ and walks to the office', async () => {
	const house = House();
	const ctx = Ctx(house);
	const made = await CallAgpi(ctx, 'send_action', {
		action: 'create_plan',
		target: 'whiteboard',
		payload: { title: 'Shelf rebuild', body: '1. Measure.\n2. Cut.' }
	});
	assert.equal(made.ok, true);
	assert.equal(made.file, 'plans/shelf-rebuild.md');
	assert.equal(made.title, 'Shelf rebuild');
	assert.equal(made.kind, 'plan');
	assert.equal(made.count, 1);
	assert.equal(made.cap, PLAN_CAP);
	assert.equal(made.description, undefined);
	assert.equal(made.walked, undefined);
	assert.equal(made.from, undefined);
	const text = fs.readFileSync(path.join(house.path, 'plans', 'shelf-rebuild.md'), 'utf8');
	assert.match(text, /^---\ntitle: Shelf rebuild\nat: /);
	assert.match(text, /1\. Measure\.\n2\. Cut\./);
	assert.equal(fs.readFileSync(path.join(house.path, 'NOTES.md'), 'utf8'), 'scratch pad\n');
});

test('create_note writes notes/ stickies, not NOTES.md', async () => {
	const house = House();
	const ctx = Ctx(house);
	const made = await CallAgpi(ctx, 'send_action', {
		action: 'create_note',
		target: 'whiteboard',
		payload: { title: 'Buy oak', body: 'Three boards.' }
	});
	assert.equal(made.ok, true);
	assert.equal(made.file, 'notes/buy-oak.md');
	assert.equal(made.kind, 'note');
	assert.equal(made.cap, NOTE_CAP);
	assert.equal(fs.existsSync(path.join(house.path, 'notes', 'buy-oak.md')), true);
	assert.equal(fs.readFileSync(path.join(house.path, 'NOTES.md'), 'utf8'), 'scratch pad\n');
});

test('examine whiteboard lists plans and stickies', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_plan',
		target: 'whiteboard',
		payload: { title: 'Shelf rebuild', body: 'Measure and cut.' }
	});
	await CallAgpi(ctx, 'send_action', {
		action: 'create_note',
		target: 'whiteboard',
		payload: { title: 'Buy oak' }
	});
	const seen = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'whiteboard' });
	assert.equal(seen.ok, true);
	assert.equal(seen.plans.count, 1);
	assert.equal(seen.plans.cap, PLAN_CAP);
	assert.equal(seen.plans.items[0].title, 'Shelf rebuild');
	assert.equal(seen.notes.count, 1);
	assert.equal(seen.notes.cap, NOTE_CAP);
	assert.equal(seen.notes.items[0].title, 'Buy oak');
	assert.ok(seen.paths.includes('plans/'));
	assert.ok(seen.paths.includes('notes/'));
});

test('remove_plan and remove_note delete by title', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_plan',
		target: 'whiteboard',
		payload: { title: 'Shelf rebuild', body: 'Measure and cut.' }
	});
	await CallAgpi(ctx, 'send_action', {
		action: 'create_note',
		target: 'whiteboard',
		payload: { title: 'Buy oak' }
	});
	const gonePlan = await CallAgpi(ctx, 'send_action', {
		action: 'remove_plan',
		target: 'whiteboard',
		payload: { plan: 'Shelf rebuild' }
	});
	assert.equal(gonePlan.ok, true);
	assert.equal(gonePlan.count, 0);
	assert.equal(fs.existsSync(path.join(house.path, 'plans', 'shelf-rebuild.md')), false);
	const goneNote = await CallAgpi(ctx, 'send_action', {
		action: 'remove_note',
		target: 'whiteboard',
		payload: { note: 'Buy oak' }
	});
	assert.equal(goneNote.ok, true);
	assert.equal(fs.existsSync(path.join(house.path, 'notes', 'buy-oak.md')), false);
});

test('plan cap is 16; sticky cap is 32', async () => {
	const house = House();
	const ctx = Ctx(house);
	assert.equal(PLAN_CAP, 16);
	assert.equal(NOTE_CAP, 32);
	for (let i = 0; i < PLAN_CAP; i++) {
		const made = await CallAgpi(ctx, 'send_action', {
			action: 'create_plan',
			target: 'whiteboard',
			payload: { title: 'Plan ' + i, body: 'Step one.' }
		});
		assert.equal(made.ok, true, made.error);
	}
	const fullPlan = await CallAgpi(ctx, 'send_action', {
		action: 'create_plan',
		target: 'whiteboard',
		payload: { title: 'One more plan', body: 'Step one.' }
	});
	assert.equal(fullPlan.ok, false);
	assert.match(fullPlan.error, /full of plans \(16\)/);
	for (let i = 0; i < NOTE_CAP; i++) {
		const made = await CallAgpi(ctx, 'send_action', {
			action: 'create_note',
			target: 'whiteboard',
			payload: { title: 'Sticky ' + i }
		});
		assert.equal(made.ok, true, made.error);
	}
	const fullNote = await CallAgpi(ctx, 'send_action', {
		action: 'create_note',
		target: 'whiteboard',
		payload: { title: 'One more sticky' }
	});
	assert.equal(fullNote.ok, false);
	assert.match(fullNote.error, /full of sticky notes \(32\)/);
});

test('write_file cannot create a plan or sticky; it may edit one', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_plan',
		target: 'whiteboard',
		payload: { title: 'Shelf rebuild', body: 'Hi.' }
	});
	const created = await CallTool(ctx, 'write_file', { path: 'plans/new.md', text: 'nope\n' });
	assert.equal(created.ok, false);
	assert.match(created.error, /create_plan/);
	const sticky = await CallTool(ctx, 'write_file', { path: 'notes/new.md', text: 'nope\n' });
	assert.equal(sticky.ok, false);
	assert.match(sticky.error, /create_note/);
	const edited = await CallTool(ctx, 'edit_file', {
		path: 'plans/shelf-rebuild.md',
		old_string: 'Hi.',
		new_string: 'Hello.'
	});
	assert.equal(edited.ok, true, edited.error);
	const listed = await CallTool(ctx, 'search_files', { mode: 'glob', pattern: '**/*', path: 'notes' });
	assert.equal(listed.ok, true, listed.error);
});

test('create_plan requires a body; create_note does not', () => {
	const house = House();
	assert.throws(
		() => CreateBoardItem(house, 'plan', { title: 'Empty plan' }),
		/plan body is required/i
	);
	const note = CreateBoardItem(house, 'note', { title: 'Title only' });
	assert.equal(note.file, 'notes/title-only.md');
	assert.equal(note.board.count, 1);
});

test('WhiteboardBoard adds a sticky preview and keeps plans title-only', () => {
	const house = House();
	CreateBoardItem(house, 'plan', { title: 'Shelf rebuild', body: '1. Measure.\n2. Cut a lot of oak for the long bench.' });
	CreateBoardItem(house, 'note', { title: 'Buy oak', body: 'Three boards from the yard.' });
	const board = WhiteboardBoard(house.path);
	assert.equal(board.plans.items[0].title, 'Shelf rebuild');
	assert.equal(board.plans.items[0].preview, undefined);
	assert.equal(board.notes.items[0].title, 'Buy oak');
	assert.equal(board.notes.items[0].preview, 'Three boards from the yard.');
	assert.equal(board.notes.items[0].file, 'notes/buy-oak.md');
});
