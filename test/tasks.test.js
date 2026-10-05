import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallAgpi } from '../src/agpi.js';
import { HouseAlarmsPaused, WaitingOnUser } from '../src/world.js';
import {
	AssignLabel,
	CabinetBoard,
	CountTasks,
	SummarizeCabinet,
	CreateTask,
	HouseAddress,
	ListTasks,
	RemoveTask,
	StampTask,
	SubmitTask,
	TASK_CAP,
	UpdateTaskNotes,
	FormatStampWake
} from '../src/tasks.js';
import { CallTool } from '../src/tools.js';

function House(root, extra) {
	const dir = fs.mkdtempSync(path.join(root || os.tmpdir(), 'loci-tasks-'));
	fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({
		room: 'office',
		turns: 0,
		waiting_on_user: { kind: 'notify', text: 'still waiting' }
	}, null, '\t') + '\n', 'utf8');
	return { path: dir, slug: 'maple', group: 'grove', name: 'Maple', ...extra };
}

test('HouseAddress is slug@group, or slug when solitary', () => {
	assert.equal(HouseAddress('maple', 'grove'), 'maple@grove');
	assert.equal(HouseAddress('maple', ''), 'maple');
	assert.equal(HouseAddress('', 'grove'), '');
	assert.equal(AssignLabel('tester', 'tester'), 'Assign task to tester');
});

test('CreateTask writes tasks/ markdown and does not wake', () => {
	const house = House(os.tmpdir());
	const board = CreateTask(house, { title: 'File the oak samples', body: 'Shelf B.' });
	assert.equal(board.address, 'maple@grove');
	assert.equal(board.assign_to, 'Assign task to Maple');
	assert.equal(board.count, 1);
	assert.equal(board.items[0].status, 'in-progress');
	assert.equal(board.items[0].title, 'File the oak samples');
	assert.equal(board.items[0].assigned, 'maple@grove');
	assert.equal(board.items[0].file, 'file-the-oak-samples.md');
	const text = fs.readFileSync(path.join(house.path, 'tasks', 'file-the-oak-samples.md'), 'utf8');
	assert.match(text, /^---\nstatus: in-progress\ntitle: File the oak samples\nassigned: maple@grove\nat: /);
	assert.match(text, /Shelf B\./);
	const world = JSON.parse(fs.readFileSync(path.join(house.path, 'world.json'), 'utf8'));
	assert.equal(world.waiting_on_user.kind, 'notify');
	assert.equal(world.waiting_on_user.text, 'still waiting');
});

test('UpdateTaskNotes edits the body; RemoveTask deletes the file', () => {
	const house = House(os.tmpdir());
	CreateTask(house, { title: 'Draft the letter', body: 'Keep the closing.' });
	const saved = UpdateTaskNotes(house, 'draft-the-letter.md', 'Shorter close.');
	assert.equal(saved.items[0].body.trim(), 'Shorter close.');
	RemoveTask(house, 'draft-the-letter.md');
	assert.equal(CountTasks(house.path), 0);
});

test('CreateTask caps at 16 and refuses a blank title', () => {
	const house = House(os.tmpdir());
	assert.throws(() => CreateTask(house, { title: '  ' }), /title/i);
	for (let i = 0; i < TASK_CAP; i++) CreateTask(house, { title: 'Note ' + i });
	assert.equal(CountTasks(house.path), TASK_CAP);
	assert.throws(() => CreateTask(house, { title: 'One more' }), /full/);
	const listed = ListTasks(house);
	assert.equal(listed.items.length, TASK_CAP);
});

test('write_file cannot create a new task note', async () => {
	const house = House(os.tmpdir());
	fs.mkdirSync(path.join(house.path, 'tasks'), { recursive: true });
	fs.writeFileSync(path.join(house.path, 'tasks', 'existing.md'), '---\nstatus: in-progress\ntitle: Existing\nassigned: maple\nat: x\n---\nHi.\n', 'utf8');
	const ctx = { houseDir: house.path, name: 'Maple', slug: 'maple', workspaces: [], run_command: false };
	const created = await CallTool(ctx, 'write_file', { path: 'tasks/new.md', text: 'nope\n' });
	assert.equal(created.ok, false);
	assert.match(created.error, /Task Board/);
	const edited = await CallTool(ctx, 'edit_file', {
		path: 'tasks/existing.md',
		old_string: 'Hi.',
		new_string: 'Hello.'
	});
	assert.equal(edited.ok, true);
});

test('examine Task Board lists assigned notes', async () => {
	const house = House(os.tmpdir());
	CreateTask(house, { title: 'Check the porch' });
	const ctx = { houseDir: house.path, name: 'Maple', slug: 'maple', workspaces: [] };
	const seen = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'task_board' });
	assert.equal(seen.ok, true);
	assert.equal(seen.tasks.count, 1);
	assert.equal(seen.tasks.items[0].title, 'Check the porch');
	assert.equal(seen.tasks.items[0].status, 'in-progress');
});

test('submit moves a task and pauses only when nothing else is in progress', async () => {
	const house = House(os.tmpdir());
	CreateTask(house, { title: 'First' });
	CreateTask(house, { title: 'Second' });
	const ctx = { houseDir: house.path, name: 'Maple', slug: 'maple', group: 'grove', workspaces: [] };
	const first = await CallAgpi(ctx, 'send_action', {
		action: 'submit',
		target: 'approval_tray',
		payload: JSON.stringify({ task: 'First', work: 'Did the first thing.' })
	});
	assert.equal(first.ok, true);
	assert.equal(first.paused, false);
	assert.equal(first.halt, undefined);
	assert.equal(first.in_progress, 1);
	assert.equal(first.waiting, 1);
	assert.equal(first.description, undefined);
	assert.equal(first.actions, undefined);
	assert.equal(first.tasks, undefined);
	assert.equal(WaitingOnUser(house.path).kind, 'notify');

	const second = await CallAgpi(ctx, 'send_action', {
		action: 'submit',
		target: 'approval_tray',
		payload: { task: 'second.md', work: 'Did the second thing.' }
	});
	assert.equal(second.ok, true);
	assert.equal(second.paused, true);
	assert.equal(second.halt, 'approval');
	assert.equal(second.waiting, 2);
	assert.equal(WaitingOnUser(house.path).kind, 'approval');
	assert.equal(WaitingOnUser(house.path).task, 'second.md');
	assert.equal(HouseAlarmsPaused(house.path, { enabled: true, max_turns: 0 }), true);
});

test('approve leaves a completed note; file writes the cabinet; drop archives', async () => {
	const house = House(os.tmpdir());
	CreateTask(house, { title: 'Shelf notes', body: 'Oak samples.' });
	CreateTask(house, { title: 'Still open' });
	SubmitTask(house, { task: 'Shelf notes', work: 'Shelved on B.' });
	const good = StampTask(house, 'shelf-notes.md', 'good');
	assert.equal(good.verdict, 'good');
	assert.equal(good.board.items.find((t) => t.file === 'shelf-notes.md').status, 'completed');
	assert.equal(fs.existsSync(path.join(house.path, 'tasks', 'shelf-notes.md')), true);
	assert.equal(fs.existsSync(path.join(house.path, 'cabinet')), false);

	const ctx = { houseDir: house.path, name: 'Maple', slug: 'maple', group: 'grove', workspaces: [] };
	const filed = await CallAgpi(ctx, 'send_action', {
		action: 'file',
		target: 'cabinet',
		payload: { task: 'Shelf notes', note: 'Filed after approve.' }
	});
	assert.equal(filed.ok, true);
	assert.match(filed.dossier, /^cabinet\/\d{4}-\d{2}-\d{2}-shelf-notes\.md$/);
	assert.equal(filed.records, undefined);
	assert.equal(filed.description, undefined);
	assert.equal(fs.existsSync(path.join(house.path, 'tasks', 'shelf-notes.md')), false);
	assert.equal(fs.existsSync(path.join(house.path, filed.dossier)), true);
	assert.equal(fs.existsSync(path.join(house.path, 'cabinet', 'RECORDS.md')), false);
	const dossier = fs.readFileSync(path.join(house.path, filed.dossier), 'utf8');
	const dossierBody = dossier.split('\n---\n')[1] || '';
	assert.match(dossierBody, /^Oak samples\.\n\n## Work done \(\d{4}-\d{2}-\d{2}T/);
	assert.match(dossier, /## Filing note\n\nFiled after approve/);
	assert.equal(/## Task notes/.test(dossier), false);
	const look = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'cabinet' });
	assert.equal(look.dossiers.count, 1);
	assert.equal(look.dossiers.items[0].file, filed.dossier);
	assert.equal(look.dossiers.items[0].title, 'Shelf notes');

	SubmitTask(house, { task: 'Still open', work: 'Need a look.' });
	const changed = StampTask(house, 'still-open.md', 'change');
	assert.equal(changed.verdict, 'change');
	assert.equal(changed.board.items.find((t) => t.file === 'still-open.md').status, 'in-progress');

	SubmitTask(house, { task: 'Still open', work: 'Second try.' });
	const dropped = StampTask(house, 'still-open.md', 'drop', 'Not the right shelf.');
	assert.equal(dropped.archived, 'archive/tasks/still-open.md');
	assert.equal(dropped.board.items.find((t) => t.file === 'still-open.md'), undefined);
	const archived = fs.readFileSync(path.join(house.path, dropped.archived), 'utf8');
	assert.match(archived, /status: dropped/);
	assert.match(archived, /## Dropped\n\nNot the right shelf\./);

	fs.writeFileSync(path.join(house.path, 'NOTES.md'), 'scratch\n', 'utf8');
	const hidden = await CallTool(ctx, 'search_files', { mode: 'glob', pattern: '**/*' });
	assert.equal(hidden.ok, true, hidden.error);
	assert.equal(hidden.matches.some((m) => String(m.path).startsWith('archive/')), false);
	const shown = await CallTool(ctx, 'search_files', { mode: 'glob', pattern: '**/*', path: 'archive' });
	assert.equal(shown.ok, true, shown.error);
	assert.equal(shown.matches.some((m) => m.path === 'archive/tasks/still-open.md' || m.path === 'tasks/still-open.md'), true);
});

test('submit stores work under a body heading, not YAML', () => {
	const house = House(os.tmpdir());
	CreateTask(house, { title: 'Shelf notes', body: 'Oak samples.' });
	SubmitTask(house, {
		task: 'Shelf notes',
		work: 'Shelved on B.\n\n- **bold** item: value'
	});
	const text = fs.readFileSync(path.join(house.path, 'tasks', 'shelf-notes.md'), 'utf8');
	const parts = text.split('\n---\n');
	assert.equal(parts.length >= 2, true);
	assert.equal(/work:/.test(parts[0]), false);
	assert.match(text, /## Work done \(\d{4}-\d{2}-\d{2}T[^\n]*\)\n\nShelved on B\./);
	assert.match(text, /Shelved on B\.\n\n- \*\*bold\*\* item: value/);
	const listed = ListTasks(house).items[0];
	assert.match(listed.work, /## Work done \(/);
	assert.equal(listed.work_log.length, 1);
	assert.match(listed.work_log[0].text, /Shelved on B\.\n\n- \*\*bold\*\* item: value/);
	assert.equal(listed.body.trim(), 'Oak samples.');
	assert.match(listed.markdown, /Oak samples\.\n\n## Work done \(/);
	StampTask(house, 'shelf-notes.md', 'change');
	const saved = UpdateTaskNotes(house, 'shelf-notes.md', 'Shorter close.');
	assert.equal(saved.items[0].body.trim(), 'Shorter close.');
	assert.match(saved.items[0].work, /Shelved on B\./);
	SubmitTask(house, { task: 'Shelf notes', work: 'Second pass with a colon: ok.' });
	const again = fs.readFileSync(path.join(house.path, 'tasks', 'shelf-notes.md'), 'utf8');
	assert.match(again, /Shelved on B\./);
	assert.match(again, /Second pass with a colon: ok\./);
	assert.equal(again.split('## Work done (').length - 1, 2);
	assert.equal(/### /.test(again), false);
});

test('FormatStampWake is the default change-this line', () => {
	assert.equal(
		FormatStampWake({ verdict: 'good', task: { title: 'Test Task' } }),
		'System message: The user stamped Approve on "Test Task". It is completed. File it in the Filing Cabinet.'
	);
	assert.equal(
		FormatStampWake({ verdict: 'change', task: { title: 'Test Task' } }),
		'System message: The user asked for changes on "Test Task". It is in progress again.'
	);
});

test('CabinetBoard lists every dossier newest first', () => {
	const house = House(os.tmpdir());
	assert.equal(CabinetBoard(house.path).count, 0);
	const dir = path.join(house.path, 'cabinet');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, '.keep'), '', 'utf8');
	fs.writeFileSync(path.join(dir, 'RECORDS.md'), 'legacy\n', 'utf8');
	const older = '---\ntitle: First\n---\nA.\n';
	const newer = '---\ntitle: Second\n---\nB.\n';
	fs.writeFileSync(path.join(dir, '2026-01-01-first.md'), older, 'utf8');
	fs.writeFileSync(path.join(dir, '2026-09-19-second.md'), newer, 'utf8');
	const board = CabinetBoard(house.path);
	assert.equal(board.count, 2);
	assert.equal(board.items[0].file, 'cabinet/2026-09-19-second.md');
	assert.equal(board.items[0].title, 'Second');
	assert.equal(board.items[0].date, '2026-09-19');
	assert.equal(board.items[1].title, 'First');
	assert.equal(board.items[1].date, '2026-01-01');
	for (let i = 0; i < 8; i++) {
		const n = String(i).padStart(2, '0');
		fs.writeFileSync(path.join(dir, '2026-02-' + n + '-extra.md'), '---\ntitle: Extra ' + n + '\n---\n', 'utf8');
	}
	const summarized = SummarizeCabinet(house.path);
	assert.equal(summarized.count, 10);
	assert.equal(summarized.items.length, 8);
	assert.equal(summarized.items[0].title, 'Second');
	assert.equal(summarized.items[0].date, undefined);
});
