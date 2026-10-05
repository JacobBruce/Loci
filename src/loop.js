import { LoadSettings } from './settings.js';
import { ReadHouse } from './house.js';
import { CallTool } from './tools.js';
import { HouseToolSpecs } from './tool-packs.js';
import { NormalizeImages } from './images.js';
import { AppendSession, ClearSession, LoadSession, SpeechFromSession, StampTurnTime, StripTurnTime, TruncateToLastUser } from './session.js';
import { CompleteRound, IsAbortError } from './llm.js';
import { LoadHouseConfig } from './house-config.js';
import { BuildSystemPrompt, ToolContextFromHouse } from './prompt.js';
import { BuildWireSession, CompactIfNeeded } from './compact.js';
import { AttachDueReminders } from './reminders.js';
import { BoardNudge, TakeClosedPolls } from './notices.js';
import { AttachUnreadMail } from './mail.js';
import { FormatAlarmWake, MsUntilNextMinute } from './alarms.js';
import { BumpTurns, ClearNotifyWait, DmWakeBlocked, HouseAlarmsPaused, LocalTime, PalacePose, WaitingOnUser } from './world.js';
import { GameToolExtra, GamingOn, NoteTurnStarted, OnTurnFinished, ToolRoundLimit } from './game.js';
import { RunAlarmTick } from './tick.js';
import { ActivityFromTool } from './activity.js';

const states = new Map();
let apiGate = Promise.resolve();

function State(slug) {
	let s = states.get(slug);
	if (!s) {
		s = { running: false, queue: [], controller: null, turnStartedAt: 0 };
		states.set(slug, s);
	}
	return s;
}

function WithApiLock(fn) {
	const run = apiGate.then(fn, fn);
	apiGate = run.then(() => {}, () => {});
	return run;
}

export function IsWorking(slug) {
	return !!State(slug).running;
}

export function HouseBusy(slug) {
	const s = State(slug);
	return s.running || s.queue.length > 0;
}

export function TurnStartedAt(slug) {
	const s = states.get(slug);
	if (!s || !s.running) return 0;
	return Number(s.turnStartedAt) || 0;
}

export function WorkingSlugs() {
	const out = [];
	for (const [slug, s] of states) {
		if (s.running) out.push(slug);
	}
	return out;
}

function EndpointFor(provider, cfg) {
	if (provider === 'anthropic') {
		return { apiKey: cfg.anthropic_api_key, baseUrl: cfg.anthropic_base_url };
	}
	if (provider === 'openrouter') {
		return { apiKey: cfg.openrouter_api_key, baseUrl: 'https://openrouter.ai/api/v1' };
	}
	const baseUrl = cfg.openai_base_url;
	if (String(baseUrl || '').toLowerCase().includes('openrouter.ai')) {
		return { apiKey: cfg.openrouter_api_key, baseUrl };
	}
	return { apiKey: cfg.openai_api_key, baseUrl };
}

export function AbortTurn(slug) {
	const s = State(slug);
	s.queue.length = 0;
	if (s.controller) s.controller.abort();
}

function EmitSafe(emit, payload) {
	if (typeof emit === 'function') emit(payload);
}

function StringifyTool(result, maxBytes) {
	const cap = Number(maxBytes) || (80 * 1024);
	let text = JSON.stringify(result);
	if (text.length > cap) {
		text = text.slice(0, cap) + '\n…truncated';
	}
	return text;
}

/** Told to the agent with the last tool result it may get in this turn. */
function RoundLimitNotice(limit) {
	return 'This was tool round ' + limit + ' of ' + limit + ' for this turn. Your next reply cannot run tools; ' +
		'any tool calls in it are skipped. Reply in text: say what is done and what is left. ' +
		'The next message (from the user or a wake) starts a new turn with a fresh limit.';
}

function EmitPose(root, slug, emit, activity) {
	try {
		const house = ReadHouse(root, slug);
		const pose = PalacePose(house.path);
		pose.name = house.name;
		if (activity) pose.activity = activity;
		else if (activity === '') pose.activity = '';
		EmitSafe(emit, { type: 'pose', slug, pose });
	} catch {
		// pose is display-only
	}
}

/**
 * Queue a user chat turn. Returns immediately; the loop runs in the background.
 * @param {string} root
 * @param {string} slug
 * @param {string} text
 * @param {(payload: object) => void} emit
 * @param {string} [from] set when the line is not the user's own words (e.g. `game`)
 */
export function EnqueueChat(root, slug, text, emit, from, images) {
	const trimmed = String(text || '').trim();
	let pics = [];
	if (!from) {
		try {
			pics = NormalizeImages(images);
		} catch (err) {
			throw new Error(err && err.message ? err.message : 'Could not attach that image.');
		}
	}
	if (!trimmed && !pics.length) throw new Error('Message is empty.');
	const house = ReadHouse(root, slug);
	const s = State(slug);
	if (house.enabled === false && !s.running) {
		throw new Error('This house is disabled.');
	}
	if (from) {
		s.queue.push({ kind: 'note', from: String(from), text: trimmed });
		KickPump(root, slug, emit);
		return;
	}
	EmitClearedWait(house, slug, emit);
	s.queue.push({ kind: 'user', text: trimmed, images: pics.length ? pics : undefined });
	KickPump(root, slug, emit);
}

/**
 * Queue the wake for an Approve, Change, or Drop stamp.
 */
export function EnqueueStamp(root, slug, text, emit) {
	const trimmed = String(text || '').trim();
	if (!trimmed) return { woke: false };
	const house = ReadHouse(root, slug);
	if (house.enabled === false) return { woke: false };
	const s = State(slug);
	s.queue.push({ kind: 'stamp', text: trimmed });
	KickPump(root, slug, emit);
	return { woke: true };
}

/**
 * Queue an autonomous ALARMS wake. No-ops if the house is busy, disabled, or at the turn limit.
 * @returns {boolean} true if a wake was queued
 */
export function EnqueueAlarm(root, slug, matches, emit) {
	const house = ReadHouse(root, slug);
	const s = State(slug);
	if (house.enabled === false) return false;
	if (s.running || s.queue.length) return false;
	if (HouseAlarmsPaused(house.path, house)) return false;
	const text = FormatAlarmWake(matches);
	if (!text) return false;
	s.queue.push({ kind: 'alarm', text });
	KickPump(root, slug, emit);
	return true;
}

/**
 * Wake another house with a short ping. A house already in a turn is refused.
 * @returns {{ ok: boolean, error?: string }}
 */
export function EnqueueDm(root, slug, text, emit) {
	const trimmed = String(text || '').trim();
	if (!trimmed) return { ok: false, error: 'Message is empty.' };
	let house;
	try {
		house = ReadHouse(root, slug);
	} catch {
		return { ok: false, error: 'No house with slug "' + slug + '".' };
	}
	const blocked = DmWakeBlocked(house);
	if (blocked) return { ok: false, error: blocked };
	const s = State(slug);
	if (s.running || s.queue.length) {
		const name = String(house.name || house.slug || 'That house').trim();
		return { ok: false, error: name + ' is already awake. Send mail instead.' };
	}
	s.queue.push({ kind: 'dm', text: trimmed });
	KickPump(root, slug, emit);
	return { ok: true };
}

let tickTimer = null;

/**
 * Scan enabled houses once. Matching lines in the same minute are a single wake.
 */
export function TickAlarms(root, now, emit) {
	const result = RunAlarmTick(root, now, {
		isWorking: IsWorking,
		enqueue: (house, matches) => EnqueueAlarm(root, house.slug, matches, emit)
	});
	try {
		for (const wake of TakeClosedPolls(root, now, { gaming: GamingOn() })) {
			EnqueueChat(root, wake.slug, wake.text, emit, 'poll');
		}
	} catch {
		// next tick
	}
	return result;
}

export function StartAlarmsTick(getRoot, emit) {
	if (tickTimer) return;
	const run = () => {
		try {
			const root = typeof getRoot === 'function' ? getRoot() : getRoot;
			TickAlarms(root, new Date(), emit);
		} catch {
			// next tick
		}
	};
	const arm = () => {
		const wait = Math.max(50, MsUntilNextMinute() + 25);
		tickTimer = setTimeout(() => {
			run();
			arm();
		}, wait);
	};
	arm();
}

/**
 * Retry the last user turn. Drops a trailing assistant/tool fragment first,
 * and does not append a second copy of the user line.
 * @returns {{ log: { role: string, text: string }[] }}
 */
export function EnqueueRedo(root, slug, emit) {
	const house = ReadHouse(root, slug);
	const s = State(slug);
	if (s.running) throw new Error('Already working.');
	if (house.enabled === false) throw new Error('This house is disabled.');
	const last = TruncateToLastUser(house.path);
	if (!last) throw new Error('Nothing to redo.');
	EmitClearedWait(house, slug, emit);
	s.queue.push({ kind: 'redo' });
	KickPump(root, slug, emit);
	return { log: SpeechFromSession(LoadSession(house.path)) };
}

/**
 * Wipe the session file. Refused while a turn is running.
 */
export function ClearChat(root, slug) {
	const house = ReadHouse(root, slug);
	const s = State(slug);
	if (s.running) throw new Error('Already working.');
	s.queue.length = 0;
	ClearSession(house.path);
	return { ok: true };
}

function EmitClearedWait(house, slug, emit) {
	if (ClearNotifyWait(house.path)) {
		EmitSafe(emit, { type: 'waiting', slug, name: house.name, waiting: null });
	}
}

function KickPump(root, slug, emit) {
	if (State(slug).running) return;
	Pump(root, slug, emit).catch((err) => {
		if (IsAbortError(err)) return;
		EmitSafe(emit, {
			type: 'error',
			slug,
			text: err && err.message ? String(err.message) : String(err)
		});
	});
}

/** Who a queued line is from when it is not the user typing: game, alarm, dm, or stamp. */
function NoteSource(item) {
	if (!item || item.kind === 'user' || item.kind === 'redo') return '';
	if (item.kind === 'note') return item.from || 'note';
	return item.kind || '';
}

async function Pump(root, slug, emit) {
	const s = State(slug);
	if (s.running) return;
	s.running = true;
	NoteTurnStarted(slug);
	s.controller = new AbortController();
	s.turnStartedAt = Date.now();
	EmitSafe(emit, { type: 'working', slug, working: true, started: s.turnStartedAt });
	try {
		while (s.queue.length && !s.controller.signal.aborted) {
			const item = s.queue.shift();
			const house = ReadHouse(root, slug);
			if (item && (item.kind === 'user' || item.kind === 'redo')) {
				EmitClearedWait(house, slug, emit);
			}
			s.turnStartedAt = Date.now();
			if (!item || item.kind !== 'redo') {
				let content = item && item.text ? item.text : String(item || '');
				content = AttachDueReminders(house.path, content, { gaming: GamingOn() });
				if (!GamingOn()) {
					const nudge = BoardNudge(root, house);
					if (nudge) content = content ? content + '\n\n' + nudge : nudge;
				}
				if (item && (item.kind === 'alarm' || item.kind === 'dm')) content = AttachUnreadMail(house.path, content);
				content = StampTurnTime(content, LocalTime());
				const from = NoteSource(item);
				const row = { role: 'user', content };
				if (from) row.from = from;
				else if (item && item.images && item.images.length) row.images = item.images;
				AppendSession(house.path, row);
				if (from) EmitSafe(emit, { type: 'note', slug, from, text: StripTurnTime(content) });
			}
			BumpTurns(house.path);
			EmitPose(root, slug, emit);
			await RunTurn(root, slug, emit, s.controller.signal);
		}
	} catch (err) {
		if (IsAbortError(err) || s.controller.signal.aborted) {
			EmitSafe(emit, { type: 'error', slug, text: 'Stopped.' });
		} else {
			throw err;
		}
	} finally {
		s.running = false;
		s.controller = null;
		EmitSafe(emit, { type: 'working', slug, working: false });
		try {
			OnTurnFinished(slug);
		} catch {
			// idle and queued game events are optional
		}
		try {
			TickAlarms(root, new Date(), emit);
		} catch {
			// the minute timer still runs
		}
	}
}

async function RunTurn(root, slug, emit, signal) {
	const cfg = LoadSettings();
	const s = State(slug);
	const house0 = ReadHouse(root, slug);
	const houseProv = String(house0.provider || '').trim().toLowerCase();
	const provider = (houseProv === 'anthropic' || houseProv === 'openai' || houseProv === 'openrouter')
		? houseProv
		: cfg.provider;
	const model = String(house0.model || '').trim() || cfg.model;
	const { apiKey, baseUrl } = EndpointFor(provider, cfg);
	let rounds = 0;
	while (true) {
		if (signal.aborted) throw new Error('aborted');
		const house = ReadHouse(root, slug);
		const run = LoadHouseConfig(root, slug);
		const roundLimit = ToolRoundLimit(slug, run.max_tool_rounds);
		// Past the limit the model still gets one reply (tool_choice none), so it can say
		// where it stopped. Any tool calls it makes anyway are recorded as skipped.
		const wrapUp = roundLimit > 0 && rounds >= roundLimit;
		const lastRound = roundLimit > 0 && rounds + 1 === roundLimit;
		const ctx = ToolContextFromHouse(house, {
			turn_started_at: s.turnStartedAt,
			firecrawl_api_key: cfg.firecrawl_api_key,
			signal,
			wake_house: (target, text) => EnqueueDm(root, target, text, emit),
			house_busy: HouseBusy,
			...GameToolExtra(slug)
		});
		const specs = await HouseToolSpecs(ctx);
		const system = BuildSystemPrompt(house);
		if (rounds === 0) {
			try {
				await CompactIfNeeded({
					houseDir: house.path,
					housesRoot: root,
					compactAt: run.compact_at,
					summaryMax: run.summary_max,
					maxTokens: run.max_tokens,
					system,
					tools: specs,
					complete: (extra) => WithApiLock(() => CompleteRound({
						provider,
						model,
						apiKey,
						baseUrl,
						system,
						tools: specs,
						signal,
						reasoningEffort: run.reasoning_effort,
						promptCache: run.prompt_cache,
						...extra
					}))
				});
			} catch {
				// try the turn uncompacted
			}
		}
		const session = BuildWireSession(LoadSession(house.path));
		const round = await WithApiLock(() => CompleteRound({
			provider,
			model,
			apiKey,
			baseUrl,
			system,
			session,
			tools: specs,
			signal,
			maxTokens: run.max_tokens,
			reasoningEffort: run.reasoning_effort,
			promptCache: run.prompt_cache,
			toolChoice: wrapUp ? 'none' : 'auto'
		}));
		const speech = String(round.text || '').trim();
		const calls = round.toolCalls || [];
		const blocks = round.contentBlocks || [];
		const row = { role: 'assistant' };
		if (blocks.length) {
			row.content_blocks = blocks;
		} else {
			row.content = speech;
			if (calls.length) row.tool_calls = calls;
		}
		if (Number(round.contextTokens) > 0) row.context_tokens = Number(round.contextTokens);
		AppendSession(house.path, row);
		if (speech) {
			EmitSafe(emit, { type: 'speech', slug, name: house.name, text: speech });
		}
		if (wrapUp) {
			for (const call of calls) {
				AppendSession(house.path, {
					role: 'tool',
					tool_call_id: call.id,
					name: call.name,
					content: JSON.stringify({ ok: false, skipped: true, error: 'Not run: this turn reached its tool round limit.' })
				});
			}
			EmitSafe(emit, { type: 'error', slug, text: 'Reached the limit of ' + roundLimit + ' tool rounds for this turn.' });
			return;
		}
		if (!calls.length) return;
		const live = GameToolExtra(slug);
		ctx.gaming = live.gaming === true;
		ctx.forward_game = typeof live.forward_game === 'function' ? live.forward_game : null;
		let halted = false;
		for (let i = 0; i < calls.length; i++) {
			const call = calls[i];
			if (signal.aborted) throw new Error('aborted');
			if (!halted) {
				const started = ActivityFromTool(call, undefined, ctx);
				if (started) EmitPose(root, slug, emit, started);
			}
			let result = halted
				? { ok: false, skipped: true, error: 'Turn halted.' }
				: await CallTool(ctx, call.name, call.arguments);
			// First in the object so a truncated result still carries it.
			if (lastRound && i === calls.length - 1) result = { round_limit: RoundLimitNotice(roundLimit), ...result };
			let images;
			if (call.name === 'get_screen' && result && Array.isArray(result.images)) {
				images = result.images;
				delete result.images;
			}
			const toolRow = {
				role: 'tool',
				tool_call_id: call.id,
				name: call.name,
				content: StringifyTool(result, run.max_tool_result)
			};
			if (images && images.length) toolRow.images = images;
			AppendSession(house.path, toolRow);
			if (signal.aborted) throw new Error('aborted');
			if (!halted && result && result.ok === false) EmitPose(root, slug, emit, '');
			else if (!halted) {
				const done = ActivityFromTool(call, result, ctx);
				// No activity (set_status, for one) still refreshes the pose so a new or cleared
				// status shows now. Leaving activity out keeps whatever line is up.
				if (done) EmitPose(root, slug, emit, done);
				else EmitPose(root, slug, emit);
			}
			if (!halted && result && result.halt) {
				halted = true;
				if (result.halt === 'notify' || result.halt === 'approval') {
					EmitSafe(emit, {
						type: 'waiting',
						slug,
						name: house.name,
						waiting: WaitingOnUser(house.path) || { kind: result.halt, text: '' }
					});
				}
			}
		}
		if (halted) return;
		rounds += 1;
	}
}
