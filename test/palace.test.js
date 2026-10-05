import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallAgpi } from '../src/agpi.js';
import { PalaceCatalog } from '../src/world.js';
import { DiaryBoard, ReadHouseMarkdown, RevealHousePath } from '../src/house.js';
import { CallTool } from '../src/tools.js';

function TempHouse() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-palace-'));
	fs.mkdirSync(path.join(dir, 'diary'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'NOTES.md'), 'scratch\n', 'utf8');
	return dir;
}

test('PalaceCatalog lists user blurbs and task UIs, not agent descriptions', () => {
	const cat = PalaceCatalog();
	const notes = cat.objects.find((o) => o.id === 'notes');
	assert.equal(notes.name, 'Notebook');
	assert.equal(notes.blurb, 'The notebook. The agent uses it as a scratch pad for loose notes that shouldn\'t be a plan or a sticky note.');
	assert.deepEqual(notes.paths, ['NOTES.md']);
	assert.equal(notes.ui, 'md');
	assert.equal(cat.objects.find((o) => o.id === 'diary').ui, 'diary');
	assert.equal(cat.objects.find((o) => o.id === 'bed').ui, 'md');
	assert.equal(cat.objects.find((o) => o.id === 'soul_frame').ui, 'md');
	assert.equal(cat.objects.find((o) => o.id === 'user_portrait').ui, 'md');
	assert.equal(cat.objects.find((o) => o.id === 'rule_book').ui, 'playbook');
	assert.equal(cat.objects.find((o) => o.id === 'game_console').ui, 'game');
	assert.equal(cat.objects.find((o) => o.id === 'guest_book'), undefined);
	assert.equal(cat.rooms.some((r) => r.id === 'outside'), false);
	assert.equal(notes.description, undefined);
	const board = cat.objects.find((o) => o.id === 'task_board');
	assert.equal(board.ui, 'tasks');
	const tray = cat.objects.find((o) => o.id === 'approval_tray');
	assert.equal(tray.ui, 'tasks');
	const cal = cat.objects.find((o) => o.id === 'calendar');
	assert.deepEqual(cal.paths, ['calendar/', 'EVENTS']);
	assert.equal(cal.ui, 'calendar');
	const shelf = cat.objects.find((o) => o.id === 'book_shelf');
	assert.equal(shelf.ui, 'books');
	assert.equal(cat.objects.find((o) => o.id === 'cabinet').ui, 'cabinet');
	assert.equal(cat.objects.find((o) => o.id === 'chest').ui, 'chest');
	const story = cat.objects.find((o) => o.id === 'story_book');
	assert.equal(story.ui, 'stories');
	assert.equal(story.room, 'library');
	assert.deepEqual(story.paths, ['stories/']);
	const book = cat.objects.find((o) => o.id === 'address_book');
	assert.equal(book.ui, 'contacts');
	assert.match(book.blurb, /stable facts/);
	const pc = cat.objects.find((o) => o.id === 'pc');
	assert.deepEqual(pc.paths, ['BOOT.md', 'SYSTEM.md', 'LOGOFF.md', 'mail/']);
	assert.equal(pc.ui, 'pc');
	const clock = cat.objects.find((o) => o.id === 'clock');
	assert.deepEqual(clock.paths, []);
	assert.equal(clock.ui, 'clock');
	assert.equal(cat.objects.find((o) => o.id === 'alarm_clock').ui, 'alarm');
	assert.equal(cat.objects.find((o) => o.id === 'whiteboard').ui, 'whiteboard');
	const consoleObj = cat.objects.find((o) => o.id === 'game_console');
	assert.equal(consoleObj.name, 'Game Console');
	assert.equal(consoleObj.room, 'living');
	assert.equal(cat.rooms.length, 4);
	assert.equal(cat.rooms.find((r) => r.id === 'living').name, 'Living room');
});

test('examine does not include inspector blurb or ui', async () => {
	const houseDir = TempHouse();
	const seen = await CallAgpi({
		houseDir,
		name: 'Maple',
		slug: 'maple',
		workspaces: [],
		run_command: false
	}, 'send_action', { action: 'examine', target: 'notes' });
	assert.equal(seen.ok, true);
	assert.equal(seen.name, 'Notebook');
	assert.match(seen.description, /NOTES\.md/);
	assert.equal(seen.blurb, undefined);
	assert.equal(seen.ui, undefined);
});

test('game console is in the living room; outside is hidden', async () => {
	const houseDir = TempHouse();
	const ctx = {
		houseDir,
		name: 'Maple',
		slug: 'maple',
		workspaces: [],
		run_command: false
	};
	const gone = await CallAgpi(ctx, 'send_action', { action: 'go', target: 'outside' });
	assert.equal(gone.ok, false);
	const walked = await CallAgpi(ctx, 'send_action', { action: 'go', target: 'living room' });
	assert.equal(walked.ok, true);
	assert.equal(walked.target, 'living');
	assert.equal(walked.room.name, 'Living room');
	assert.equal(walked.walked, undefined);
	assert.equal(walked.from, undefined);
	assert.equal(walked.to, undefined);
	const oldId = await CallAgpi(ctx, 'send_action', { action: 'go', target: 'common' });
	assert.equal(oldId.ok, true);
	assert.equal(oldId.target, 'living');
	const listed = await CallAgpi(ctx, 'list_objects', {});
	assert.ok(listed.items.some((o) => o.id === 'rule_book'));
	assert.ok(listed.items.some((o) => o.id === 'game_console'));
	assert.equal(listed.items.some((o) => o.id === 'bicycle'), false);
	assert.equal(listed.items.some((o) => o.id === 'door'), false);
	const seen = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'console' });
	assert.equal(seen.ok, true);
	assert.equal(seen.target, 'game_console');
	assert.equal(seen.name, 'Game Console');
	assert.match(seen.description, /enables gaming mode/);
});

test('RevealHousePath stays in the house and walks up if missing', () => {
	const houseDir = TempHouse();
	const notes = RevealHousePath(houseDir, 'NOTES.md');
	assert.equal(notes, path.join(houseDir, 'NOTES.md'));
	const diary = RevealHousePath(houseDir, 'diary/');
	assert.equal(diary, path.join(houseDir, 'diary'));
	const missingPage = RevealHousePath(houseDir, 'diary/2099-01-01.md');
	assert.equal(missingPage, path.join(houseDir, 'diary'));
	assert.equal(RevealHousePath(houseDir, '../NOTES.md'), null);
	assert.equal(RevealHousePath(houseDir, '/etc/passwd'), null);
	assert.equal(RevealHousePath(houseDir, ''), null);
	const events = RevealHousePath(houseDir, 'EVENTS');
	assert.equal(events, houseDir);
});

test('ReadHouseMarkdown stays in the house and rejects missing files', () => {
	const houseDir = TempHouse();
	const notes = ReadHouseMarkdown(houseDir, 'NOTES.md');
	assert.equal(notes.file, 'NOTES.md');
	assert.equal(notes.text, 'scratch\n');
	assert.throws(() => ReadHouseMarkdown(houseDir, '../NOTES.md'), /not in this house/);
	assert.throws(() => ReadHouseMarkdown(houseDir, 'diary/2099-01-01.md'), /not found/);
	assert.throws(() => ReadHouseMarkdown(houseDir, 'ALARMS'), /not a markdown file/);
	fs.writeFileSync(path.join(houseDir, 'house.json'), '{}\n', 'utf8');
	assert.throws(() => ReadHouseMarkdown(houseDir, 'house.json'), /not a markdown file/);
});

test('DiaryBoard lists dated pages newest first', () => {
	const houseDir = TempHouse();
	assert.equal(DiaryBoard(houseDir).count, 0);
	fs.writeFileSync(path.join(houseDir, 'diary', '2026-01-01.md'), 'old\n', 'utf8');
	fs.writeFileSync(path.join(houseDir, 'diary', '2026-09-19.md'), 'new\n', 'utf8');
	const board = DiaryBoard(houseDir);
	assert.equal(board.items[0].file, 'diary/2026-09-19.md');
	assert.equal(board.items[0].date, '2026-09-19');
	assert.equal(board.items[1].file, 'diary/2026-01-01.md');
});

test('write_file cannot create EVENTS', async () => {
	const houseDir = TempHouse();
	const wrote = await CallTool({
		houseDir,
		name: 'Maple',
		slug: 'maple',
		workspaces: [],
		run_command: false
	}, 'write_file', { path: 'EVENTS', text: '2026-09-20 14:00 "x"\n' });
	assert.equal(wrote.ok, false);
	assert.match(wrote.error, /EVENTS|read-only/i);
	assert.equal(fs.existsSync(path.join(houseDir, 'EVENTS')), false);
});
