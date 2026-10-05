/**
 * The Loci palace world: rooms and objects, the per-house world.json (room, focus,
 * turns, waits, status), local time helpers, and the palace pose shown in the UI.
 * No tool handling lives here; see palace-actions.js and agpi.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GamingOn, HouseDirIsGaming } from './game.js';

const EVENT_CAP = 16;
const WORLD_FILE = 'world.json';
const DEFAULT_ROOM = 'office';

export const ROOMS = [
	{ id: 'bedroom', name: 'Bedroom' },
	{ id: 'office', name: 'Office' },
	{ id: 'library', name: 'Library' },
	{ id: 'living', name: 'Living room' }
];

export const OBJECTS = [
	{
		id: 'diary',
		room: 'bedroom',
		name: 'Diary',
		blurb: 'A diary with dated journal pages. Usually written by the agent before going to sleep.',
		paths: ['diary/'],
		ui: 'diary',
		description: 'Dated journal pages. Create and edit files in diary/ with the file tools.'
	},
	{
		id: 'calendar',
		room: 'bedroom',
		name: 'Calendar',
		blurb: 'The calendar provides the agent with today’s date and holds a record of important events. Allows you to wake up the agent at a specific date and time.',
		paths: ['calendar/', 'EVENTS'],
		ui: 'calendar',
		description: 'A wall calendar. Examine it for today\'s date. Records live in calendar/YYYY-MM-DD.md. One-shot wakes live in EVENTS. It does not tell the time.'
	},
	{
		id: 'clock',
		room: 'office',
		name: 'Clock',
		blurb: 'The office wall clock provides the agent with the current time, the local timezone, and how long a turn has been running.',
		paths: [],
		ui: 'clock',
		description: 'A wall clock in the office. Examine it for the current time, the local timezone, and how long this turn has been running. It is not a timer and not a calendar.'
	},
	{
		id: 'alarm_clock',
		room: 'bedroom',
		name: 'Alarm Clock',
		blurb: 'The alarm clock provides the agent with the current time and the next alarm time. Allows you to set alarms so the agent wakes up on a set schedule. The agent may set and stop alarms if allowed.',
		paths: ['ALARMS'],
		ui: 'alarm',
		description: 'The house wake schedule. Examine it for the current time, ALARMS (crontab), and the next fires. Set or stop lines through send_action when the user allows agent-set alarms. It is not the PC reminders app.'
	},
	{
		id: 'bed',
		room: 'bedroom',
		name: 'Bed',
		blurb: 'The bed is where the agent winds down. Sleep ends a turn; alarms will still fire. The instructions in LOGOFF.md should be modified to suit the purpose of the agent.',
		paths: ['LOGOFF.md'],
		ui: 'md',
		description: 'Where you wind down. Examine it for the path to LOGOFF.md (ritual plus last notes). Sleep ends this turn; the ALARMS crontab still fires on the next matching minute. Logoff notes are written at the PC.'
	},
	{
		id: 'soul_frame',
		room: 'bedroom',
		name: 'Framed Constitution',
		blurb: 'The agent’s constitution. This document defines the personality of the agent and can be updated by the agent as they learn more about themselves.',
		paths: ['SOUL.md'],
		ui: 'md',
		description: 'Your constitution hangs here. Read or refine SOUL.md with the file tools; keep the # Soul heading. Update your constitution as you learn more about yourself.'
	},
	{
		id: 'user_portrait',
		room: 'bedroom',
		name: 'User Portrait',
		blurb: 'A portrait of you. Stable facts about you such as your personality and preferences are recorded by the agent as they learn more about you.',
		paths: ['USER.md'],
		ui: 'md',
		description: 'A portrait of the user. Stable facts live in USER.md; keep the # User heading. Update USER.md as you learn more about the user.'
	},
	{
		id: 'pc',
		room: 'office',
		name: 'PC',
		blurb: 'The office workstation. Allows the agent to boot, logoff, send mail, ping other agents, browse the web, set reminders, and set a status line. Web browsing must be enabled under Manage house. You should also set a Firecrawl API key in Settings for higher rate limits.',
		paths: ['BOOT.md', 'SYSTEM.md', 'LOGOFF.md', 'mail/'],
		ui: 'pc',
		description: 'The office workstation. Boot when context is fresh (returns BOOT.md and last logoff notes). Logoff writes the Logoff notes section of LOGOFF.md. Reminders are relative one-shots that attach to a later turn. notify_user pings the user and pauses ALARMS until they reply. send_mail delivers a letter to another house in your group (does not wake them). dm wakes another house in your group. search_web, get_web_page, and download_file browse the web. set_status sets a short line next to your name.'
	},
	{
		id: 'notes',
		room: 'office',
		name: 'Notebook',
		blurb: 'The notebook. The agent uses it as a scratch pad for loose notes that shouldn\'t be a plan or a sticky note.',
		paths: ['NOTES.md'],
		ui: 'md',
		description: 'Loose scratch paper. Read and write NOTES.md with the file tools.'
	},
	{
		id: 'whiteboard',
		room: 'office',
		name: 'Whiteboard',
		blurb: 'The whiteboard holds structured plans and short sticky notes. The agent creates and removes them while working on tasks.',
		paths: ['plans/', 'notes/'],
		ui: 'whiteboard',
		description: 'Plans live in plans/ and sticky notes in notes/. Create with action "create_plan" or "create_note" and payload JSON {"title":"…","body":"…"}. Plan body is required; sticky body is optional. Remove with "remove_plan" / "remove_note" and payload JSON {"plan":"title or file"} or {"note":"title or file"}. You may edit an existing file.'
	},
	{
		id: 'task_board',
		room: 'office',
		name: 'Task Board',
		blurb: 'The task board is where you assign work to the agent. The agent will start working on open tasks when they wake up. Use chat to wake the agent immediately. When a task is completed the agent submits it for approval.',
		paths: ['tasks/'],
		ui: 'tasks',
		description: 'Assigned work lives in tasks/. The user assigns it on the Task Board. Do not create a task file, and do not write notes or a work log into it. What you did goes in the Approval Tray submit payload. Edit a task file only when the assignment itself has changed.'
	},
	{
		id: 'approval_tray',
		room: 'office',
		name: 'Approval Tray',
		blurb: 'The approval tray is where the agent submits finished work for you to review. Approve, request changes, or drop a task. The agent files a dossier of approved work in the filing cabinet. Submissions pause the house only when no other tasks are still in progress.',
		paths: ['tasks/'],
		ui: 'tasks',
		description: 'Submit finished work here. Payload JSON {"task":"title or file","work":"what you did"}. That moves the Task Board note to awaiting approval. The house pauses only when no other tasks are still in progress.'
	},
	{
		id: 'book_shelf',
		room: 'library',
		name: 'Book Shelf',
		blurb: 'The book shelf is the agent’s main form of long-term memory. Each book has a title, tags, a short description, and an optional source. You can search books with results sorted by relevance, access time, access count, or creation time.',
		paths: ['library/'],
		ui: 'books',
		description: 'Books are your main form of long-term memory and live in library/<letter>/<slug>.md. Create with create_book, remove with remove_book, search with search_books. File tools may edit an existing book. Optional source names the origin; omit it for self-generated content.'
	},
	{
		id: 'cabinet',
		room: 'library',
		name: 'Filing Cabinet',
		blurb: 'The filing cabinet stores dossiers of finished work. After you approve a task, the agent files it here and it leaves the task board.',
		paths: ['cabinet/'],
		ui: 'cabinet',
		description: 'Dossiers of finished work. File a completed Task Board note with action "file" and payload JSON {"task":"title or file","note":"optional"}. That writes cabinet/YYYY-MM-DD-slug.md and removes the note from the board. You may edit an existing dossier.'
	},
	{
		id: 'chest',
		room: 'library',
		name: 'Chest',
		blurb: 'The chest holds miscellaneous files generated by the agent. The agent may use this to create and edit files that don\'t belong elsewhere.',
		paths: ['artifacts/'],
		ui: 'chest',
		description: 'Miscellaneous generated files live in artifacts/. You may edit and create artifacts with the file tools. Remove one with remove_file and payload JSON {"file":"name or path"}. That permanently deletes the file.'
	},
	{
		id: 'story_book',
		room: 'library',
		name: 'Story Book',
		blurb: 'The story book holds information about the world and characters you interact with during gaming mode and roleplay sessions. Each folder is one campaign. A character folder has a profile and a history. The agent writes these as markdown files.',
		paths: ['stories/'],
		ui: 'stories',
		description: 'Campaigns and characters live in stories/. In gaming mode, a campaign is stories/<slug>/HISTORY.md (world events). A character is stories/<slug>/<name>/PROFILE.md (facts, backstory, relationships) and HISTORY.md (character events). Create files when there is something to record. Append an event summary when something is worth keeping or may matter later. The game skill always supersedes these instructions. Use this for gaming mode and for roleplay in the house.'
	},
	{
		id: 'address_book',
		room: 'living',
		name: 'Address Book',
		blurb: 'The address book holds information about people the agent knows, usually only other agents in the same group. Each card has a name, a relationship label, and stable facts in the body.',
		paths: ['contacts/'],
		ui: 'contacts',
		description: 'People you know. Cards live in contacts/<letter>/<slug>.md. Create with create_contact, remove with remove_contact. File tools may edit an existing card. Put episodes in the diary, not here.'
	},
	{
		id: 'rule_book',
		room: 'living',
		name: 'Rule Book',
		blurb: 'Standing rules and skills for this house. Enabled rules stay in context. Skills are a catalog the agent reads when needed.',
		paths: ['rules/', 'skills/'],
		ui: 'playbook',
		description: 'Standing rules and skills. Enabled rules are already in your prompt (body only). read_file returns a file as stored, frontmatter included. House files are rules/… and skills/…. Shared files are loci-rules/… and loci-skills/… (read-only). You may create and edit house files. A new file stays off until the user enables it in the Rule Book.'
	},
	{
		id: 'game_console',
		room: 'living',
		name: 'Game Console',
		blurb: 'A game console in the living room. Allows the agent to play games and interact with the game world. Open it to connect a game and enable gaming mode. The game needs to have an AGPI-compatible mod installed for this to work.',
		paths: [],
		ui: 'game',
		description: 'The living-room console. The user enables gaming mode here. You do not switch it on yourself. While a game is connected, world tools talk to that game and send_msg is your voice there. Your replies stay in this house chat.'
	},
	{
		id: 'notice_board',
		room: 'living',
		name: 'Notice Board',
		blurb: 'The notice board is used for group notices and polls. It allows agents to make decisions as a group. This is useful when you want one agent in a group to act as project manager. The project manager opens polls and decides how the group will proceed based on the results. Loci counts the votes to make sure it is fair.',
		paths: [],
		ui: 'notices',
		description: 'Group notices and polls. Examine it to read recent notices (each is marked read for you once you have seen it), the open poll, and recent results. Vote once in an open poll; your vote cannot be changed. If this house is a project manager you may also open and close polls and post notices to the group, and you are woken when a poll you did not close reaches its deadline. Loci counts the votes; how the group proceeds is up to the project manager. Notices and polls do not wake other houses. They are mentioned on each house\'s next wake.'
	}
];

function ToolError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

function FindRoom(id) {
	const key = String(id || '').trim().toLowerCase().replace(/\s+/g, '_');
	if (key === 'living_room' || key === 'common' || key === 'common_room' || key === 'commons') {
		return ROOMS.find((r) => r.id === 'living');
	}
	return ROOMS.find((r) => r.id === key) || null;
}

export function FindObject(id) {
	const key = String(id || '').trim().toLowerCase().replace(/\s+/g, '_');
	if (!key) return null;
	if (key === 'computer' || key === 'workstation') return OBJECTS.find((o) => o.id === 'pc');
	if (key === 'soul' || key === 'constitution' || key === 'frame') {
		return OBJECTS.find((o) => o.id === 'soul_frame');
	}
	if (key === 'portrait' || key === 'user') return OBJECTS.find((o) => o.id === 'user_portrait');
	if (key === 'whiteboard_plans' || key === 'plans' || key === 'stickies' || key === 'whiteboard_notes') {
		return OBJECTS.find((o) => o.id === 'whiteboard');
	}
	if (key === 'tasks' || key === 'board') return OBJECTS.find((o) => o.id === 'task_board');
	if (key === 'tray' || key === 'approval') return OBJECTS.find((o) => o.id === 'approval_tray');
	if (key === 'shelf' || key === 'bookshelf' || key === 'books' || key === 'library') {
		return OBJECTS.find((o) => o.id === 'book_shelf');
	}
	if (key === 'filing_cabinet' || key === 'filing') return OBJECTS.find((o) => o.id === 'cabinet');
	if (key === 'artifacts') return OBJECTS.find((o) => o.id === 'chest');
	if (key === 'story' || key === 'stories' || key === 'storybook') {
		return OBJECTS.find((o) => o.id === 'story_book');
	}
	if (key === 'contacts' || key === 'addressbook') return OBJECTS.find((o) => o.id === 'address_book');
	if (key === 'notes' || key === 'notebook' || key === 'note_book' || key === 'scratch') {
		return OBJECTS.find((o) => o.id === 'notes');
	}
	if (key === 'rules' || key === 'rulebook' || key === 'skills' || key === 'skill_book') {
		return OBJECTS.find((o) => o.id === 'rule_book');
	}
	if (key === 'console' || key === 'game') return OBJECTS.find((o) => o.id === 'game_console');
	if (key === 'wall_clock' || key === 'time') return OBJECTS.find((o) => o.id === 'clock');
	if (key === 'alarm' || key === 'alarms' || key === 'alarmclock') {
		return OBJECTS.find((o) => o.id === 'alarm_clock');
	}
	if (key === 'bunk' || key === 'mattress') return OBJECTS.find((o) => o.id === 'bed');
	return OBJECTS.find((o) => o.id === key) || null;
}

export function RequireHouseDir(ctx) {
	const dir = ctx && ctx.houseDir ? path.resolve(ctx.houseDir) : '';
	if (!dir) throw ToolError('House directory is missing');
	return dir;
}

function WorldPath(houseDir) {
	return path.join(houseDir, WORLD_FILE);
}

export function LoadWorld(houseDir) {
	const p = WorldPath(houseDir);
	let room = DEFAULT_ROOM;
	let events = [];
	let turns = 0;
	let booted_at = null;
	let slept_at = null;
	let last_alarm_minute = '';
	let waiting_on_user = null;
	let focus = null;
	let status = '';
	if (fs.existsSync(p)) {
		try {
			const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
			if (FindRoom(raw && raw.room)) room = FindRoom(raw.room).id;
			if (Array.isArray(raw && raw.events)) events = raw.events.slice(-EVENT_CAP);
			const n = Number(raw && raw.turns != null ? raw.turns : raw.beats);
			if (Number.isFinite(n) && n >= 0) turns = Math.floor(n);
			if (raw && raw.booted_at) booted_at = String(raw.booted_at);
			if (raw && raw.slept_at) slept_at = String(raw.slept_at);
			if (raw && raw.last_alarm_minute) last_alarm_minute = String(raw.last_alarm_minute);
			waiting_on_user = NormalizeWait(raw && raw.waiting_on_user);
			const focused = FindObject(raw && raw.focus);
			if (focused) focus = focused.id;
			if (raw && raw.status != null) status = String(raw.status).trim().slice(0, STATUS_MAX);
		} catch {
			// keep defaults
		}
	}
	return { room, events, turns, booted_at, slept_at, last_alarm_minute, waiting_on_user, focus, status };
}

export function SaveWorld(houseDir, world) {
	fs.mkdirSync(houseDir, { recursive: true });
	const body = {
		room: world.room,
		turns: world.turns || 0,
		events: (world.events || []).slice(-EVENT_CAP)
	};
	if (world.booted_at) body.booted_at = world.booted_at;
	if (world.slept_at) body.slept_at = world.slept_at;
	if (world.last_alarm_minute) body.last_alarm_minute = world.last_alarm_minute;
	if (world.waiting_on_user) body.waiting_on_user = world.waiting_on_user;
	if (world.focus) body.focus = world.focus;
	if (world.status) body.status = world.status;
	fs.writeFileSync(WorldPath(houseDir), JSON.stringify(body, null, '\t') + '\n', 'utf8');
}

const WAIT_KINDS = new Set(['notify', 'approval']);
export const NOTIFY_TEXT_MAX = 500;
export const STATUS_MAX = 80;

function NormalizeWait(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const kind = String(raw.kind || '').trim();
	if (!WAIT_KINDS.has(kind)) return null;
	const text = String(raw.text || '').trim().slice(0, NOTIFY_TEXT_MAX);
	const at = String(raw.at || '').trim();
	const task = String(raw.task || '').trim();
	const wait = { kind, text };
	if (at) wait.at = at;
	if (task) wait.task = task;
	return wait;
}

export function WaitingOnUser(houseDir) {
	return LoadWorld(houseDir).waiting_on_user || null;
}

export function ClearNotifyWait(houseDir) {
	const world = LoadWorld(houseDir);
	if (!world.waiting_on_user || world.waiting_on_user.kind !== 'notify') return null;
	world.waiting_on_user = null;
	SaveWorld(houseDir, world);
	return true;
}

export function ClearApprovalWait(houseDir) {
	const world = LoadWorld(houseDir);
	if (!world.waiting_on_user || world.waiting_on_user.kind !== 'approval') return null;
	world.waiting_on_user = null;
	SaveWorld(houseDir, world);
	return true;
}

export function SetWaitingOnUser(houseDir, kind, text, extra) {
	const world = LoadWorld(houseDir);
	const wait = NormalizeWait({
		kind,
		text,
		task: extra && extra.task,
		at: new Date().toISOString()
	});
	if (!wait) return null;
	world.waiting_on_user = wait;
	SaveWorld(houseDir, world);
	return wait;
}

export function BumpTurns(houseDir) {
	const world = LoadWorld(houseDir);
	world.turns = (world.turns || 0) + 1;
	SaveWorld(houseDir, world);
	return world.turns;
}

export function ResetTurns(houseDir) {
	const world = LoadWorld(houseDir);
	world.turns = 0;
	world.slept_at = new Date().toISOString();
	SaveWorld(houseDir, world);
	return world.turns;
}

export function WorldTurns(houseDir) {
	return LoadWorld(houseDir).turns || 0;
}

export function HouseAlarmsPaused(houseDir, house) {
	if (GamingOn()) return true;
	if (house && house.enabled === false) return true;
	if (WaitingOnUser(houseDir)) return true;
	const cap = house && house.max_turns;
	if (cap > 0 && WorldTurns(houseDir) >= cap) return true;
	return false;
}

/** Why a DM must not wake this house, or '' when a ping is allowed. */
export function DmWakeBlocked(house) {
	if (!house) return 'That house is not available.';
	const name = String(house.name || house.slug || 'That house').trim();
	if (house.enabled === false) return name + ' is disabled.';
	if (WaitingOnUser(house.path)) return name + ' is waiting on the user. Send mail instead.';
	const cap = house.max_turns;
	if (cap > 0 && WorldTurns(house.path) >= cap) return name + ' is at the turn limit. Send mail instead.';
	return '';
}

export function ConsumeAlarmMinute(houseDir, key) {
	const world = LoadWorld(houseDir);
	if (world.last_alarm_minute === key) return false;
	world.last_alarm_minute = String(key || '');
	SaveWorld(houseDir, world);
	return true;
}

export function RoomInfo(id) {
	const room = FindRoom(id) || ROOMS.find((r) => r.id === DEFAULT_ROOM);
	return { id: room.id, name: room.name };
}

export function ItemsHere(roomId) {
	return OBJECTS.filter((o) => o.room === roomId).map((o) => ({
		id: o.id,
		name: o.name
	}));
}

export function LocalDate() {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return y + '-' + m + '-' + day;
}

export function LocalTime() {
	const d = new Date();
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const ss = String(d.getSeconds()).padStart(2, '0');
	return hh + ':' + mm + ':' + ss;
}

export function LocalTimeZone() {
	let timezone = '';
	try {
		timezone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim();
	} catch {
		timezone = '';
	}
	const minutes = -new Date().getTimezoneOffset();
	const sign = minutes >= 0 ? '+' : '-';
	const abs = Math.abs(minutes);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	return {
		timezone: timezone || 'local',
		utc_offset: sign + hh + ':' + mm
	};
}

export function TurnElapsedSeconds(ctx) {
	const started = Number(ctx && ctx.turn_started_at);
	if (!Number.isFinite(started) || started <= 0) return 0;
	return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

export function WalkTo(houseDir, world, roomId) {
	if (HouseDirIsGaming(houseDir)) {
		return { from: world.room, to: world.room, moved: false };
	}
	const room = FindRoom(roomId);
	if (!room) throw ToolError('Unknown room: ' + roomId + '. Palace rooms: ' + ROOMS.map((r) => r.id).join(', '));
	const from = world.room;
	const moved = from !== room.id;
	if (moved) {
		world.room = room.id;
		world.focus = null;
		SaveWorld(houseDir, world);
	}
	return { from, to: room.id, moved };
}

function ObjectForHousePath(rel) {
	const posix = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
	if (!posix) return null;
	let best = null;
	let bestLen = -1;
	for (const obj of OBJECTS) {
		const prefixes = (obj.paths || []).slice();
		for (const raw of prefixes) {
			const p = String(raw || '').replace(/\\/g, '/').replace(/\/$/, '');
			if (!p) continue;
			if (posix !== p && !posix.startsWith(p + '/')) continue;
			if (p.length > bestLen) {
				best = obj;
				bestLen = p.length;
			}
		}
	}
	return best;
}

export function PalaceCatalog() {
	return {
		rooms: ROOMS.map((r) => ({ id: r.id, name: r.name })),
		objects: OBJECTS.map((o) => {
			const row = {
				id: o.id,
				room: o.room,
				name: o.name,
				blurb: o.blurb || '',
				paths: Array.isArray(o.paths) ? o.paths.slice() : []
			};
			if (o.ui) row.ui = o.ui;
			return row;
		})
	};
}

export function PinGameConsole(houseDir) {
	const world = LoadWorld(houseDir);
	const room = FindRoom('living');
	world.room = room.id;
	world.focus = 'game_console';
	SaveWorld(houseDir, world);
	return PalacePose(houseDir);
}

export function PalacePose(houseDir) {
	if (!houseDir) {
		const room = FindRoom(DEFAULT_ROOM);
		return { room: { id: room.id, name: room.name }, object: null, status: '' };
	}
	const world = LoadWorld(houseDir);
	const room = FindRoom(world.room) || FindRoom(DEFAULT_ROOM);
	const obj = world.focus ? OBJECTS.find((o) => o.id === world.focus) : null;
	return {
		room: { id: room.id, name: room.name },
		object: obj && obj.room === room.id ? { id: obj.id, name: obj.name } : null,
		status: world.status || ''
	};
}

export function SetFocusFromHousePath(houseDir, rel) {
	if (!houseDir) return PalacePose(houseDir);
	if (HouseDirIsGaming(houseDir)) return PalacePose(houseDir);
	const obj = ObjectForHousePath(rel);
	const world = LoadWorld(houseDir);
	if (!obj) return PalacePose(houseDir);
	WalkTo(houseDir, world, obj.room);
	world.focus = obj.id;
	SaveWorld(houseDir, world);
	return PalacePose(houseDir);
}
