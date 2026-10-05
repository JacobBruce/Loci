import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StartCompanion } from '../../AGPI/companion/server.js';
import { LoadHouseConfig, PatchHouseConfig } from '../src/house-config.js';
import { CallAgpi } from '../src/agpi.js';
import { HouseAlarmsPaused, PalacePose, PinGameConsole, SetFocusFromHousePath } from '../src/world.js';
import {
	BindGameLoop,
	FindGameSkill,
	GameToolExtra,
	GamingOn,
	NoteTurnStarted,
	OnTurnFinished,
	ProbeGame,
	StartGaming,
	StopGaming,
	ToolRoundLimit,
	ToolRoundsCapped
} from '../src/game.js';

function Sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let server;
let wakes;
let busy;

test.before(async () => {
	server = await StartCompanion(0);
});

test.after(async () => {
	StopGaming();
	if (server) await server.close();
});

test.beforeEach(() => {
	StopGaming();
	wakes = [];
	busy = false;
	BindGameLoop({
		enqueue(_slug, text) { wakes.push(text); },
		busy() { return busy; },
		pose() {},
		changed() {}
	});
});

function PlaceSkill(root, rel, text) {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	if (!fs.existsSync(abs)) fs.writeFileSync(abs, text || 'practice\n', 'utf8');
}

async function Begin(extra) {
	const opts = extra || {};
	const houseDir = opts.houseDir || fs.mkdtempSync(path.join(os.tmpdir(), 'loci-game-'));
	const lociHome = opts.lociHome || fs.mkdtempSync(path.join(os.tmpdir(), 'loci-lib-'));
	if (opts.installSkill !== false) {
		const root = opts.skillInHouse ? houseDir : lociHome;
		PlaceSkill(root, opts.skillRel || path.join('skills', 'practice-room.md'));
	}
	await StartGaming({
		slug: 'maple',
		houseDir,
		baseUrl: server.url,
		idleOff: true,
		pollMs: 40,
		lociHome,
		...opts
	});
	return { houseDir, lociHome };
}

function Ctx(houseDir, extra) {
	return {
		houseDir,
		name: 'Maple',
		slug: 'maple',
		workspaces: [],
		run_command: false,
		...GameToolExtra('maple'),
		...extra
	};
}

test('gaming mode forwards world calls and leaves home chat actions here', async () => {
	const { houseDir, lociHome } = await Begin();
	assert.equal(GamingOn(), true);
	assert.match(wakes[0], /Practice room/);
	assert.match(wakes[0], /loci-skills\/practice-room\.md/);
	const skill = path.join(lociHome, 'skills', 'practice-room.md');
	assert.equal(fs.existsSync(skill), true);
	fs.writeFileSync(skill, 'edited\n', 'utf8');

	assert.equal(HouseAlarmsPaused(houseDir, { enabled: true, max_turns: 0 }), true);
	assert.equal(ToolRoundsCapped('maple'), true);
	assert.equal(ToolRoundLimit('maple', 32), 32);

	const listed = await CallAgpi(Ctx(houseDir), 'list_actions', {});
	assert.equal(listed.ok, true);
	assert.ok(listed.actions.some((a) => a.name === 'wait'));

	const said = await CallAgpi(Ctx(houseDir), 'send_msg', { text: 'Hello from the Guide' });
	assert.equal(said.ok, true);
	assert.equal(said.delivered, true);
	assert.equal(said.as, 'guide');

	const mail = await CallAgpi(Ctx(houseDir), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: '{"to":"cedar","text":"hey"}'
	});
	assert.equal(mail.ok, false);
	assert.match(mail.error, /off during gaming mode/);
	const event = await CallAgpi(Ctx(houseDir), 'send_action', {
		action: 'set_event',
		target: 'calendar',
		payload: '2099-01-01 09:00 "later"'
	});
	assert.equal(event.ok, false);
	assert.match(event.error, /set_event is off during gaming mode/);

	PinGameConsole(houseDir);
	SetFocusFromHousePath(houseDir, 'skills/practice-room.md');
	assert.equal(PalacePose(houseDir).object.id, 'game_console');
	const went = await CallAgpi({ ...Ctx(houseDir), gaming: false, forward_game: null }, 'send_action', {
		action: 'go',
		target: 'office'
	});
	assert.equal(went.ok, true);
	assert.equal(went.moved, undefined);
	assert.equal(PalacePose(houseDir).room.id, 'living');
	assert.equal(PalacePose(houseDir).object.id, 'game_console');
	const note = await CallAgpi(Ctx(houseDir), 'send_action', {
		action: 'notify_user',
		target: 'pc',
		payload: '{"text":"Look here"}'
	});
	assert.equal(note.ok, true);
	assert.equal(note.action, 'notify_user');
	const pose = PalacePose(houseDir);
	assert.equal(pose.room.id, 'living');
	assert.equal(pose.object.id, 'game_console');

	StopGaming();
	await Begin({ houseDir, lociHome, capToolRounds: false, maxToolRounds: 8 });
	assert.equal(fs.readFileSync(skill, 'utf8'), 'edited\n');
	assert.equal(ToolRoundsCapped('maple'), false);
	assert.equal(ToolRoundLimit('maple', 32), 0);
	StopGaming();
	await Begin({ maxToolRounds: 8 });
	assert.equal(ToolRoundLimit('maple', 32), 8);
});

test('set_status stays a house action during gaming mode and can be cleared', async () => {
	const { houseDir } = await Begin();
	PinGameConsole(houseDir);
	const set = await CallAgpi(Ctx(houseDir), 'send_action', {
		action: 'set_status',
		target: 'pc',
		payload: 'in battle'
	});
	assert.equal(set.ok, true);
	assert.equal(set.status, 'in battle');
	assert.equal(PalacePose(houseDir).status, 'in battle');
	assert.equal(PalacePose(houseDir).object.id, 'game_console');
	const cleared = await CallAgpi(Ctx(houseDir), 'send_action', { action: 'set_status', target: 'pc', payload: '' });
	assert.equal(cleared.ok, true);
	assert.equal(PalacePose(houseDir).status, '');
});

test('a game event waits until the current turn ends, and forfeit comes home', async () => {
	const { houseDir } = await Begin();
	await fetch(server.url + '/v1/inject', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ type: 'wake', reason: 'your_turn', text: 'It is your turn.' })
	});
	await Sleep(200);
	assert.ok(wakes.some((t) => t.includes('your_turn') && t.includes('It is your turn.')));

	busy = true;
	await fetch(server.url + '/v1/inject', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ type: 'end', reason: 'forfeit', text: 'The player forfeited.' })
	});
	await Sleep(200);
	assert.equal(GamingOn(), true);
	assert.equal(wakes.some((t) => t.includes('forfeit')), false);
	await OnTurnFinished('maple');
	assert.equal(GamingOn(), false);
	assert.ok(wakes.some((t) => t.includes('forfeit')));
	assert.equal(PalacePose(houseDir).room.id, 'office');
});

test('a wake stays on the game until the turn ends', async () => {
	await Begin({ pollMs: 40 });
	busy = true;
	await fetch(server.url + '/v1/inject', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ type: 'wake', reason: 'your_turn', text: 'Hold this choice.' })
	});
	await Sleep(200);
	assert.equal(wakes.some((t) => t.includes('Hold this choice')), false);
	await OnTurnFinished('maple');
	assert.ok(wakes.some((t) => t.includes('Hold this choice')));
});

test('two events during one turn are both delivered', async () => {
	await Begin({ pollMs: 40 });
	busy = true;
	const inject = (text) => fetch(server.url + '/v1/inject', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ type: 'wake', reason: 'your_turn', text })
	});
	await inject('First event.');
	await inject('Second event.');
	await OnTurnFinished('maple');
	const joined = wakes.find((t) => t.includes('First event.'));
	assert.ok(joined && joined.includes('Second event.'));
});

test('idle wake is commentary after a quiet stretch', async () => {
	await Begin({ idleOff: false, idleSec: 1 });
	await OnTurnFinished('maple');
	await Sleep(1200);
	assert.ok(wakes.some((t) => t.includes('exceeded an idle time') && t.includes('send_msg')));
});

test('start refuses a public address, a missing skill, and a second house', async () => {
	await assert.rejects(
		StartGaming({ slug: 'maple', baseUrl: 'http://example.com' }),
		/this machine/
	);
	const houseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-game-'));
	const lociHome = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-lib-'));
	await assert.rejects(
		StartGaming({ slug: 'maple', houseDir, baseUrl: server.url, lociHome }),
		/No skill named "practice-room.md"/
	);
	await Begin();
	await assert.rejects(
		StartGaming({ slug: 'cedar', baseUrl: server.url, lociHome }),
		/already in gaming mode/
	);
});

test('shared skills win, then the house, and a folder skill is SKILL.md', () => {
	const lociHome = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-lib-'));
	const houseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-game-'));
	assert.throws(() => FindGameSkill('practice-room.md', lociHome, houseDir), /No skill named/);
	PlaceSkill(houseDir, path.join('skills', 'practice-room.md'), 'house\n');
	assert.equal(FindGameSkill('practice-room.md', lociHome, houseDir).path, 'skills/practice-room.md');
	PlaceSkill(lociHome, path.join('skills', 'practice-room.md'), 'shared\n');
	assert.equal(FindGameSkill('practice-room.md', lociHome, houseDir).path, 'loci-skills/practice-room.md');
	PlaceSkill(lociHome, path.join('skills', 'arena', 'SKILL.md'), 'arena\n');
	assert.equal(FindGameSkill('arena', lociHome, houseDir).path, 'loci-skills/arena/SKILL.md');
	assert.throws(() => FindGameSkill('SKILL.md', lociHome, houseDir), /SKILL.md/);
	assert.throws(() => FindGameSkill('../practice-room.md', lociHome, houseDir), /did not name/);
});

test('a house skill is named when the shared library does not have it', async () => {
	await Begin({ skillInHouse: true });
	assert.match(wakes[0], /skills\/practice-room\.md/);
	assert.doesNotMatch(wakes[0], /loci-skills/);
});

test('a second start during connect is refused', async () => {
	const houseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-game-'));
	const lociHome = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-lib-'));
	PlaceSkill(lociHome, path.join('skills', 'practice-room.md'));
	const first = StartGaming({
		slug: 'maple',
		houseDir,
		baseUrl: server.url,
		lociHome,
		idleOff: true,
		pollMs: 40
	});
	await assert.rejects(
		StartGaming({
			slug: 'cedar',
			houseDir,
			baseUrl: server.url,
			lociHome,
			idleOff: true,
			pollMs: 40
		}),
		/already in gaming mode/
	);
	await first;
	assert.equal(GamingOn(), true);
});

test('idle does not wake a house that is already in a turn', async () => {
	await Begin({ idleOff: false, idleSec: 1 });
	await OnTurnFinished('maple');
	NoteTurnStarted('maple');
	busy = true;
	await Sleep(1200);
	assert.equal(wakes.some((t) => t.includes('exceeded an idle time')), false);
	busy = false;
	await OnTurnFinished('maple');
	await Sleep(1200);
	assert.ok(wakes.some((t) => t.includes('exceeded an idle time')));
});

test('an end in the same poll drops the earlier wake', async () => {
	await Begin({ pollMs: 2000 });
	await Promise.all([
		fetch(server.url + '/v1/inject', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'wake', reason: 'your_turn', text: 'It is your turn.' })
		}),
		fetch(server.url + '/v1/inject', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'end', reason: 'forfeit', text: 'The player forfeited.' })
		})
	]);
	await Sleep(2500);
	assert.equal(GamingOn(), false);
	assert.equal(wakes.some((t) => t.includes('your_turn')), false);
	assert.ok(wakes.some((t) => t.includes('forfeit')));
});

test('game console settings survive a reload of the house config', () => {
	// Runtime config lives beside the houses folder, so each test needs its own parent folder.
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-cfg-')), 'houses');
	const saved = PatchHouseConfig(root, 'maple', {
		game_console: {
			url: 'http://127.0.0.1:9',
			idle_sec: 12,
			idle_off: true,
			max_tool_rounds: 4,
			cap_off: true
		}
	});
	assert.equal(saved.game_console.idle_sec, 12);
	const again = LoadHouseConfig(root, 'maple');
	assert.equal(again.game_console.url, 'http://127.0.0.1:9');
	assert.equal(again.game_console.idle_off, true);
	assert.equal(again.game_console.cap_off, true);
	assert.equal(again.game_console.max_tool_rounds, 4);
	assert.equal(again.max_tool_rounds, 128);
});

test('connect reports a located skill that is not enabled', async () => {
	const houseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-game-'));
	const lociHome = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-lib-'));
	PlaceSkill(lociHome, path.join('skills', 'practice-room.md'));
	const probed = await ProbeGame({
		slug: 'maple',
		houseDir,
		baseUrl: server.url,
		lociHome
	});
	assert.equal(probed.name, 'Practice room');
	assert.equal(probed.skill, 'loci-skills/practice-room.md');
	assert.equal(probed.enabled, false);
});
