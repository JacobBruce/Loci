import fs from 'node:fs';
import path from 'node:path';
import { LoadHouseConfig } from './house-config.js';
import { LociHome } from './mcp-store.js';

const DEFAULT_URL = 'http://127.0.0.1:24740';
const POLL_MS = 1000;
const PING_MS = 3000;

const IDLE_LINE = 'System message: Gaming mode is still active and you have exceeded an idle time set by the user without speaking or taking any actions. If the locked body has something to say, use send_msg. Only take an action when the game prompts you to do so or if it makes sense given the current game state (unless the associated skill says otherwise).';

let session = null;
let held = null;
let starting = false;
let hooks = {
	enqueue: null,
	busy: null,
	pose: null,
	changed: null
};

export function BindGameLoop(next) {
	hooks = {
		enqueue: next && next.enqueue,
		busy: next && next.busy,
		pose: next && next.pose,
		changed: next && next.changed
	};
}

export function GamingOn() {
	return !!session;
}

export function HouseIsGaming(slug) {
	return !!(session && session.slug === slug);
}

export function HouseDirIsGaming(houseDir) {
	if (!session || !session.houseDir || !houseDir) return false;
	return path.resolve(session.houseDir) === path.resolve(houseDir);
}

export function ToolRoundsCapped(slug) {
	if (!session || session.slug !== slug) return true;
	return session.capToolRounds !== false;
}

export function ToolRoundLimit(slug, houseLimit) {
	if (!session || session.slug !== slug) return houseLimit;
	if (session.capToolRounds === false) return 0;
	return session.maxToolRounds;
}

export function GameToolExtra(slug) {
	if (!HouseIsGaming(slug)) return {};
	return {
		gaming: true,
		forward_game: (name, args) => ForwardGame(name, args)
	};
}

export function GameStatus(slug) {
	const base = {
		defaultUrl: DEFAULT_URL,
		idleSec: 30,
		idleOff: false,
		maxToolRounds: 32,
		capToolRounds: true
	};
	if (!session) return { gaming: false, ...base, warning: '' };
	return {
		gaming: true,
		slug: session.slug,
		yours: session.slug === slug,
		gameId: session.gameId,
		name: session.name,
		baseUrl: session.baseUrl,
		idleSec: session.idleMs ? Math.round(session.idleMs / 1000) : 30,
		idleOff: !session.idleMs,
		maxToolRounds: session.maxToolRounds,
		capToolRounds: session.capToolRounds !== false,
		skill: session.skill,
		warning: session.warning || '',
		enabled: session.skillEnabled === true
	};
}

function LoopbackUrl(raw) {
	let url;
	try {
		url = new URL(String(raw || '').trim());
	} catch {
		throw new Error('Game address is not a URL.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Game address must be http or https.');
	}
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
		throw new Error('Game address must be on this machine.');
	}
	return url.origin;
}

function LibraryRoot(lociHome) {
	return lociHome ? path.resolve(String(lociHome)) : LociHome();
}

function SkillRel(name) {
	const raw = String(name || '').trim();
	if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..') || raw.startsWith('.')) {
		throw new Error('The game did not name a skill file.');
	}
	if (raw.toLowerCase().endsWith('.md')) {
		if (path.basename(raw).toLowerCase() === 'skill.md') {
			throw new Error('The game named SKILL.md. Name a skill file, or a folder that contains one.');
		}
		return raw;
	}
	return raw + '/SKILL.md';
}

function SkillFile(root, rel) {
	if (!root) return '';
	const abs = path.resolve(root, rel);
	const from = path.relative(path.resolve(root), abs);
	if (!from || from.startsWith('..') || path.isAbsolute(from)) return '';
	let st;
	try {
		st = fs.lstatSync(abs);
	} catch {
		return '';
	}
	if (!st.isFile() || st.isSymbolicLink()) return '';
	return abs;
}

/**
 * First match wins: shared skills, then this house.
 * A name ending in .md is that file. Any other name is a folder with SKILL.md.
 * @returns {{ path: string, abs: string }}
 */
export function FindGameSkill(skillName, lociHome, houseDir) {
	const rel = SkillRel(skillName);
	const places = [
		{ root: path.join(LibraryRoot(lociHome), 'skills'), prefix: 'loci-skills' },
		{ root: houseDir ? path.join(path.resolve(houseDir), 'skills') : '', prefix: 'skills' }
	];
	for (const place of places) {
		const abs = SkillFile(place.root, rel);
		if (!abs) continue;
		return { path: place.prefix + '/' + rel, abs };
	}
	throw new Error(
		'No skill named "' + String(skillName || '').trim() + '" in the shared skills or this house.'
	);
}

function SkillEnabled(housesRoot, slug, toolPath) {
	if (!housesRoot || !slug) return false;
	try {
		const cfg = LoadHouseConfig(housesRoot, slug);
		const map = cfg.playbook && typeof cfg.playbook === 'object' ? cfg.playbook : {};
		return map[toolPath] === true;
	} catch {
		return false;
	}
}

function StartLine(game) {
	return 'System message: Gaming mode has been initiated and the AGPI tools should be used to play ' +
		game.name + '. Read the skill file associated with this game if it is not already in context: ' +
		game.skill;
}

function WakeLine(ev) {
	const reason = ev.reason ? ' (' + ev.reason + ')' : '';
	const text = ev.text || 'The game wants you.';
	return 'The game says' + reason + ': ' + text;
}

function EndLine(ev) {
	const reason = ev && ev.reason ? ' (' + ev.reason + ')' : '';
	const extra = ev && ev.text ? ' ' + String(ev.text).trim() : '';
	return 'System message: Gaming mode has ended' + reason + '.' + (extra ? ' ' + extra : '') +
		' You are home. The palace tools are active again. send_msg will fail until a game is connected.';
}

function ClearIdle() {
	if (!session || !session.idleTimer) return;
	clearTimeout(session.idleTimer);
	session.idleTimer = null;
}

function ClearPoll() {
	if (!session || !session.pollTimer) return;
	clearInterval(session.pollTimer);
	session.pollTimer = null;
}

function Busy(slug) {
	return typeof hooks.busy === 'function' && hooks.busy(slug);
}

function Enqueue(slug, text) {
	if (typeof hooks.enqueue === 'function') hooks.enqueue(slug, text);
}

function Hold(slug, text) {
	held = { slug, text };
}

function Deliver(slug, text) {
	if (Busy(slug)) {
		Hold(slug, text);
		return;
	}
	try {
		Enqueue(slug, text);
	} catch {
		Hold(slug, text);
	}
}

function ArmIdle() {
	ClearIdle();
	if (!session || !session.idleMs || session.pending) return;
	const slug = session.slug;
	session.idleTimer = setTimeout(() => {
		if (!session || session.slug !== slug) return;
		session.idleTimer = null;
		if (Busy(slug)) return;
		Enqueue(slug, IDLE_LINE);
	}, session.idleMs);
}

function DropSession() {
	ClearIdle();
	ClearPoll();
	session = null;
}

function Finish(text) {
	if (!session) return;
	const slug = session.slug;
	DropSession();
	if (typeof hooks.changed === 'function') hooks.changed(slug, false);
	Deliver(slug, text);
}

function AcceptEvent(ev) {
	if (!session || !ev) return;
	if (ev.type === 'end') {
		Finish(EndLine(ev));
		return;
	}
	const text = WakeLine({ reason: String(ev.reason || ''), text: String(ev.text || '') });
	ClearIdle();
	if (Busy(session.slug)) {
		// Keep every event from this stretch; the next turn reads them in order.
		session.pending = session.pending ? session.pending + '\n\n' + text : text;
		return;
	}
	const slug = session.slug;
	try {
		Enqueue(slug, text);
	} catch {
		Finish(text);
	}
}

async function Poll() {
	if (!session || session.polling) return;
	// Leave events on the game while a turn is running. Draining them early
	// lets the agent act on a choice it has not been shown yet. The hello
	// still tells the game this house is listening.
	if (Busy(session.slug)) {
		await Ping();
		return;
	}
	await Pull();
}

async function Ping() {
	const current = session;
	const now = Date.now();
	if (!current || now - (current.pingedAt || 0) < PING_MS) return;
	current.pingedAt = now;
	try {
		await fetch(current.baseUrl + '/v1/hello', { signal: AbortSignal.timeout(4000) });
	} catch {
		// the next events poll reports a game that is not answering
	}
}

async function Pull() {
	if (!session || session.polling) return;
	const current = session;
	current.polling = true;
	try {
		const res = await fetch(current.baseUrl + '/v1/events', { signal: AbortSignal.timeout(4000) });
		const data = await res.json();
		if (!res.ok || !data || data.ok === false) throw new Error('events refused');
		if (session !== current) return;
		current.warning = '';
		current.misses = 0;
		const events = data.events || [];
		let end = null;
		for (const ev of events) {
			if (ev && ev.type === 'end') end = ev;
		}
		if (end) AcceptEvent(end);
		else {
			for (const ev of events) AcceptEvent(ev);
		}
	} catch {
		if (session !== current) return;
		current.misses = (current.misses || 0) + 1;
		if (current.misses >= 3) current.warning = 'The game is not answering.';
	} finally {
		if (session === current) current.polling = false;
	}
}

async function Hello(baseUrl) {
	let res;
	try {
		res = await fetch(baseUrl + '/v1/hello', { signal: AbortSignal.timeout(4000) });
	} catch {
		throw new Error('Could not reach the game at ' + baseUrl + '.');
	}
	let data;
	try {
		data = await res.json();
	} catch {
		throw new Error('The game at ' + baseUrl + ' did not answer with JSON.');
	}
	if (!res.ok || !data || data.ok === false) {
		throw new Error(data && data.error ? String(data.error) : 'The game refused the connection.');
	}
	return data;
}

function ToolRoundMax(raw) {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 32;
	return Math.min(256, Math.max(1, Math.floor(n)));
}

function IdleMs(idleSec, idleOff) {
	if (idleOff) return 0;
	const n = Number(idleSec);
	if (!Number.isFinite(n) || n <= 0) return 30000;
	return Math.min(3600, Math.max(1, Math.floor(n))) * 1000;
}

/**
 * Ask the game who it is and where its skill should be read from.
 * Refuses when that skill is not in the shared library or this house.
 */
export async function ProbeGame(opts) {
	const o = opts || {};
	const baseUrl = LoopbackUrl(o.baseUrl || DEFAULT_URL);
	const hello = await Hello(baseUrl);
	const skillName = String(hello.skill || '').trim();
	if (!skillName) throw new Error('The game did not name a skill.');
	const found = FindGameSkill(skillName, o.lociHome, o.houseDir);
	const name = String(hello.name || hello.game || 'Game').trim() || 'Game';
	return {
		ok: true,
		baseUrl,
		game: String(hello.game || ''),
		name,
		skill: found.path,
		skillName,
		enabled: SkillEnabled(o.housesRoot, o.slug, found.path)
	};
}

export function NoteTurnStarted(slug) {
	if (!session || session.slug !== slug) return;
	ClearIdle();
}

/**
 * Connect a house to the companion at this address.
 */
export async function StartGaming(opts) {
	const o = opts || {};
	if (session || starting) throw new Error('Another house is already in gaming mode.');
	const slug = String(o.slug || '').trim();
	if (!slug) throw new Error('House is missing.');
	starting = true;
	try {
		const game = await ProbeGame(o);
		if (session) throw new Error('Another house is already in gaming mode.');
		held = null;
		session = {
			slug,
			houseDir: o.houseDir ? path.resolve(o.houseDir) : '',
			gameId: game.game,
			name: game.name,
			skill: game.skill,
			skillEnabled: game.enabled,
			baseUrl: game.baseUrl,
			idleMs: IdleMs(o.idleSec, o.idleOff),
			maxToolRounds: ToolRoundMax(o.maxToolRounds),
			capToolRounds: o.capToolRounds !== false,
			pollMs: Number(o.pollMs) > 0 ? Number(o.pollMs) : POLL_MS,
			warning: '',
			misses: 0,
			pending: null,
			idleTimer: null,
			pollTimer: null,
			polling: false
		};
		session.pollTimer = setInterval(() => {
			Poll().catch(() => {});
		}, session.pollMs);
		if (typeof hooks.pose === 'function') hooks.pose(slug);
		try {
			Enqueue(slug, StartLine(game));
		} catch (err) {
			DropSession();
			if (typeof hooks.changed === 'function') hooks.changed(slug, false);
			throw err;
		}
		if (typeof hooks.changed === 'function') hooks.changed(slug, true);
		return GameStatus(slug);
	} finally {
		starting = false;
	}
}

export function StopGaming() {
	if (!session) return GameStatus('');
	Finish('System message: Gaming mode has ended. You are home. The palace tools are active again. send_msg will fail until a game is connected.');
	return GameStatus('');
}

function DeliverPending() {
	if (!session || !session.pending) return false;
	const text = session.pending;
	session.pending = null;
	Enqueue(session.slug, text);
	return true;
}

function ReleaseHeld(slug) {
	if (!held || held.slug !== slug) return false;
	const text = held.text;
	try {
		Enqueue(slug, text);
		held = null;
	} catch {
		// the house still cannot take a turn; keep the line
	}
	return true;
}

async function FinishTurn(slug) {
	if (ReleaseHeld(slug)) return;
	if (!session || session.slug !== slug) return;
	if (DeliverPending()) return;
	await Pull();
	if (ReleaseHeld(slug)) return;
	if (!session || session.slug !== slug) return;
	if (DeliverPending()) return;
	if (!Busy(slug)) ArmIdle();
}

export function OnTurnFinished(slug) {
	return FinishTurn(slug).catch(() => {});
}

export async function ForwardGame(name, args) {
	if (!session) throw new Error('No game is connected.');
	let res;
	try {
		res = await fetch(session.baseUrl + '/v1/call', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, args: args || {} }),
			signal: AbortSignal.timeout(15000)
		});
	} catch (err) {
		throw new Error('The game did not answer. ' + (err && err.message ? err.message : ''));
	}
	let data;
	try {
		data = await res.json();
	} catch {
		throw new Error('The game returned something that was not JSON.');
	}
	if (!res.ok || (data && data.ok === false)) {
		throw new Error(data && data.error ? String(data.error) : 'The game refused that call.');
	}
	return data;
}
