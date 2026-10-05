import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallAgpi, IsAgpiTool } from '../src/agpi.js';
import { BumpTurns, ClearNotifyWait, HouseAlarmsPaused, PalacePose, WaitingOnUser, WorldTurns } from '../src/world.js';
import { CreateHouse, ReadHouse, UpdateHouse } from '../src/house.js';
import { BuildSystemPrompt } from '../src/prompt.js';
import { CallTool, ToolSpecs } from '../src/tools.js';
import { StampFromDate } from '../src/events.js';

function TempHouse() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-agpi-'));
	fs.writeFileSync(path.join(dir, 'BOOT.md'), '# Boot\nChecklist.\n', 'utf8');
	return dir;
}

function SeedHouse(root, slug, meta) {
	const dir = path.join(root, slug);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'BOOT.md'), '# Boot\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'house.json'), JSON.stringify({
		name: meta.name || slug,
		description: meta.description || '',
		group: meta.group || '',
		enabled: meta.enabled !== false,
		project_manager: meta.project_manager === true,
		provider: meta.provider || '',
		model: meta.model || ''
	}, null, '\t') + '\n', 'utf8');
	return dir;
}

function Ctx(houseDir, extra) {
	return {
		houseDir,
		name: 'Maple',
		slug: 'maple',
		workspaces: [],
		run_command: false,
		...extra
	};
}

test('ToolSpecs exposes the AGPI tools, including send_msg and get_screen', () => {
	const names = ToolSpecs({}).map((s) => s.function.name);
	for (const name of ['list_actions', 'list_objects', 'send_action', 'send_msg', 'get_state', 'lock_body', 'get_screen']) {
		assert.ok(names.includes(name), name);
		assert.equal(IsAgpiTool(name), true);
	}
	assert.equal(names.includes('system_prompt'), false);
	assert.ok(names.includes('read_file'));
	assert.ok(names.includes('chat_history'));
	const send = ToolSpecs({}).find((s) => s.function.name === 'send_action');
	assert.deepEqual(Object.keys(send.function.parameters.properties).sort(), ['action', 'payload', 'target']);
	const objects = ToolSpecs({}).find((s) => s.function.name === 'list_objects');
	assert.deepEqual(Object.keys(objects.function.parameters.properties).sort(), ['limit', 'type']);
});

test('get_screen reads the game file and hides its path', async () => {
	const houseDir = TempHouse();
	const home = await CallAgpi(Ctx(houseDir), 'get_screen', {});
	assert.equal(home.ok, false);
	assert.match(home.error, /connected game/);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-shot-'));
	const file = path.join(dir, 'shot.png');
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	);
	fs.writeFileSync(file, png);
	let forwarded = null;
	const shot = await CallAgpi({
		gaming: true,
		forward_game: async (name, args) => {
			forwarded = { name, args };
			return { ok: true, path: file, extra: 'keep' };
		}
	}, 'get_screen', { size: 4000 });
	assert.deepEqual(forwarded, { name: 'get_screen', args: {} });
	assert.equal(shot.ok, true);
	assert.equal(shot.width, 1);
	assert.equal(shot.height, 1);
	assert.equal(shot.extra, undefined);
	assert.equal(JSON.stringify(shot).includes(file), false);
	assert.equal(shot.images[0].data, png.toString('base64'));
	const refused = await CallAgpi({
		gaming: true,
		forward_game: async () => ({ ok: false, error: 'This game has no screen.' })
	}, 'get_screen', {});
	assert.equal(refused.ok, false);
	assert.match(refused.error, /no screen/);
	const blank = await CallAgpi({
		gaming: true,
		forward_game: async () => ({ ok: true })
	}, 'get_screen', {});
	assert.match(blank.error, /path/);
});

test('Loci get_state is palace room plus house, not time or date', async () => {
	const houseDir = TempHouse();
	const st = await CallAgpi(Ctx(houseDir), 'get_state', {});
	assert.equal(st.ok, true);
	assert.equal(st.game, 'loci');
	assert.equal(st.room.id, 'office');
	assert.equal(st.house.slug, 'maple');
	assert.equal(st.house.group, '');
	assert.equal(typeof st.house.age_seconds, 'number');
	assert.equal(st.heartbeat.turns, 0);
	assert.equal(st.heartbeat.next, null);
	assert.deepEqual(st.heartbeat.alarms, []);
	assert.deepEqual(st.heartbeat.events, []);
	fs.writeFileSync(path.join(houseDir, 'EVENTS'), '2099-01-01 09:00 "stand-up"\n', 'utf8');
	const later = await CallAgpi(Ctx(houseDir), 'get_state', { query: 'heartbeat' });
	assert.equal(later.heartbeat.next, '2099-01-01T09:00');
	assert.deepEqual(later.heartbeat.events, [{ at: '2099-01-01 09:00', text: 'stand-up' }]);
	assert.equal(st.present, undefined);
	assert.deepEqual(st.group_members, []);
	assert.equal(st.time, undefined);
	assert.equal(st.date, undefined);
	assert.equal(st.location, undefined);
	assert.equal(st.items, undefined);
});

test('list_actions without target lists go; with target lists that object', async () => {
	const houseDir = TempHouse();
	const listed = await CallAgpi(Ctx(houseDir), 'list_actions', {});
	assert.equal(listed.ok, true);
	assert.equal(listed.items, undefined);
	const actions = listed.actions.map((a) => a.action);
	assert.deepEqual(actions, ['go']);
	assert.ok(listed.actions[0].how && listed.actions[0].when);

	const pc = await CallAgpi(Ctx(houseDir), 'list_actions', { target: 'pc' });
	assert.equal(pc.ok, true);
	assert.equal(pc.target, 'pc');
	assert.deepEqual(pc.actions.map((a) => a.action).sort(), [
		'boot', 'cancel_reminder', 'dm', 'download_file', 'examine', 'get_web_page', 'list_reminders', 'logoff', 'notify_user', 'search_web', 'send_mail', 'set_reminder', 'set_status'
	]);
	assert.ok(pc.actions.every((a) => a.how && a.when));
});

test('list_objects default scan is room items plus a compact types catalog', async () => {
	const houseDir = TempHouse();
	const listed = await CallAgpi(Ctx(houseDir), 'list_objects', {});
	assert.equal(listed.ok, true);
	assert.equal(listed.type, 'item');
	assert.equal(listed.room.id, 'office');
	assert.ok(listed.items.some((o) => o.id === 'pc' && o.type === 'item'));
	assert.ok(listed.items.some((o) => o.id === 'clock'));
	assert.deepEqual(listed.types.map((t) => t.id).sort(), ['exit', 'item']);
	assert.ok(listed.types.every((t) => t.when));

	const typed = await CallAgpi(Ctx(houseDir), 'list_objects', { type: 'item' });
	assert.equal(typed.ok, true);
	assert.equal(typed.types, undefined);
	assert.ok(typed.items.some((o) => o.id === 'pc'));

	const exits = await CallAgpi(Ctx(houseDir), 'list_objects', { type: 'exit' });
	assert.equal(exits.ok, true);
	assert.equal(exits.types, undefined);
	assert.ok(exits.items.some((o) => o.id === 'office' && o.type === 'exit'));

	const capped = await CallAgpi(Ctx(houseDir), 'list_objects', { limit: 1 });
	assert.equal(capped.items.length, 1);
	assert.ok(capped.types);

	const none = await CallAgpi(Ctx(houseDir), 'list_objects', { limit: 0 });
	assert.equal(none.items.length, 0);
	assert.ok(none.types);

	const bad = await CallAgpi(Ctx(houseDir), 'list_objects', { type: 'enemy' });
	assert.equal(bad.ok, false);
	assert.match(bad.error, /Unknown type: enemy/);
	assert.match(bad.error, /item, exit/);
});

test('lock_body is pre-locked to this resident; unknown target keeps the lock', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const card = await CallAgpi(ctx, 'lock_body', {});
	assert.equal(card.ok, true);
	assert.equal(card.connected, false);
	assert.equal(card.selected.id, 'maple');
	assert.equal(card.selected.name, 'Maple');
	assert.equal(card.selected.room, 'office');
	assert.equal(card.available.length, 1);
	assert.equal(card.available[0].id, 'maple');
	assert.equal(card.selected.verbs, undefined);

	const again = await CallAgpi(ctx, 'lock_body', { target: 'self' });
	assert.equal(again.ok, true);
	assert.equal(again.selected.id, 'maple');

	const named = await CallAgpi(ctx, 'lock_body', { target: 'Maple' });
	assert.equal(named.ok, true);

	const bad = await CallAgpi(ctx, 'lock_body', { target: 'lydia' });
	assert.equal(bad.ok, false);
	assert.match(bad.error, /lydia/);
	assert.match(bad.error, /unchanged/);
});

test('go, examine, and boot use action plus target', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const went = await CallTool(ctx, 'send_action', { action: 'go', target: 'bedroom' });
	assert.equal(went.ok, true);
	assert.equal(went.target, 'bedroom');
	assert.equal(went.moved, undefined);
	assert.equal(went.room.id, 'bedroom');
	assert.equal(JSON.parse(fs.readFileSync(path.join(houseDir, 'world.json'), 'utf8')).focus, undefined);
	const bedItems = await CallAgpi(ctx, 'list_objects', {});
	assert.equal(bedItems.room.id, 'bedroom');
	assert.equal(bedItems.items.some((o) => o.id === 'clock'), false);
	assert.ok(bedItems.items.some((o) => o.id === 'alarm_clock'));

	const exam = await CallTool(ctx, 'send_action', { action: 'examine', target: 'soul_frame' });
	assert.equal(exam.ok, true);
	assert.equal(exam.target, 'soul_frame');
	assert.equal(exam.room, 'bedroom');
	assert.deepEqual(exam.paths, ['SOUL.md']);
	assert.equal(exam.actions.some((a) => a.action === 'use'), false);
	assert.equal(JSON.parse(fs.readFileSync(path.join(houseDir, 'world.json'), 'utf8')).focus, 'soul_frame');

	const cal = await CallTool(ctx, 'send_action', { action: 'examine', target: 'calendar' });
	assert.equal(cal.ok, true);
	assert.match(cal.date, /^\d{4}-\d{2}-\d{2}$/);
	assert.equal(cal.time, undefined);
	assert.match(cal.utc_offset, /^[+-]\d{2}:\d{2}$/);
	assert.ok(cal.timezone);

	const clock = await CallTool(ctx, 'send_action', { action: 'examine', target: 'clock' });
	assert.equal(clock.ok, true);
	assert.equal(clock.room, 'office');
	assert.match(clock.time, /^\d{2}:\d{2}:\d{2}$/);
	assert.equal(typeof clock.elapsed_seconds, 'number');
	assert.match(clock.utc_offset, /^[+-]\d{2}:\d{2}$/);
	assert.ok(clock.timezone);

	const boot = await CallTool(ctx, 'send_action', { action: 'boot', target: 'pc' });
	assert.equal(boot.ok, true);
	assert.equal(boot.powered, true);
	assert.equal(boot.walked, undefined);
	assert.equal(boot.from, undefined);
	assert.equal(boot.paths, undefined);
	assert.equal(boot.actions, undefined);
	assert.equal(boot.description, undefined);
	assert.equal(boot.next, undefined);
	assert.equal(boot.time, undefined);
	assert.equal(boot.house, undefined);
	assert.match(boot.boot.text, /Checklist/);
	assert.equal(boot.logoff.text, '');
	assert.equal(boot.system, undefined);

	const world = JSON.parse(fs.readFileSync(path.join(houseDir, 'world.json'), 'utf8'));
	assert.match(world.booted_at, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(world.room, 'office');
	assert.equal(world.focus, 'pc');

	const here = await CallTool(ctx, 'get_state', { query: 'room' });
	assert.equal(here.room.id, 'office');
});

test('office clock reports elapsed seconds this turn', async () => {
	const houseDir = TempHouse();
	const started = Date.now() - 2500;
	const exam = await CallTool(Ctx(houseDir, { turn_started_at: started }), 'send_action', {
		action: 'examine',
		target: 'clock'
	});
	assert.equal(exam.ok, true);
	assert.match(exam.time, /^\d{2}:\d{2}:\d{2}$/);
	assert.ok(exam.elapsed_seconds >= 2);
});

test('boot inlines last logoff notes, not the ritual', async () => {
	const houseDir = TempHouse();
	fs.writeFileSync(path.join(houseDir, 'LOGOFF.md'), [
		'# Wind down',
		'',
		'Custom ritual step.',
		'',
		'## Logoff notes',
		'',
		'Finish the shelf notes.',
		''
	].join('\n'), 'utf8');
	const boot = await CallTool(Ctx(houseDir), 'send_action', { action: 'boot', target: 'pc' });
	assert.equal(boot.ok, true);
	assert.match(boot.logoff.text, /shelf notes/);
	assert.equal(boot.logoff.path, 'LOGOFF.md');
	assert.equal(/Wind down|Custom ritual/.test(boot.logoff.text), false);
});

test('unknown action and query return clear errors', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const badCmd = await CallTool(ctx, 'send_action', { action: 'explode' });
	assert.equal(badCmd.ok, false);
	assert.match(badCmd.error, /Unknown action: explode/);

	const use = await CallTool(ctx, 'send_action', { action: 'use', target: 'pc' });
	assert.equal(use.ok, false);
	assert.match(use.error, /Unknown action: use/);

	const badQuery = await CallTool(ctx, 'get_state', { query: 'inventory' });
	assert.equal(badQuery.ok, false);
	assert.match(badQuery.error, /Unknown query: inventory/);

	const badObj = await CallTool(ctx, 'list_actions', { target: 'spaceship' });
	assert.equal(badObj.ok, false);
	assert.match(badObj.error, /Unknown target/);
});

test('send_msg errors when no game is connected', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const msg = await CallTool(ctx, 'send_msg', { text: 'Hello Cedar', to: 'Cedar' });
	assert.equal(msg.ok, false);
	assert.match(msg.error, /No game is connected/);
	assert.equal(fs.existsSync(path.join(houseDir, 'world.json')), false);
});

test('disabled send_msg cannot be called through CallTool', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir, {
		tool_packs: {
			loci: { enabled: true, disabled: ['run_command'] },
			agpi: { enabled: true, disabled: ['send_msg'] }
		}
	});
	const msg = await CallTool(ctx, 'send_msg', { text: 'Hello Cedar' });
	assert.equal(msg.ok, false);
	assert.match(msg.error, /disabled/);
});

test('get_state group_members lists houses that share a group', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-houses-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove', project_manager: true });
	SeedHouse(root, 'cedar', {
		name: 'Cedar',
		group: 'grove',
		description: 'Writes tests.',
		provider: 'anthropic',
		model: 'claude-sonnet-5-5'
	});
	SeedHouse(root, 'lone', { name: 'Lone', group: '' });
	const ctx = Ctx(maple, { housesRoot: root, group: 'grove', slug: 'maple' });
	const brief = await CallAgpi(ctx, 'get_state', {});
	assert.deepEqual(brief.group_members.map((m) => m.slug), ['cedar']);
	assert.equal(brief.group_members[0].model, undefined);
	const st = await CallAgpi(ctx, 'get_state', { query: 'group' });
	assert.equal(st.ok, true);
	assert.equal(st.group, 'grove');
	assert.deepEqual(st.group_members.map((m) => m.slug), ['cedar']);
	const cedar = st.group_members[0];
	assert.equal(cedar.project_manager, false);
	assert.equal(cedar.description, 'Writes tests.');
	assert.equal(cedar.provider, 'anthropic');
	assert.equal(cedar.model, 'claude-sonnet-5-5');
	assert.equal(cedar.next, null);
	assert.deepEqual(cedar.alarms, []);
	assert.deepEqual(cedar.events, []);
	assert.equal(cedar.waiting_on_user, false);
	assert.equal(cedar.at_turn_limit, false);
	assert.equal(cedar.awake, false);
});

test('world.json is locked from write_file and read_file', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	await CallTool(ctx, 'send_action', { action: 'go', target: 'library' });
	const locked = await CallTool(ctx, 'write_file', { path: 'world.json', text: '{}' });
	assert.equal(locked.ok, false);
	assert.match(locked.error, /read-only/i);
	const unread = await CallTool(ctx, 'read_file', { path: 'world.json' });
	assert.equal(unread.ok, false);
	assert.match(unread.error, /not readable/i);
});

test('logoff writes notes and preserves a custom ritual', async () => {
	const houseDir = TempHouse();
	fs.writeFileSync(path.join(houseDir, 'LOGOFF.md'), [
		'# Wind down',
		'',
		'Custom ritual step.',
		'',
		'## Logoff notes',
		'',
		'old leftover',
		''
	].join('\n'), 'utf8');
	const ctx = Ctx(houseDir);
	const logged = await CallTool(ctx, 'send_action', {
		action: 'logoff',
		target: 'pc',
		payload: 'Finish the shelf notes.'
	});
	assert.equal(logged.ok, true);
	assert.equal(logged.action, 'logoff');
	assert.equal(logged.logoff.path, 'LOGOFF.md');
	assert.match(logged.logoff.text, /shelf notes/);

	const file = fs.readFileSync(path.join(houseDir, 'LOGOFF.md'), 'utf8');
	assert.match(file, /Custom ritual step/);
	assert.match(file, /^## Logoff notes$/m);
	assert.match(file, /Finish the shelf notes/);
	assert.equal(file.includes('old leftover'), false);

	const boot = await CallTool(ctx, 'send_action', { action: 'boot', target: 'pc' });
	assert.equal(boot.ok, true);
	assert.match(boot.logoff.text, /shelf notes/);
	assert.equal(/Custom ritual/.test(boot.logoff.text), false);
});

test('logoff appends ## Logoff notes when the user ritual has no such heading', async () => {
	const houseDir = TempHouse();
	fs.writeFileSync(path.join(houseDir, 'LOGOFF.md'), '# Close up\n\n1. Save the books.\n', 'utf8');
	const logged = await CallTool(Ctx(houseDir), 'send_action', {
		action: 'logoff',
		target: 'pc',
		payload: 'Continue the index tomorrow.'
	});
	assert.equal(logged.ok, true);
	const file = fs.readFileSync(path.join(houseDir, 'LOGOFF.md'), 'utf8');
	assert.match(file, /# Close up/);
	assert.match(file, /Save the books/);
	assert.match(file, /^## Logoff notes$/m);
	assert.match(file, /Continue the index tomorrow/);
});

test('file tools cannot write LOGOFF.md', async () => {
	const houseDir = TempHouse();
	fs.writeFileSync(path.join(houseDir, 'LOGOFF.md'), '# Logoff\n\n## Logoff notes\n', 'utf8');
	const ctx = Ctx(houseDir);
	const locked = await CallTool(ctx, 'write_file', { path: 'LOGOFF.md', text: 'hacked\n' });
	assert.equal(locked.ok, false);
	assert.match(locked.error, /logoff/i);
	const edited = await CallTool(ctx, 'edit_file', {
		path: 'LOGOFF.md',
		old_string: '# Logoff',
		new_string: '# Hacked'
	});
	assert.equal(edited.ok, false);
	const read = await CallTool(ctx, 'read_file', { path: 'LOGOFF.md' });
	assert.equal(read.ok, true);
});

test('examine pc and bed both link LOGOFF.md', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const pc = await CallTool(ctx, 'send_action', { action: 'examine', target: 'pc' });
	assert.equal(pc.ok, true);
	assert.deepEqual(pc.paths, ['BOOT.md', 'SYSTEM.md', 'LOGOFF.md', 'mail/']);
	assert.ok(pc.actions.some((a) => a.action === 'logoff'));

	const bed = await CallTool(ctx, 'send_action', { action: 'examine', target: 'bed' });
	assert.equal(bed.ok, true);
	assert.equal(bed.room, 'bedroom');
	assert.deepEqual(bed.paths, ['LOGOFF.md']);
	assert.equal(bed.actions.some((a) => a.action === 'sleep'), true);

	const wrong = await CallTool(ctx, 'send_action', { action: 'logoff', target: 'bed' });
	assert.equal(wrong.ok, false);
	assert.match(wrong.error, /pc/i);
});

test('new house appends Logoff notes after create; the form sees ritual only', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-houses-'));
	const root = path.join(tmp, 'houses');
	const house = CreateHouse(root, {
		name: 'Maple',
		description: 'A grove workstation.',
		group: 'grove',
		logoff: '# Wind down\n\nCustom step.\n'
	});
	const text = fs.readFileSync(path.join(house.path, 'LOGOFF.md'), 'utf8');
	assert.match(text, /Custom step/);
	assert.match(text, /^## Logoff notes$/m);
	const loaded = ReadHouse(root, house.slug);
	assert.match(loaded.logoff, /Custom step/);
	assert.equal(/^## Logoff notes/m.test(loaded.logoff), false);
	assert.equal(loaded.alarms, '');
	assert.equal(fs.existsSync(path.join(house.path, 'ALARMS')), true);
	assert.equal(fs.existsSync(path.join(house.path, 'EVENTS')), true);
	assert.equal(loaded.agent_events, true);

	fs.appendFileSync(path.join(house.path, 'LOGOFF.md'), '\nKeep this leftover.\n', 'utf8');
	UpdateHouse(root, house.slug, { logoff: '# Close up\n\nNew ritual.\n' });
	const after = fs.readFileSync(path.join(house.path, 'LOGOFF.md'), 'utf8');
	assert.match(after, /New ritual/);
	assert.match(after, /Keep this leftover/);
	assert.equal(after.includes('Custom step'), false);

	const prompt = BuildSystemPrompt(loaded);
	assert.match(prompt, /^Agent name: Maple$/m);
	assert.match(prompt, /^- You \(`maple`\)$/m);
	assert.match(prompt, /^Description: A grove workstation\.$/m);
	assert.match(prompt, /^Group: grove$/m);
	assert.match(prompt, /^Timezone: .+\(UTC[+-]\d{2}:\d{2}\)$/m);

	const timed = CreateHouse(root, { name: 'Timed', alarms: '0 9 * * * "daily 9:00"\n' });
	assert.match(ReadHouse(root, timed.slug).alarms, /daily 9:00/);
	UpdateHouse(root, timed.slug, { alarms: '*/15 * * * * "every 15 mins"\n' });
	assert.match(ReadHouse(root, timed.slug).alarms, /every 15 mins/);

	const lone = CreateHouse(root, { name: 'Lone' });
	const lonePrompt = BuildSystemPrompt(ReadHouse(root, lone.slug));
	assert.match(lonePrompt, /^Agent name: Lone$/m);
	assert.equal(/^Group:/m.test(lonePrompt), false);
	assert.equal(/^Description:/m.test(lonePrompt), false);
});

test('house.json and session.jsonl are unreadable', async () => {
	const houseDir = TempHouse();
	fs.writeFileSync(path.join(houseDir, 'house.json'), '{"name":"Maple"}\n', 'utf8');
	fs.writeFileSync(path.join(houseDir, 'session.jsonl'), '{"role":"user","content":"hi"}\n', 'utf8');
	const ctx = Ctx(houseDir);
	const house = await CallTool(ctx, 'read_file', { path: 'house.json' });
	assert.equal(house.ok, false);
	assert.match(house.error, /not readable/i);
	const session = await CallTool(ctx, 'read_file', { path: 'session.jsonl' });
	assert.equal(session.ok, false);
	const glob = await CallTool(ctx, 'search_files', { mode: 'glob', pattern: '*' });
	assert.equal(glob.ok, true);
	assert.equal(glob.matches.some((m) => m.path === 'house.json' || m.path === 'session.jsonl'), false);
});

test('alarm clock reads ALARMS; set_alarm and stop_alarm edit it; write_file cannot', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const listedOff = await CallAgpi(Ctx(houseDir, { agent_alarms: false }), 'list_actions', { target: 'alarm_clock' });
	assert.deepEqual(listedOff.actions.map((a) => a.action), ['examine']);
	const listed = await CallAgpi(ctx, 'list_actions', { target: 'alarm_clock' });
	assert.deepEqual(listed.actions.map((a) => a.action).sort(), ['examine', 'set_alarm', 'stop_alarm']);

	const set = await CallTool(ctx, 'send_action', {
		action: 'set_alarm',
		target: 'alarm_clock',
		payload: '0 * * * * "hourly"'
	});
	assert.equal(set.ok, true);
	assert.equal(set.alarm.expr, '0 * * * *');
	assert.equal(set.alarm.text, 'hourly');
	assert.equal(set.paths, undefined);
	assert.equal(set.actions, undefined);

	const exam = await CallTool(ctx, 'send_action', { action: 'examine', target: 'alarm' });
	assert.equal(exam.ok, true);
	assert.deepEqual(exam.paths, ['ALARMS']);
	assert.ok(Array.isArray(exam.actions));
	assert.equal(exam.alarms.length, 1);
	assert.equal(exam.alarms[0].text, 'hourly');
	assert.equal(typeof exam.elapsed_seconds, 'number');
	assert.match(exam.time, /^\d{2}:\d{2}:\d{2}$/);

	const read = await CallTool(ctx, 'read_file', { path: 'ALARMS' });
	assert.equal(read.ok, true);
	assert.match(read.text, /hourly/);

	const locked = await CallTool(ctx, 'write_file', { path: 'ALARMS', text: 'bad\n' });
	assert.equal(locked.ok, false);
	assert.match(locked.error, /set_alarm|stop_alarm|read-only/i);

	const stopped = await CallTool(ctx, 'send_action', {
		action: 'stop_alarm',
		target: 'alarm_clock',
		payload: 'hourly'
	});
	assert.equal(stopped.ok, true);
	assert.equal(stopped.count, 0);

	const refused = await CallTool(Ctx(houseDir, { agent_alarms: false }), 'send_action', {
		action: 'set_alarm',
		target: 'alarm_clock',
		payload: '0 9 * * * "morning"'
	});
	assert.equal(refused.ok, false);
	assert.match(refused.error, /disabled/i);
});

test('calendar set_event and stop_event edit EVENTS; write_file cannot', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const listedOff = await CallAgpi(Ctx(houseDir, { agent_events: false }), 'list_actions', { target: 'calendar' });
	assert.deepEqual(listedOff.actions.map((a) => a.action), ['examine']);
	const listed = await CallAgpi(ctx, 'list_actions', { target: 'calendar' });
	assert.deepEqual(listed.actions.map((a) => a.action).sort(), ['examine', 'set_event', 'stop_event']);

	const d = new Date();
	d.setDate(d.getDate() + 3);
	d.setHours(10, 15, 0, 0);
	const stamp = StampFromDate(d);
	const set = await CallTool(ctx, 'send_action', {
		action: 'set_event',
		target: 'calendar',
		payload: { date: stamp.date, time: stamp.time, text: 'Tea' }
	});
	assert.equal(set.ok, true);
	assert.equal(set.event.text, 'Tea');
	assert.equal(set.paths, undefined);
	assert.equal(set.actions, undefined);

	const exam = await CallTool(ctx, 'send_action', { action: 'examine', target: 'calendar' });
	assert.equal(exam.ok, true);
	assert.deepEqual(exam.paths, ['calendar/', 'EVENTS']);
	assert.equal(exam.events.count, 1);
	assert.equal(exam.events.items[0].text, 'Tea');

	const locked = await CallTool(ctx, 'write_file', { path: 'EVENTS', text: 'bad\n' });
	assert.equal(locked.ok, false);
	assert.match(locked.error, /set_event|stop_event|read-only/i);

	const stopped = await CallTool(ctx, 'send_action', {
		action: 'stop_event',
		target: 'calendar',
		payload: { text: 'Tea' }
	});
	assert.equal(stopped.ok, true);
	assert.equal(stopped.count, 0);

	const refused = await CallTool(Ctx(houseDir, { agent_events: false }), 'send_action', {
		action: 'set_event',
		target: 'calendar',
		payload: { date: stamp.date, time: stamp.time, text: 'Nope' }
	});
	assert.equal(refused.ok, false);
	assert.match(refused.error, /disabled/i);
});

test('sleep on the bed halts and resets the turn count', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	BumpTurns(houseDir);
	BumpTurns(houseDir);
	assert.equal(WorldTurns(houseDir), 2);
	const slept = await CallTool(ctx, 'send_action', { action: 'sleep', target: 'bed' });
	assert.equal(slept.ok, true);
	assert.equal(slept.halt, 'sleep');
	assert.equal(WorldTurns(houseDir), 0);
	const wrong = await CallTool(ctx, 'send_action', { action: 'sleep', target: 'pc' });
	assert.equal(wrong.ok, false);
	assert.match(wrong.error, /bed/i);
});

test('notify_user sets waiting_on_user, halts, and does not reset turns', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	BumpTurns(houseDir);
	assert.equal(WorldTurns(houseDir), 1);
	const missing = await CallTool(ctx, 'send_action', { action: 'notify_user', target: 'pc' });
	assert.equal(missing.ok, false);
	assert.match(missing.error, /text/i);

	const ping = await CallTool(ctx, 'send_action', {
		action: 'notify_user',
		target: 'pc',
		payload: JSON.stringify({ text: 'Need a path for the patch.' })
	});
	assert.equal(ping.ok, true);
	assert.equal(ping.halt, 'notify');
	assert.equal(ping.waiting, 1);
	assert.equal(ping.waiting.kind, undefined);
	assert.equal(WorldTurns(houseDir), 1);
	assert.equal(WaitingOnUser(houseDir).kind, 'notify');

	const again = await CallTool(ctx, 'send_action', {
		action: 'notify_user',
		target: 'pc',
		payload: 'Updated ask'
	});
	assert.equal(again.ok, true);
	assert.equal(WaitingOnUser(houseDir).text, 'Updated ask');
	assert.equal(HouseAlarmsPaused(houseDir, { enabled: true, max_turns: 0 }), true);
	assert.equal(ClearNotifyWait(houseDir), true);
	assert.equal(WaitingOnUser(houseDir), null);
	assert.equal(ClearNotifyWait(houseDir), null);
	assert.equal(HouseAlarmsPaused(houseDir, { enabled: true, max_turns: 0 }), false);

	const nested = await CallTool(ctx, 'send_action', {
		action: 'notify_user',
		target: 'pc',
		payload: { text: 'Nested payload' }
	});
	assert.equal(nested.ok, true);
	assert.equal(WaitingOnUser(houseDir).text, 'Nested payload');
});

test('set_status stores a line in world.json and can clear it', async () => {
	const houseDir = TempHouse();
	const ctx = Ctx(houseDir);
	const set = await CallTool(ctx, 'send_action', {
		action: 'set_status',
		target: 'pc',
		payload: { text: 'curious' }
	});
	assert.equal(set.ok, true);
	assert.equal(set.status, 'curious');
	assert.equal(JSON.parse(fs.readFileSync(path.join(houseDir, 'world.json'), 'utf8')).status, 'curious');
	const cleared = await CallTool(ctx, 'send_action', { action: 'set_status', target: 'pc', payload: '' });
	assert.equal(cleared.ok, true);
	assert.equal(cleared.status, '');
	assert.equal(JSON.parse(fs.readFileSync(path.join(houseDir, 'world.json'), 'utf8')).status, undefined);
	const pose = PalacePose(houseDir);
	assert.equal(pose.status, '');
	const again = await CallTool(ctx, 'send_action', { action: 'set_status', target: 'pc', payload: 'curious' });
	assert.equal(again.ok, true);
	assert.equal(PalacePose(houseDir).status, 'curious');
	assert.equal(PalacePose(houseDir).object.id, 'pc');
});

test('boot caps a large BOOT.md by bytes without splitting a character', async () => {
	const houseDir = TempHouse();
	// 3-byte characters: a character-count cut would return about three times the cap.
	fs.writeFileSync(path.join(houseDir, 'BOOT.md'), '€'.repeat(40 * 1024), 'utf8');
	const out = await CallAgpi(Ctx(houseDir), 'send_action', { action: 'boot', target: 'pc' });
	assert.equal(out.ok, true);
	assert.equal(out.boot.truncated, true);
	assert.ok(Buffer.byteLength(out.boot.text, 'utf8') <= 64 * 1024);
	assert.equal(out.boot.text.includes('\uFFFD'), false);
	assert.match(out.boot.text, /^€+$/);
});
