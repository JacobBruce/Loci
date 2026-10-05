/**
 * Palace send_action: every verb on a palace object (examine, boot, submit, …), the
 * how/when listings for list_actions, and the extra state an examine returns.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SplitLogoffMd, JoinLogoffMd } from './house.js';
import { AlarmSummaries, SetAlarm, StopAlarm } from './alarms.js';
import { SetEvent, StopEvent, ReadEvents, UpcomingEvents, EVENTS_CAP } from './events.js';
import { CancelReminder, ListReminders, SetReminder } from './reminders.js';
import { CountInbox, ResolvePeer, SendMail } from './mail.js';
import { DownloadFile, GetWebPage, SearchWeb } from './web.js';
import { FileTask, SubmitTask, SummarizeCabinet, SummarizeTasks } from './tasks.js';
import { CreateBoardItem, RemoveBoardItem, SummarizeWhiteboard } from './whiteboard.js';
import { CreateContact, RemoveContact, SummarizeContacts } from './contacts.js';
import { CreateBook, RemoveBook, SearchBooks, SummarizeBooks } from './books.js';
import { RemoveChestFile } from './chest.js';
import { HouseDirIsGaming } from './game.js';
import { AddNotice, BoardForHouse, CastVote, ClosePoll, OpenPoll } from './notices.js';
import {
	OBJECTS, ROOMS, ClearApprovalWait, DmWakeBlocked, FindObject, LoadWorld, LocalDate, LocalTime, LocalTimeZone,
	NOTIFY_TEXT_MAX, RequireHouseDir, ResetTurns, RoomInfo, SaveWorld, SetWaitingOnUser, STATUS_MAX,
	TurnElapsedSeconds, WaitingOnUser, WalkTo
} from './world.js';

const INLINE_FILE_MAX = 64 * 1024;

function ToolError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

export function ArgString(args, key) {
	if (!args || args[key] == null) return '';
	const v = args[key];
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v).trim();
}

export function How(action, target) {
	if (target) return 'send_action with action "' + action + '" and target "' + target + '".';
	return 'send_action with action "' + action + '".';
}

export function ContextVerbs() {
	return [
		{
			action: 'go',
			how: How('go', 'office') + ' Target is a room id: ' + ROOMS.map((r) => r.id).join(', ') + '.',
			when: 'You want to change palace rooms.'
		}
	];
}

export function ObjectActions(obj, ctx) {
	const actions = [
		{
			action: 'examine',
			target: obj.id,
			how: How('examine', obj.id),
			when: 'You want this item\'s description, linked paths, and the actions it accepts.'
		}
	];
	if (obj.id === 'pc') {
		actions.push({
			action: 'boot',
			target: 'pc',
			how: How('boot', 'pc') + ' The result includes BOOT.md and last logoff notes.',
			when: 'Fresh context or an unclear task.'
		});
		actions.push({
			action: 'logoff',
			target: 'pc',
			how: How('logoff', 'pc') + ' Payload is the note for next boot. Writes the Logoff notes section of LOGOFF.md. File tools cannot overwrite this file.',
			when: 'You are winding down and want a leftover for the next boot.'
		});
		actions.push({
			action: 'set_reminder',
			target: 'pc',
			how: How('set_reminder', 'pc') + ' Payload JSON {"text":"…","in":"1h"}. in is relative only: 30s, 15m, 2h, 1d, or a number of seconds. One-shot; does not start a turn.',
			when: 'You want a nudge attached to a later turn after some time has passed.'
		});
		actions.push({
			action: 'list_reminders',
			target: 'pc',
			how: How('list_reminders', 'pc'),
			when: 'You want to see pending reminders and their ids.'
		});
		actions.push({
			action: 'cancel_reminder',
			target: 'pc',
			how: How('cancel_reminder', 'pc') + ' Payload is the id, or JSON {"id":1}.',
			when: 'You want to drop a pending reminder.'
		});
		actions.push({
			action: 'notify_user',
			target: 'pc',
			how: How('notify_user', 'pc') + ' Payload JSON {"text":"…"}. Pings the user, ends this turn, and pauses ALARMS until they reply in chat. Speech belongs in the same reply. Does not reset the turn count.',
			when: 'You are stuck or need the user before you can continue.'
		});
		actions.push({
			action: 'send_mail',
			target: 'pc',
			how: How('send_mail', 'pc') + ' Payload JSON {"to":"slug","subject":"…","body":"…"}. to is a house slug, or slug@group. Named group only. Writes mail/inbox on the recipient and mail/sent here. Does not wake them.',
			when: 'You want to assign work to another agent in your group.'
		});
		actions.push({
			action: 'dm',
			target: 'pc',
			how: How('dm', 'pc') + ' Payload JSON {"to":"slug","text":"…"}. to is a house slug, or slug@group. text is at most 256 characters. Wakes that house so they immediately start on a task. Not a substitute for send_mail; task details belong in mail. Answer with dm only when they must wake immediately too.',
			when: 'Another agent in your group must wake and start on a task immediately. Prefer send_mail for communication.'
		});
		actions.push({
			action: 'set_status',
			target: 'pc',
			how: How('set_status', 'pc') + ' Payload is a short status, or JSON {"text":"curious"}. Shown next to your name. Empty payload clears it.',
			when: 'You want the user to see how you are, in a word or two.'
		});
		if (AgentWebOn(ctx)) {
			actions.push({
				action: 'search_web',
				target: 'pc',
				how: How('search_web', 'pc') + ' Payload JSON {"query":"…","search_mode":"web","category":"","location":"","limit":10}. search_mode is web, news, or images. category research or github replaces search_mode. location applies to a general search.',
				when: 'You need web, news, image, academic, or GitHub search results.'
			});
			actions.push({
				action: 'get_web_page',
				target: 'pc',
				how: How('get_web_page', 'pc') + ' Payload JSON {"url":"https://…","format":"markdown"}. format is markdown or html. If Firecrawl fails, the page is fetched directly. Text is capped around 64KB.',
				when: 'You want the contents of a web page.'
			});
			actions.push({
				action: 'download_file',
				target: 'pc',
				how: How('download_file', 'pc') + ' Payload JSON {"url":"https://…","filename":"optional"}. filename is a basename. Writes artifacts/<filename>. http and https only. Overwrites an existing file.',
				when: 'You want a file from the web saved in the chest.'
			});
		}
	}
	if (obj.id === 'alarm_clock') {
		if (AgentAlarmsOn(ctx)) {
			actions.push({
				action: 'set_alarm',
				target: 'alarm_clock',
				how: How('set_alarm', 'alarm_clock') + ' Payload is a crontab line or JSON {"expr":"0 * * * *","text":"hourly"}. 5-field cron, local time, optional description. Replaces a line with the same expr.',
				when: 'You want to add or update a wake in ALARMS.'
			});
			actions.push({
				action: 'stop_alarm',
				target: 'alarm_clock',
				how: How('stop_alarm', 'alarm_clock') + ' Payload is the expr, the description, or JSON {"expr":"…"} / {"text":"…"}.',
				when: 'You want to remove a line from ALARMS.'
			});
		}
	}
	if (obj.id === 'calendar') {
		if (AgentEventsOn(ctx)) {
			actions.push({
				action: 'set_event',
				target: 'calendar',
				how: How('set_event', 'calendar') + ' Payload is YYYY-MM-DD HH:MM "text" or JSON {"date":"…","time":"HH:MM","text":"…"}. Local time, one-shot, dropped after it fires. Cap 32.',
				when: 'You want a one-shot wake at a specific date and time.'
			});
			actions.push({
				action: 'stop_event',
				target: 'calendar',
				how: How('stop_event', 'calendar') + ' Payload is the stamp, the description, or JSON {"at":"…"} / {"text":"…"}.',
				when: 'You want to cancel a one-shot wake in EVENTS.'
			});
		}
	}
	if (obj.id === 'bed') {
		actions.push({
			action: 'sleep',
			target: 'bed',
			how: How('sleep', 'bed') + ' Ends this turn. Speech belongs in the same reply. ALARMS still fires on the next matching minute. Resets the turn count.',
			when: 'You are done with this turn and ready to wind down.'
		});
	}
	if (obj.id === 'whiteboard') {
		actions.push({
			action: 'create_plan',
			target: 'whiteboard',
			how: How('create_plan', 'whiteboard') + ' Payload JSON {"title":"…","body":"…"}. Body is required. Writes plans/<slug>.md. Cap 16.',
			when: 'You need a structured plan that should survive as a file.'
		});
		actions.push({
			action: 'create_note',
			target: 'whiteboard',
			how: How('create_note', 'whiteboard') + ' Payload JSON {"title":"…","body":"optional"}. Writes notes/<slug>.md. Cap 32. Not NOTES.md.',
			when: 'You want a short sticky, not a plan and not scratch NOTES.md.'
		});
		actions.push({
			action: 'remove_plan',
			target: 'whiteboard',
			how: How('remove_plan', 'whiteboard') + ' Payload JSON {"plan":"title or file"}. Deletes that plan file.',
			when: 'A plan is finished or no longer useful.'
		});
		actions.push({
			action: 'remove_note',
			target: 'whiteboard',
			how: How('remove_note', 'whiteboard') + ' Payload JSON {"note":"title or file"}. Deletes that sticky.',
			when: 'A sticky is no longer needed.'
		});
	}
	if (obj.id === 'approval_tray') {
		actions.push({
			action: 'submit',
			target: 'approval_tray',
			how: How('submit', 'approval_tray') + ' Payload JSON {"task":"title or file","work":"what you did"}. Moves that Task Board note to awaiting approval. Pauses the house only when no other tasks are still in progress.',
			when: 'You finished an assigned task and want a user stamp.'
		});
	}
	if (obj.id === 'book_shelf') {
		actions.push({
			action: 'create_book',
			target: 'book_shelf',
			how: How('create_book', 'book_shelf') + ' Payload JSON {"title":"…","body":"…","tags":["optional"],"description":"optional","source":"optional origin"}. Writes library/<letter>/<slug>.md. Body is the memory; do not file an empty book.',
			when: 'You want to file a long-term note, summary, or reference.'
		});
		actions.push({
			action: 'remove_book',
			target: 'book_shelf',
			how: How('remove_book', 'book_shelf') + ' Payload JSON {"book":"title or file"}. Deletes that book.',
			when: 'A book is no longer needed.'
		});
		actions.push({
			action: 'search_books',
			target: 'book_shelf',
			how: How('search_books', 'book_shelf') + ' Payload JSON {"query":"optional","tags":["optional"],"source":"optional origin substring","order":"relevant|accessed|created|popular","limit":10}. Catalog lookup (not bodies). Query matches title, tags, and description; order sorts the hits. Default order is relevant when query is set, otherwise accessed. Relevant with no query returns nothing. Limit defaults to 10 (max 32).',
			when: 'You need to find a filed book by title, tags, source, or how recently it was read.'
		});
	}
	if (obj.id === 'chest') {
		actions.push({
			action: 'remove_file',
			target: 'chest',
			how: How('remove_file', 'chest') + ' Payload JSON {"file":"name or path"}. Deletes that file under artifacts/. A bare name works when only one file has it.',
			when: 'A generated file in the chest is no longer needed.'
		});
	}
	if (obj.id === 'cabinet') {
		actions.push({
			action: 'file',
			target: 'cabinet',
			how: How('file', 'cabinet') + ' Payload JSON {"task":"title or file","note":"optional"}. Files a completed Task Board note into cabinet/YYYY-MM-DD-slug.md and removes it from the board.',
			when: 'The user stamped Approve and the note is sitting in Completed.'
		});
	}
	if (obj.id === 'notice_board') {
		if (ctx && ctx.project_manager) {
			actions.push({
				action: 'open_poll',
				target: 'notice_board',
				how: How('open_poll', 'notice_board') + ' Payload JSON {"question":"…","choices":["…","…"],"in":"4h"}. One open poll per group. in is at least 1m.',
				when: 'The group needs a counted decision and this house is a project manager.'
			});
			actions.push({
				action: 'close_poll',
				target: 'notice_board',
				how: How('close_poll', 'notice_board') + ' No payload. Closes the open poll now.',
				when: 'The poll should end before its deadline.'
			});
			actions.push({
				action: 'add_notice',
				target: 'notice_board',
				how: How('add_notice', 'notice_board') + ' Payload JSON {"text":"…"} (max 1000 characters). Every other house in the group is told on its next wake that a notice is unread. It does not wake them.',
				when: 'The whole group should know something: a decision after a poll, a change of plan, or a standing instruction.'
			});
		}
		actions.push({
			action: 'vote',
			target: 'notice_board',
			how: How('vote', 'notice_board') + ' Payload JSON {"choice":1}: the choice number, or the choice text. One vote for this house. It cannot be changed.',
			when: 'An open poll is waiting and this house has not voted.'
		});
	}
	if (obj.id === 'address_book') {
		actions.push({
			action: 'create_contact',
			target: 'address_book',
			how: How('create_contact', 'address_book') + ' Payload JSON {"name":"…","relation":"optional","body":"optional"}. Writes contacts/<letter>/<slug>.md. Put episodes in the diary.',
			when: 'You want a card for a person you know.'
		});
		actions.push({
			action: 'remove_contact',
			target: 'address_book',
			how: How('remove_contact', 'address_book') + ' Payload JSON {"contact":"name or file"}. Deletes that card.',
			when: 'A contact is no longer needed.'
		});
	}
	return actions;
}

function AgentAlarmsOn(ctx) {
	return !ctx || ctx.agent_alarms !== false;
}

function AgentEventsOn(ctx) {
	return !ctx || ctx.agent_events !== false;
}

function AgentWebOn(ctx) {
	return !ctx || ctx.agent_web !== false;
}

function RequireWeb(ctx) {
	if (!AgentWebOn(ctx)) {
		throw ToolError('Web browsing is disabled for this house. The user can enable it in Manage House.');
	}
}

function ExamineExtra(obj, ctx, houseDir, world) {
	if (obj.id === 'calendar') {
		const extra = { date: LocalDate(), ...LocalTimeZone() };
		if (houseDir) {
			const listed = ReadEvents(houseDir);
			extra.events = {
				path: 'EVENTS',
				items: UpcomingEvents(houseDir, new Date(), 8).map((row) => ({ at: row.at, text: row.text })),
				count: listed.events.length,
				cap: EVENTS_CAP,
				agent_events: AgentEventsOn(ctx)
			};
		}
		return extra;
	}
	if (obj.id === 'clock') {
		return { time: LocalTime(), elapsed_seconds: TurnElapsedSeconds(ctx), ...LocalTimeZone() };
	}
	if (obj.id === 'pc' && houseDir) {
		return { mail: { unread: CountInbox(houseDir), path: 'mail/inbox' } };
	}
	if (obj.id === 'alarm_clock') {
		if (!houseDir) return {};
		return AlarmClockExtra(ctx, houseDir, world);
	}
	if (obj.id === 'task_board' && houseDir) return { tasks: SummarizeTasks(houseDir) };
	if (obj.id === 'approval_tray' && houseDir) {
		const tasks = SummarizeTasks(houseDir);
		return {
			tasks: {
				...tasks,
				items: tasks.items.filter((t) => t.status === 'awaiting-approval')
			}
		};
	}
	if (obj.id === 'cabinet' && houseDir) return { dossiers: SummarizeCabinet(houseDir) };
	if (obj.id === 'book_shelf' && houseDir) return { books: SummarizeBooks(houseDir) };
	if (obj.id === 'whiteboard' && houseDir) return SummarizeWhiteboard(houseDir);
	if (obj.id === 'address_book' && houseDir) return { contacts: SummarizeContacts(houseDir) };
	if (obj.id === 'notice_board') {
		return { board: BoardForHouse(ctx && ctx.housesRoot, ctx, { reader: true, markRead: true }) };
	}
	return {};
}

function AlarmClockExtra(ctx, houseDir, world) {
	const sum = AlarmSummaries(houseDir);
	let since_boot = null;
	if (world && world.booted_at) {
		const ms = Date.parse(world.booted_at);
		if (Number.isFinite(ms)) since_boot = Math.max(0, Math.floor((Date.now() - ms) / 1000));
	}
	return {
		time: LocalTime(),
		...LocalTimeZone(),
		...sum,
		elapsed_seconds: TurnElapsedSeconds(ctx),
		since_boot_seconds: since_boot,
		agent_alarms: AgentAlarmsOn(ctx),
		waiting_on_user: (world && world.waiting_on_user) || null
	};
}

/**
 * Focus the object and build the tool result. The world is always reloaded here:
 * handlers may have saved it (or awaited the web) since SendAction loaded it, and
 * writing back that older copy would undo those changes.
 */
function ObjectResult(obj, extra, ctx, houseDir) {
	const world = houseDir ? LoadWorld(houseDir) : null;
	if (world && obj && !HouseDirIsGaming(houseDir)) {
		world.focus = obj.id;
		SaveWorld(houseDir, world);
	}
	const action = extra && extra.action;
	const body = {
		action,
		target: obj.id,
		name: obj.name,
		room: obj.room
	};
	if (action === 'examine' || action === 'look') {
		body.description = obj.description;
		body.paths = obj.paths;
		body.actions = ObjectActions(obj, ctx);
		Object.assign(body, ExamineExtra(obj, ctx, houseDir, world));
	}
	if (extra) Object.assign(body, extra);
	return body;
}

export function RequireObject(raw) {
	const obj = FindObject(raw);
	if (obj) return obj;
	throw ToolError(
		'Unknown target: ' + String(raw || '') + '. Call list_objects, then list_actions with an item id such as pc, calendar, clock.'
	);
}

function RequirePc(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'pc') throw ToolError(action + ' is a PC action. Use target "pc".');
}

export async function SendAction(ctx, args) {
	const action = ArgString(args, 'action').toLowerCase();
	if (!action) throw ToolError('action is required. Call list_actions to see valid verbs.');
	const target = ArgString(args, 'target');
	const houseDir = RequireHouseDir(ctx);
	const world = LoadWorld(houseDir);

	if (action === 'go' || action === 'move') {
		if (!target) {
			throw ToolError('go needs a target room (' + ROOMS.map((r) => r.id).join(', ') + ').');
		}
		const walk = WalkTo(houseDir, world, target);
		if (!HouseDirIsGaming(houseDir)) {
			world.focus = null;
			SaveWorld(houseDir, world);
		}
		return { action: 'go', target: walk.to, room: RoomInfo(world.room) };
	}

	if (action === 'examine' || action === 'look') {
		if (!target) throw ToolError('examine needs a target item id.');
		const obj = RequireObject(target);
		WalkTo(houseDir, world, obj.room);
		return ObjectResult(obj, { action: 'examine' }, ctx, houseDir);
	}

	if (action === 'boot') {
		RequirePc('boot', target);
		return BootPc(ctx, houseDir, world);
	}

	if (action === 'logoff') {
		RequirePc('logoff', target);
		return LogoffPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'set_reminder') {
		RequirePc('set_reminder', target);
		return SetReminderPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'list_reminders') {
		RequirePc('list_reminders', target);
		return ListRemindersPc(ctx, houseDir, world);
	}

	if (action === 'cancel_reminder') {
		RequirePc('cancel_reminder', target);
		return CancelReminderPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'notify_user') {
		RequirePc('notify_user', target);
		return NotifyUserPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'send_mail') {
		RequirePc('send_mail', target);
		return SendMailPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'dm') {
		RequirePc('dm', target);
		return DmPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'set_status') {
		RequirePc('set_status', target);
		return SetStatusPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'search_web') {
		RequirePc('search_web', target);
		RequireWeb(ctx);
		return SearchWebPc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'get_web_page') {
		RequirePc('get_web_page', target);
		RequireWeb(ctx);
		return GetWebPagePc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'download_file') {
		RequirePc('download_file', target);
		RequireWeb(ctx);
		return DownloadFilePc(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'set_alarm') {
		RequireAlarmClock('set_alarm', target);
		return SetAlarmClock(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'stop_alarm') {
		RequireAlarmClock('stop_alarm', target);
		return StopAlarmClock(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'set_event') {
		RequireCalendar('set_event', target);
		return SetCalendarEvent(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'stop_event') {
		RequireCalendar('stop_event', target);
		return StopCalendarEvent(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'sleep') {
		RequireBed('sleep', target);
		return SleepBed(ctx, houseDir, world);
	}

	if (action === 'submit') {
		RequireApprovalTray('submit', target);
		return SubmitTray(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'file') {
		RequireCabinet('file', target);
		return FileCabinet(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'create_plan' || action === 'create_note') {
		RequireWhiteboard(action, target);
		return CreateWhiteboard(ctx, houseDir, world, action === 'create_note' ? 'note' : 'plan', ArgString(args, 'payload'));
	}

	if (action === 'remove_plan' || action === 'remove_note') {
		RequireWhiteboard(action, target);
		return RemoveWhiteboard(ctx, houseDir, world, action === 'remove_note' ? 'note' : 'plan', ArgString(args, 'payload'));
	}

	if (action === 'remove_file') {
		RequireChest('remove_file', target);
		return RemoveChest(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'create_book') {
		RequireBookShelf('create_book', target);
		return CreateShelfBook(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'remove_book') {
		RequireBookShelf('remove_book', target);
		return RemoveShelfBook(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'search_books') {
		RequireBookShelf('search_books', target);
		return SearchShelfBooks(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'create_contact') {
		RequireAddressBook('create_contact', target);
		return CreateAddressContact(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'remove_contact') {
		RequireAddressBook('remove_contact', target);
		return RemoveAddressContact(ctx, houseDir, world, ArgString(args, 'payload'));
	}

	if (action === 'open_poll' || action === 'vote' || action === 'close_poll' || action === 'add_notice') {
		return NoticeAction(ctx, houseDir, world, action, target, ArgString(args, 'payload'));
	}

	throw ToolError(
		'Unknown action: ' + action + '. Valid here: go, examine, boot, logoff, set_reminder, list_reminders, cancel_reminder, notify_user, send_mail, dm, set_status, search_web, get_web_page, download_file, set_alarm, stop_alarm, set_event, stop_event, sleep, submit, file, create_plan, create_note, remove_plan, remove_note, create_book, remove_book, search_books, create_contact, remove_contact, remove_file, vote, open_poll, close_poll, add_notice. Call list_actions for how/when.'
	);
}

function NoticePayload(raw) {
	const src = String(raw || '').trim();
	if (!src) return {};
	let obj;
	try {
		obj = JSON.parse(src);
	} catch {
		throw ToolError('payload must be JSON.');
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw ToolError('payload must be a JSON object.');
	return obj;
}

function NoticeAction(ctx, houseDir, world, action, target, payload) {
	const obj = FindObject(target || 'notice_board');
	if (!obj || obj.id !== 'notice_board') {
		throw ToolError(action + ' is a Notice Board action. Use target "notice_board".');
	}
	WalkTo(houseDir, world, obj.room);
	if (!HouseDirIsGaming(houseDir)) {
		world.focus = obj.id;
		SaveWorld(houseDir, world);
	}
	const house = {
		slug: ctx && ctx.slug,
		group: ctx && ctx.group,
		name: ctx && ctx.name,
		enabled: true,
		project_manager: !!(ctx && ctx.project_manager)
	};
	const body = NoticePayload(payload);
	if (action === 'open_poll') {
		if (!house.project_manager) throw ToolError('Only a project manager can open a poll.');
		return { action, target: 'notice_board', poll: OpenPoll(ctx.housesRoot, house, body, house.slug) };
	}
	if (action === 'vote') {
		return { action, target: 'notice_board', poll: CastVote(ctx.housesRoot, house, body) };
	}
	if (action === 'close_poll') {
		if (!house.project_manager) throw ToolError('Only a project manager can close a poll.');
		return { action, target: 'notice_board', poll: ClosePoll(ctx.housesRoot, house, { byManager: true }) };
	}
	if (!house.project_manager) throw ToolError('Only a project manager can post a group notice.');
	return { action, target: 'notice_board', notice: AddNotice(ctx.housesRoot, house, body, house.slug) };
}

function RequireAlarmClock(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'alarm_clock') {
		throw ToolError(action + ' is an alarm clock action. Use target "alarm_clock".');
	}
}

function RequireCalendar(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'calendar') {
		throw ToolError(action + ' is a calendar action. Use target "calendar".');
	}
}

function RequireBed(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'bed') throw ToolError(action + ' is a bed action. Use target "bed".');
}

function RequireApprovalTray(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'approval_tray') {
		throw ToolError(action + ' is an Approval Tray action. Use target "approval_tray".');
	}
}

function RequireCabinet(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'cabinet') {
		throw ToolError(action + ' is a Filing Cabinet action. Use target "cabinet".');
	}
}

function RequireWhiteboard(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'whiteboard') {
		throw ToolError(action + ' is a Whiteboard action. Use target "whiteboard".');
	}
}

function RequireChest(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'chest') {
		throw ToolError(action + ' is a Chest action. Use target "chest".');
	}
}

function RequireBookShelf(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'book_shelf') {
		throw ToolError(action + ' is a Book Shelf action. Use target "book_shelf".');
	}
}

function RequireAddressBook(action, target) {
	if (!target) return;
	const obj = FindObject(target);
	if (!obj || obj.id !== 'address_book') {
		throw ToolError(action + ' is an Address Book action. Use target "address_book".');
	}
}

function SetAlarmClock(ctx, houseDir, world, payload) {
	if (!AgentAlarmsOn(ctx)) {
		throw ToolError('Agent-set alarms are disabled for this house. The user can enable them in Manage House.');
	}
	WalkTo(houseDir, world, 'bedroom');
	const obj = OBJECTS.find((o) => o.id === 'alarm_clock');
	const out = SetAlarm(houseDir, payload);
	return ObjectResult(obj, {
		action: 'set_alarm',
		...out
	}, ctx, houseDir);
}

function StopAlarmClock(ctx, houseDir, world, payload) {
	if (!AgentAlarmsOn(ctx)) {
		throw ToolError('Agent-set alarms are disabled for this house. The user can enable them in Manage House.');
	}
	WalkTo(houseDir, world, 'bedroom');
	const obj = OBJECTS.find((o) => o.id === 'alarm_clock');
	const out = StopAlarm(houseDir, payload);
	return ObjectResult(obj, {
		action: 'stop_alarm',
		...out
	}, ctx, houseDir);
}

function SetCalendarEvent(ctx, houseDir, world, payload) {
	if (!AgentEventsOn(ctx)) {
		throw ToolError('Agent-set events are disabled for this house. The user can enable them in Manage House.');
	}
	WalkTo(houseDir, world, 'bedroom');
	const obj = OBJECTS.find((o) => o.id === 'calendar');
	const out = SetEvent(houseDir, payload);
	return ObjectResult(obj, {
		action: 'set_event',
		...out
	}, ctx, houseDir);
}

function StopCalendarEvent(ctx, houseDir, world, payload) {
	if (!AgentEventsOn(ctx)) {
		throw ToolError('Agent-set events are disabled for this house. The user can enable them in Manage House.');
	}
	WalkTo(houseDir, world, 'bedroom');
	const obj = OBJECTS.find((o) => o.id === 'calendar');
	const out = StopEvent(houseDir, payload);
	return ObjectResult(obj, {
		action: 'stop_event',
		...out
	}, ctx, houseDir);
}

function SleepBed(ctx, houseDir, world) {
	WalkTo(houseDir, world, 'bedroom');
	ResetTurns(houseDir);
	const obj = OBJECTS.find((o) => o.id === 'bed');
	return ObjectResult(obj, {
		action: 'sleep',
		halt: 'sleep',
	}, ctx, houseDir);
}

function ParseSubmitPayload(payload) {
	const raw = String(payload || '').trim();
	if (!raw) {
		throw ToolError('payload must be JSON: {"task":"title or file","work":"what you did"}.');
	}
	let obj;
	if (raw.startsWith('{')) {
		try {
			obj = JSON.parse(raw);
		} catch {
			throw ToolError('payload must be JSON: {"task":"title or file","work":"what you did"}.');
		}
	} else {
		throw ToolError('payload must be JSON: {"task":"title or file","work":"what you did"}.');
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		throw ToolError('payload must be JSON: {"task":"title or file","work":"what you did"}.');
	}
	return { task: obj.task, work: obj.work };
}

function SubmitTray(ctx, houseDir, world, payload) {
	const parsed = ParseSubmitPayload(payload);
	WalkTo(houseDir, world, 'office');
	const house = {
		path: houseDir,
		slug: ctx && ctx.slug || '',
		group: ctx && ctx.group || '',
		name: ctx && ctx.name || ''
	};
	const out = SubmitTask(house, parsed);
	const wait = WaitingOnUser(houseDir);
	if (out.paused) {
		SetWaitingOnUser(houseDir, 'approval', out.task.title, { task: out.task.file });
	} else if (wait && wait.kind === 'approval') {
		ClearApprovalWait(houseDir);
	}
	const obj = OBJECTS.find((o) => o.id === 'approval_tray');
	const extra = {
		action: 'submit',
		task: out.task.file,
		title: out.task.title,
		status: out.task.status,
		paused: out.paused,
		in_progress: out.board.in_progress,
		waiting: out.board.awaiting
	};
	if (out.paused) extra.halt = 'approval';
	return ObjectResult(obj, extra, ctx, houseDir);
}

function ParseFilePayload(payload) {
	const raw = String(payload || '').trim();
	const hint = 'payload must be JSON: {"task":"title or file","note":"optional"}.';
	if (!raw) throw ToolError(hint);
	let obj;
	if (raw.startsWith('{')) {
		try {
			obj = JSON.parse(raw);
		} catch {
			throw ToolError(hint);
		}
	} else {
		throw ToolError(hint);
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw ToolError(hint);
	return { task: obj.task, note: obj.note };
}

function FileCabinet(ctx, houseDir, world, payload) {
	const parsed = ParseFilePayload(payload);
	WalkTo(houseDir, world, 'library');
	const house = {
		path: houseDir,
		slug: ctx && ctx.slug || '',
		group: ctx && ctx.group || '',
		name: ctx && ctx.name || ''
	};
	const out = FileTask(house, parsed);
	const obj = OBJECTS.find((o) => o.id === 'cabinet');
	return ObjectResult(obj, {
		action: 'file',
		task: out.task,
		title: out.title,
		dossier: out.dossier
	}, ctx, houseDir);
}

function ParseJsonPayload(payload, hint) {
	const raw = String(payload || '').trim();
	if (!raw) throw ToolError(hint);
	let obj;
	if (raw.startsWith('{')) {
		try {
			obj = JSON.parse(raw);
		} catch {
			throw ToolError(hint);
		}
	} else {
		throw ToolError(hint);
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw ToolError(hint);
	return obj;
}

function CreateWhiteboard(ctx, houseDir, world, kind, payload) {
	const parsed = ParseJsonPayload(payload, 'payload must be JSON: {"title":"…","body":"…"}. Plan body is required; sticky body is optional.');
	WalkTo(houseDir, world, 'office');
	const out = CreateBoardItem({ path: houseDir }, kind, { title: parsed.title, body: parsed.body });
	const obj = OBJECTS.find((o) => o.id === 'whiteboard');
	return ObjectResult(obj, {
		action: kind === 'note' ? 'create_note' : 'create_plan',
		kind: out.kind,
		file: out.file,
		title: out.title,
		count: out.board.count,
		cap: out.board.cap
	}, ctx, houseDir);
}

function RemoveWhiteboard(ctx, houseDir, world, kind, payload) {
	const key = kind === 'note' ? 'note' : 'plan';
	const parsed = ParseJsonPayload(payload, 'payload must be JSON: {"' + key + '":"title or file"}.');
	const query = parsed[key] != null ? parsed[key] : (parsed.title != null ? parsed.title : parsed.file);
	WalkTo(houseDir, world, 'office');
	const out = RemoveBoardItem({ path: houseDir }, kind, query);
	const obj = OBJECTS.find((o) => o.id === 'whiteboard');
	return ObjectResult(obj, {
		action: kind === 'note' ? 'remove_note' : 'remove_plan',
		kind: out.kind,
		file: out.file,
		title: out.title,
		count: out.board.count,
		cap: out.board.cap
	}, ctx, houseDir);
}

function RemoveChest(ctx, houseDir, world, payload) {
	const parsed = ParseJsonPayload(payload, 'payload must be JSON: {"file":"name or path"}.');
	const query = parsed.file != null ? parsed.file : parsed.path;
	WalkTo(houseDir, world, 'library');
	const out = RemoveChestFile(houseDir, query);
	const obj = OBJECTS.find((o) => o.id === 'chest');
	return ObjectResult(obj, {
		action: 'remove_file',
		file: out.file,
		count: out.board.count
	}, ctx, houseDir);
}

function CreateShelfBook(ctx, houseDir, world, payload) {
	const parsed = ParseJsonPayload(payload, 'payload must be JSON: {"title":"…","body":"…","tags":["optional"],"description":"optional","source":"optional origin"}.');
	WalkTo(houseDir, world, 'library');
	const out = CreateBook({ path: houseDir }, parsed);
	const obj = OBJECTS.find((o) => o.id === 'book_shelf');
	return ObjectResult(obj, {
		action: 'create_book',
		file: out.file,
		title: out.title,
		tags: out.tags,
		source: out.source,
		count: out.books.count
	}, ctx, houseDir);
}

function RemoveShelfBook(ctx, houseDir, world, payload) {
	const parsed = ParseJsonPayload(payload, 'payload must be JSON: {"book":"title or file"}.');
	const query = parsed.book != null ? parsed.book : (parsed.title != null ? parsed.title : parsed.file);
	WalkTo(houseDir, world, 'library');
	const out = RemoveBook({ path: houseDir }, query);
	const obj = OBJECTS.find((o) => o.id === 'book_shelf');
	return ObjectResult(obj, {
		action: 'remove_book',
		file: out.file,
		title: out.title,
		count: out.books.count
	}, ctx, houseDir);
}

function SearchShelfBooks(ctx, houseDir, world, payload) {
	const hint = 'payload must be JSON: {"query":"optional","tags":["optional"],"source":"optional origin substring","order":"relevant|accessed|created|popular","limit":10}.';
	const raw = String(payload || '').trim();
	const parsed = raw ? ParseJsonPayload(raw, hint) : {};
	WalkTo(houseDir, world, 'library');
	const out = SearchBooks({ path: houseDir }, parsed);
	const obj = OBJECTS.find((o) => o.id === 'book_shelf');
	return ObjectResult(obj, {
		action: 'search_books',
		query: out.query,
		tags: out.tags,
		source: out.source,
		order: out.order,
		limit: out.limit,
		count: out.count,
		items: out.items
	}, ctx, houseDir);
}

function CreateAddressContact(ctx, houseDir, world, payload) {
	const parsed = ParseJsonPayload(payload, 'payload must be JSON: {"name":"…","relation":"optional","body":"optional"}.');
	WalkTo(houseDir, world, 'living');
	const out = CreateContact({ path: houseDir }, parsed);
	const obj = OBJECTS.find((o) => o.id === 'address_book');
	return ObjectResult(obj, {
		action: 'create_contact',
		file: out.file,
		name: out.name,
		relation: out.relation,
		count: out.contacts.count
	}, ctx, houseDir);
}

function RemoveAddressContact(ctx, houseDir, world, payload) {
	const parsed = ParseJsonPayload(payload, 'payload must be JSON: {"contact":"name or file"}.');
	const query = parsed.contact != null ? parsed.contact : (parsed.name != null ? parsed.name : parsed.file);
	WalkTo(houseDir, world, 'living');
	const out = RemoveContact({ path: houseDir }, query);
	const obj = OBJECTS.find((o) => o.id === 'address_book');
	return ObjectResult(obj, {
		action: 'remove_contact',
		file: out.file,
		name: out.name,
		count: out.contacts.count
	}, ctx, houseDir);
}

function SetReminderPc(ctx, houseDir, world, payload) {
	WalkTo(houseDir, world, 'office');
	const obj = OBJECTS.find((o) => o.id === 'pc');
	const row = SetReminder(houseDir, payload);
	return ObjectResult(obj, {
		action: 'set_reminder',
		reminder: row
	}, ctx, houseDir);
}

function ListRemindersPc(ctx, houseDir, world) {
	WalkTo(houseDir, world, 'office');
	const obj = OBJECTS.find((o) => o.id === 'pc');
	const listed = ListReminders(houseDir);
	return ObjectResult(obj, {
		action: 'list_reminders',
		enabled: true,
		...listed
	}, ctx, houseDir);
}

function CancelReminderPc(ctx, houseDir, world, payload) {
	WalkTo(houseDir, world, 'office');
	const obj = OBJECTS.find((o) => o.id === 'pc');
	const out = CancelReminder(houseDir, payload);
	return ObjectResult(obj, {
		action: 'cancel_reminder',
		...out
	}, ctx, houseDir);
}

function ParseNotifyText(payload) {
	const raw = String(payload || '').trim();
	if (!raw) throw ToolError('notify_user needs payload text, or JSON {"text":"…"}.');
	let text = raw;
	if (raw.startsWith('{')) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && parsed.text != null) {
				text = String(parsed.text).trim();
			}
		} catch {
			// treat the raw string as the message
		}
	}
	if (!text) throw ToolError('notify_user needs payload text, or JSON {"text":"…"}.');
	return text.slice(0, NOTIFY_TEXT_MAX);
}

function NotifyUserPc(ctx, houseDir, world, payload) {
	const text = ParseNotifyText(payload);
	WalkTo(houseDir, world, 'office');
	SetWaitingOnUser(houseDir, 'notify', text);
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'notify_user',
		halt: 'notify',
		waiting: 1
	}, ctx, houseDir);
}

const DM_TEXT_MAX = 256;

function ParseDmPayload(payload) {
	const hint = 'payload must be JSON: {"to":"slug","text":"…"}';
	const raw = String(payload || '').trim();
	if (!raw) throw ToolError(hint);
	let obj;
	try {
		obj = JSON.parse(raw);
	} catch {
		throw ToolError(hint);
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw ToolError(hint);
	const text = String(obj.text || '').trim();
	if (!text) throw ToolError('text is required.');
	if (text.length > DM_TEXT_MAX) {
		throw ToolError('text is too long (max ' + DM_TEXT_MAX + ' characters). Send the details with send_mail.');
	}
	return { to: obj.to, text };
}

function FormatDmWake(ctx, text) {
	const name = String(ctx && ctx.name || '').trim();
	const slug = String(ctx && ctx.slug || '').trim();
	const who = name || slug || 'An agent';
	const from = slug ? who + ' (' + slug + ')' : who;
	return from + ' sent you a DM: ' + text;
}

function DmPc(ctx, houseDir, world, payload) {
	const parsed = ParseDmPayload(payload);
	const dest = ResolvePeer(ctx, ParseAddressForDm(parsed.to));
	const blocked = DmWakeBlocked(dest);
	if (blocked) throw ToolError(blocked);
	const wake = ctx && ctx.wake_house;
	if (typeof wake !== 'function') throw ToolError('Could not wake that house.');
	const result = wake(dest.slug, FormatDmWake(ctx, parsed.text));
	if (!result || result.ok === false) {
		throw ToolError(result && result.error ? result.error : 'Could not wake that house.');
	}
	WalkTo(houseDir, world, 'office');
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'dm',
		delivered: true,
		to: dest.slug
	}, ctx, houseDir);
}

function ParseAddressForDm(raw) {
	const src = String(raw || '').trim();
	if (!src) throw ToolError('payload.to is required (house slug, or slug@group).');
	if (/^user$/i.test(src) || /^user@/i.test(src)) {
		throw ToolError('There is no ping for the user. Use notify_user when you are stuck.');
	}
	const at = src.lastIndexOf('@');
	if (at <= 0) return { slug: src, group: '' };
	return { slug: src.slice(0, at).trim(), group: src.slice(at + 1).trim() };
}

function SendMailPc(ctx, houseDir, world, payload) {
	WalkTo(houseDir, world, 'office');
	const out = SendMail(ctx, payload);
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'send_mail',
		...out
	}, ctx, houseDir);
}

function ParseStatusText(payload) {
	const raw = String(payload || '').trim();
	if (!raw) return '';
	let text = raw;
	if (raw.startsWith('{')) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && parsed.text != null) {
				text = String(parsed.text).trim();
			}
		} catch {
			// treat the raw string as the status
		}
	}
	return text.slice(0, STATUS_MAX);
}

async function SearchWebPc(ctx, houseDir, world, payload) {
	WalkTo(houseDir, world, 'office');
	const out = await SearchWeb(payload, { apiKey: ctx && ctx.firecrawl_api_key, signal: ctx && ctx.signal });
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'search_web',
		...out
	}, ctx, houseDir);
}

async function GetWebPagePc(ctx, houseDir, world, payload) {
	WalkTo(houseDir, world, 'office');
	const out = await GetWebPage(payload, { apiKey: ctx && ctx.firecrawl_api_key, signal: ctx && ctx.signal });
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'get_web_page',
		...out
	}, ctx, houseDir);
}

async function DownloadFilePc(ctx, houseDir, world, payload) {
	WalkTo(houseDir, world, 'office');
	const out = await DownloadFile(houseDir, payload, { signal: ctx && ctx.signal });
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'download_file',
		...out
	}, ctx, houseDir);
}

function SetStatusPc(ctx, houseDir, world, payload) {
	const text = ParseStatusText(payload);
	WalkTo(houseDir, world, 'office');
	world.status = text;
	SaveWorld(houseDir, world);
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'set_status',
		status: text
	}, ctx, houseDir);
}

function ReadHouseText(houseDir, rel) {
	const p = path.join(houseDir, rel);
	const out = { path: rel, text: '' };
	if (!fs.existsSync(p)) return out;
	const cap = CapInline(fs.readFileSync(p, 'utf8'));
	out.text = cap.text;
	if (cap.truncated) out.truncated = true;
	return out;
}

/** Cap text at INLINE_FILE_MAX bytes, cutting on a UTF-8 character boundary. */
function CapInline(text) {
	const value = String(text || '');
	if (Buffer.byteLength(value, 'utf8') <= INLINE_FILE_MAX) return { text: value };
	const buf = Buffer.from(value, 'utf8');
	let end = INLINE_FILE_MAX;
	// Back up over continuation bytes (10xxxxxx) so a character is never split.
	while (end > 0 && (buf[end] & 0xC0) === 0x80) end--;
	return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}

function ReadLogoffNotes(houseDir) {
	const p = path.join(houseDir, 'LOGOFF.md');
	const out = { path: 'LOGOFF.md', text: '' };
	if (!fs.existsSync(p)) return out;
	const cap = CapInline(SplitLogoffMd(fs.readFileSync(p, 'utf8')).notes);
	out.text = cap.text;
	if (cap.truncated) out.truncated = true;
	return out;
}

function BootPc(ctx, houseDir, world) {
	WalkTo(houseDir, world, 'office');
	const now = LoadWorld(houseDir);
	now.booted_at = new Date().toISOString();
	SaveWorld(houseDir, now);
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'boot',
		powered: true,
		boot: ReadHouseText(houseDir, 'BOOT.md'),
		logoff: ReadLogoffNotes(houseDir),
		mail: { unread: CountInbox(houseDir), path: 'mail/inbox' }
	}, ctx, houseDir);
}

function LogoffPc(ctx, houseDir, world, payload) {
	if (Buffer.byteLength(payload, 'utf8') > INLINE_FILE_MAX) {
		throw ToolError('payload is too large (max 64KiB).');
	}
	WalkTo(houseDir, world, 'office');
	const p = path.join(houseDir, 'LOGOFF.md');
	const prev = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
	const split = SplitLogoffMd(prev);
	const text = JoinLogoffMd(split.ritual, payload);
	fs.writeFileSync(p, text, 'utf8');
	const obj = OBJECTS.find((o) => o.id === 'pc');
	return ObjectResult(obj, {
		action: 'logoff',
		logoff: {
			path: 'LOGOFF.md',
			text: payload
		}
	}, ctx, houseDir);
}
