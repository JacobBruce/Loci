/**
 * AGPI tool surface for the house: tool specs, routing to a connected game during
 * gaming mode, and the read-only calls (list_actions, list_objects, lock_body, get_state).
 * send_action itself lives in palace-actions.js; world state in world.js.
 */
import fs from 'node:fs';
import { ListHouses } from './house.js';
import { AlarmSummaries } from './alarms.js';
import { ReadEvents } from './events.js';
import { PrepareScreen, ScreenEdge } from './images.js';
import { ItemsHere, LoadWorld, RequireHouseDir, RoomInfo, ROOMS, WaitingOnUser, WorldTurns } from './world.js';
import { ArgString, ContextVerbs, ObjectActions, RequireObject, SendAction } from './palace-actions.js';

const OBJECT_LIMIT_MAX = 32;

const AGPI_NAMES = new Set([
	'list_actions',
	'list_objects',
	'send_action',
	'send_msg',
	'get_state',
	'lock_body',
	'get_screen'
]);

const OBJECT_TYPES = [
	{ id: 'item', when: 'Furniture and documents in this palace room.' },
	{ id: 'exit', when: 'Palace rooms you can walk to with send_action go.' }
];

function ToolError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

function TypeIds() {
	return OBJECT_TYPES.map((t) => t.id);
}

function ArgLimit(args) {
	if (!args || args.limit == null || args.limit === '') return OBJECT_LIMIT_MAX;
	const n = Number(args.limit);
	if (!Number.isFinite(n)) throw ToolError('limit must be a number.');
	return Math.max(0, Math.min(OBJECT_LIMIT_MAX, Math.floor(n)));
}

function ScanItems(kind, roomId) {
	if (kind === 'item') {
		return ItemsHere(roomId).map((o) => ({ id: o.id, name: o.name, type: 'item' }));
	}
	if (kind === 'exit') {
		return ROOMS.map((r) => ({ id: r.id, name: r.name, type: 'exit' }));
	}
	return null;
}

function ResidentId(ctx) {
	const slug = String(ctx && ctx.slug || '').trim();
	if (slug) return slug;
	const name = String(ctx && ctx.name || '').trim().toLowerCase().replace(/\s+/g, '_');
	return name || 'self';
}

function IsResidentTarget(ctx, raw) {
	const key = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
	if (!key || key === 'self') return true;
	if (key === ResidentId(ctx).toLowerCase()) return true;
	const name = String(ctx && ctx.name || '').trim().toLowerCase().replace(/\s+/g, '_');
	return Boolean(name) && key === name;
}

function ListActions(ctx, args) {
	RequireHouseDir(ctx);
	const target = ArgString(args, 'target');
	if (target) {
		const obj = RequireObject(target);
		return {
			target: obj.id,
			name: obj.name,
			room: obj.room,
			actions: ObjectActions(obj, ctx)
		};
	}
	return { actions: ContextVerbs() };
}

function ListObjects(ctx, args) {
	const houseDir = RequireHouseDir(ctx);
	const world = LoadWorld(houseDir);
	const rawType = ArgString(args, 'type').toLowerCase();
	const limit = ArgLimit(args);
	const kind = rawType || 'item';
	const scanned = ScanItems(kind, world.room);
	if (!scanned) {
		throw ToolError('Unknown type: ' + rawType + '. Valid: ' + TypeIds().join(', ') + '.');
	}
	const out = {
		type: kind,
		room: RoomInfo(world.room),
		items: scanned.slice(0, limit)
	};
	if (!rawType) out.types = OBJECT_TYPES.map((t) => ({ id: t.id, when: t.when }));
	return out;
}

function LockBody(ctx, args) {
	const houseDir = RequireHouseDir(ctx);
	const world = LoadWorld(houseDir);
	const target = ArgString(args, 'target');
	const id = ResidentId(ctx);
	const name = String(ctx && ctx.name || '').trim() || id;
	if (target && !IsResidentTarget(ctx, target)) {
		throw ToolError(
			'Unknown body: "' + target + '". No other game is connected. Valid: ' +
			id + '. The previous lock is unchanged.'
		);
	}
	return {
		connected: false,
		selected: { id, name, room: world.room },
		available: [{ id, name }]
	};
}

function SendMsg() {
	throw ToolError('No game is connected.');
}

function PlayerState(ctx, world) {
	return {
		name: String(ctx && ctx.name || '').trim() || 'agent',
		slug: String(ctx && ctx.slug || '').trim() || '',
		room: world.room
	};
}

function HouseAge(houseDir) {
	try {
		const st = fs.statSync(houseDir);
		const ms = (st.birthtimeMs && st.birthtimeMs > 0) ? st.birthtimeMs : st.ctimeMs;
		if (!Number.isFinite(ms) || ms <= 0) return { created: null, age_seconds: null };
		return {
			created: new Date(ms).toISOString(),
			age_seconds: Math.max(0, Math.floor((Date.now() - ms) / 1000))
		};
	} catch {
		return { created: null, age_seconds: null };
	}
}

function HouseState(ctx) {
	const age = HouseAge(RequireHouseDir(ctx));
	return {
		name: String(ctx && ctx.name || '').trim() || 'agent',
		slug: String(ctx && ctx.slug || '').trim() || '',
		description: String(ctx && ctx.description || '').trim(),
		group: String(ctx && ctx.group || '').trim(),
		created: age.created,
		age_seconds: age.age_seconds
	};
}

function WakeSchedule(houseDir) {
	const alarms = houseDir ? AlarmSummaries(houseDir) : { next: null, alarms: [] };
	const events = houseDir
		? ReadEvents(houseDir).events.map((row) => ({ at: row.at, text: row.text }))
		: [];
	const nextEvent = events.length ? events[0].at.replace(' ', 'T') : '';
	const keys = [alarms.next || '', nextEvent].filter(Boolean).sort();
	return {
		next: keys[0] || null,
		alarms: (alarms.alarms || []).map((row) => ({
			expr: row.expr,
			text: row.text,
			next: row.next
		})),
		events
	};
}

function HeartbeatState(ctx, world) {
	const houseDir = ctx && ctx.houseDir ? ctx.houseDir : '';
	const wake = WakeSchedule(houseDir);
	return {
		turns: world && world.turns ? world.turns : 0,
		next: wake.next,
		alarms: wake.alarms,
		events: wake.events,
		waiting_on_user: (world && world.waiting_on_user) || null
	};
}

function MemberBrief(house) {
	return {
		slug: house.slug,
		name: house.name,
		project_manager: house.project_manager === true,
		enabled: house.enabled !== false
	};
}

/** Schedule, model, and whether a DM can wake them. Not on the default snapshot. */
function MemberDetail(house, ctx) {
	const brief = MemberBrief(house);
	const wake = WakeSchedule(house.path);
	const waiting = WaitingOnUser(house.path);
	const cap = house.max_turns;
	const busy = ctx && ctx.house_busy;
	return {
		...brief,
		description: String(house.description || '').trim(),
		provider: String(house.provider || '').trim(),
		model: String(house.model || '').trim(),
		next: wake.next,
		alarms: wake.alarms,
		events: wake.events,
		waiting_on_user: !!waiting,
		at_turn_limit: !!(cap > 0 && WorldTurns(house.path) >= cap),
		awake: typeof busy === 'function' ? !!busy(house.slug) : false
	};
}

export function GroupMembers(ctx, opts) {
	if (Array.isArray(ctx && ctx.group_members)) return ctx.group_members;
	const group = String(ctx && ctx.group || '').trim();
	const root = ctx && ctx.housesRoot ? String(ctx.housesRoot).trim() : '';
	const self = String(ctx && ctx.slug || '').trim();
	if (!group || !root) return [];
	const detail = !!(opts && opts.detail);
	return ListHouses(root)
		.filter((h) => String(h.group || '').trim() === group && h.slug !== self)
		.map((h) => detail ? MemberDetail(h, ctx) : MemberBrief(h))
		.sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug))
			|| String(a.slug).localeCompare(String(b.slug)));
}

const STATE_QUERIES = 'room, player, house, group, heartbeat';

function LociSnapshot(ctx, world) {
	return {
		game: 'loci',
		room: RoomInfo(world.room),
		house: HouseState(ctx),
		heartbeat: HeartbeatState(ctx, world),
		group_members: GroupMembers(ctx)
	};
}

function GetScreen() {
	throw ToolError('get_screen needs a connected game.');
}

async function TakeGameScreen(ctx, args) {
	const edge = ScreenEdge(args && args.size);
	const forward = ctx && ctx.forward_game;
	if (typeof forward !== 'function') throw ToolError('No game is connected.');
	const result = await forward('get_screen', {});
	if (result && result.ok === false) {
		return { ok: false, error: result.error || 'The game refused that call.' };
	}
	const filePath = result && typeof result.path === 'string' ? result.path : '';
	if (!filePath.trim()) throw ToolError('The game did not return a screenshot path.');
	const shot = await PrepareScreen(filePath, edge);
	return { ok: true, width: shot.width, height: shot.height, images: [shot.image] };
}

function GetState(ctx, args) {
	const houseDir = RequireHouseDir(ctx);
	const world = LoadWorld(houseDir);
	const query = ArgString(args, 'query').toLowerCase();
	const snap = LociSnapshot(ctx, world);
	if (!query || query === 'here' || query === 'default') return snap;
	if (query === 'room') return { query, room: snap.room };
	if (query === 'player') return { query, player: PlayerState(ctx, world) };
	if (query === 'house') return { query, house: snap.house };
	if (query === 'group') return { query, group: snap.house.group, group_members: GroupMembers(ctx, { detail: true }) };
	if (query === 'heartbeat') return { query, heartbeat: snap.heartbeat };
	throw ToolError('Unknown query: ' + query + '. Valid: (empty), ' + STATE_QUERIES + '.');
}

const HANDLERS = {
	list_actions: ListActions,
	list_objects: ListObjects,
	send_action: SendAction,
	send_msg: SendMsg,
	get_state: GetState,
	lock_body: LockBody,
	get_screen: GetScreen
};

export function IsAgpiTool(name) {
	return AGPI_NAMES.has(String(name || ''));
}

export function AgpiSpecs() {
	return [
		{
			type: 'function',
			function: {
				name: 'list_actions',
				description: 'List verbs in the active game. The active game is the Loci house by default; if another game is connected, this tool talks to that game instead. With no target, returns actions that do not need an object from list_objects (this house: go). With target, returns actions for that thing, each with how/when. Call this instead of guessing verbs. Games differ — do not assume Loci ids.',
				parameters: {
					type: 'object',
					properties: {
						target: { type: 'string', description: 'Optional id from list_objects (item, NPC, … as that game defines)' }
					}
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'list_objects',
				description: 'Scan what is around in the active game. Omit type for that game\'s default scan (this house: items in the current palace room) plus a compact types catalog. Set type to pick a scan (this house: item, exit). Set limit to cap how many items come back. Unknown type → a clear error listing valid types. Other games define their own types (enemies, NPCs, …). Not list_actions — that is verbs for an id you already have.',
				parameters: {
					type: 'object',
					properties: {
						type: { type: 'string', description: 'Which scan. Omit for the default. This house: item, exit' },
						limit: { type: 'integer', description: 'Max items to return. Games clamp this.' }
					}
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'send_action',
				description: 'Perform an action in the active game. When another game is connected, this tool sends an action command to that game instead of Loci. action is a verb string the game parses. target and payload are optional strings — omit them if the game does not use them. What they mean is game-defined (list_actions says how/when). payload is extra text or a JSON string only when that listing says so. Unknown action → a clear error.',
				parameters: {
					type: 'object',
					properties: {
						action: { type: 'string', description: 'Verb, as listed by list_actions' },
						target: { type: 'string', description: 'Optional. What the action applies to, as that game defines' },
						payload: { type: 'string', description: 'Optional extra argument. Opaque string; JSON only if list_actions said so' }
					},
					required: ['action']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'get_state',
				description: 'Ask the active game for a snapshot. Omit query for that game\'s default. In this house the default includes the current palace room, house (name, group, created, age), heartbeat (turn count and next wake from ALARMS or EVENTS), and group members (slug, name, who is a project manager). Named queries (room, player, house, group, heartbeat) return a slice. Unknown query → a clear error. Other games define their own snapshot.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Omit for the default snapshot. This house also accepts: room, player, house, group, heartbeat. group includes description, provider, model, alarms, events, and whether a DM can wake each house.' }
					}
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'send_msg',
				description: 'Say a line as the locked body in a connected game. text is that line. Optional to is another body in that game, when the game uses it. This does not speak in the house chat — your own replies are for the user. Outside gaming mode this returns an error. Not a ping to another Loci house (that is dm).',
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string', description: 'What the locked body says in the game' },
						to: { type: 'string', description: 'Optional. Who the line is aimed at, if that game uses it' }
					},
					required: ['text']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'get_screen',
				description: 'Look at the connected game\'s screen. The picture is the user\'s view. The game saves a picture; you receive that picture, already scaled. size is the longest side, from 128 to 1024 (default 512). The result includes width and height. No game connected, or a game that cannot capture, returns an error.',
				parameters: {
					type: 'object',
					properties: {
						size: { type: 'integer', description: 'Longest side in pixels. Omit for 512. Clamped to 128–1024.' }
					}
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'lock_body',
				description: 'Lock which body you act through when another game is connected. Omit target to get info about the locked body (who they are, other available ids). Set target to lock that id until a later call with a different target. Unknown target → a clear error; the previous lock stays. In this house there is no follower to pick — the lock is always you, and you do not need this tool to walk or act (call list_actions).',
				parameters: {
					type: 'object',
					properties: {
						target: { type: 'string', description: 'Optional. Omit to read the locked target; set to lock that id' }
					}
				}
			}
		}
	];
}

const HOME_WHILE_GAMING = new Set(['search_web', 'get_web_page', 'notify_user', 'open_poll', 'vote', 'close_poll', 'add_notice', 'remove_file', 'set_status']);
// Wake schedules are paused while gaming, so their edits are off rather than sent to the game.
const OFF_WHILE_GAMING = new Set(['download_file', 'dm', 'send_mail', 'set_alarm', 'stop_alarm', 'set_event', 'stop_event']);

function GameRoute(ctx, name, args) {
	if (!ctx || !ctx.gaming) return 'palace';
	if (name === 'send_action') {
		const action = ArgString(args, 'action').toLowerCase();
		if (OFF_WHILE_GAMING.has(action)) return 'off';
		if (HOME_WHILE_GAMING.has(action)) return 'palace';
		return 'game';
	}
	if (AGPI_NAMES.has(name)) return 'game';
	return 'palace';
}

/**
 * @param {{ houseDir: string, name?: string, slug?: string, group?: string, housesRoot?: string, agent_alarms?: boolean, turn_started_at?: number }} ctx
 * @param {string} name
 * @param {object} [args]
 */
export async function CallAgpi(ctx, name, args) {
	const fn = HANDLERS[name];
	if (!fn) return { ok: false, error: 'Unknown tool: ' + name };
	try {
		const route = GameRoute(ctx, name, args);
		if (route === 'off') {
			const action = ArgString(args, 'action').toLowerCase();
			throw ToolError(action + ' is off during gaming mode.');
		}
		if (route === 'game' && name === 'get_screen') return await TakeGameScreen(ctx, args);
		if (route === 'game') {
			const forward = ctx && ctx.forward_game;
			if (typeof forward !== 'function') throw ToolError('No game is connected.');
			const result = await forward(name, args || {});
			if (result && result.ok === false) {
				return { ok: false, error: result.error || 'The game refused that call.' };
			}
			return result && result.ok === true ? result : { ok: true, ...(result || {}) };
		}
		if (name === 'send_msg') throw ToolError('No game is connected.');
		const result = await fn(ctx, args || {});
		return { ok: true, ...result };
	} catch (err) {
		return { ok: false, error: err && err.message ? String(err.message) : String(err) };
	}
}