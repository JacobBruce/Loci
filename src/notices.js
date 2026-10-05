import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ListHouses } from './house.js';
import { LociHome } from './mcp-store.js';
import { ParseDuration } from './reminders.js';

const CHOICE_MAX = 8;
const QUESTION_MAX = 200;
const CHOICE_LEN = 80;
const NOTICE_MAX = 1000;
const MIN_SECONDS = 60;
const RECENT_NOTICES = 20;
const RECENT_POLLS = 12;
const USER = 'user';
const LOCI = 'loci';

let dbOverride = '';

export function SetNoticesPathForTest(p) {
	dbOverride = p ? path.resolve(p) : '';
}

function DbPath() {
	return dbOverride || path.join(LociHome(), 'notices.db');
}

function AddColumn(db, table, column, type) {
	const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name);
	if (!cols.includes(column)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
}

function OpenDb() {
	const file = DbPath();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const db = new DatabaseSync(file);
	db.exec(`
		CREATE TABLE IF NOT EXISTS polls (
			id INTEGER PRIMARY KEY,
			grp TEXT NOT NULL,
			question TEXT NOT NULL,
			choices TEXT NOT NULL,
			created_at TEXT NOT NULL,
			closes_at TEXT NOT NULL,
			opened_by TEXT NOT NULL,
			status TEXT NOT NULL,
			closed_at TEXT,
			tally TEXT,
			absent TEXT
		);
		CREATE TABLE IF NOT EXISTS votes (
			poll_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			choice TEXT NOT NULL,
			voted_at TEXT NOT NULL,
			PRIMARY KEY (poll_id, slug)
		);
		CREATE TABLE IF NOT EXISTS notices (
			id INTEGER PRIMARY KEY,
			grp TEXT NOT NULL,
			text TEXT NOT NULL,
			author TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notice_reads (
			notice_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			PRIMARY KEY (notice_id, slug)
		);
	`);
	// Set once the project managers have been woken with the result.
	AddColumn(db, 'polls', 'woke', 'INTEGER NOT NULL DEFAULT 0');
	return db;
}

function WithDb(fn) {
	const db = OpenDb();
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

function GroupOf(house) {
	return String(house && house.group || '').trim();
}

function SlugOf(house) {
	return String(house && house.slug || '').trim();
}

function RequireGroup(house) {
	const group = GroupOf(house);
	if (!group) throw new Error('This house is not in a group.');
	return group;
}

function ParseChoices(raw) {
	const list = Array.isArray(raw) ? raw : String(raw || '').split(/\n+/);
	const out = [];
	const seen = new Set();
	for (const item of list) {
		const text = String(item || '').trim();
		if (!text) continue;
		if (text.length > CHOICE_LEN) throw new Error('A choice is too long (max ' + CHOICE_LEN + ' characters).');
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(text);
	}
	if (out.length < 2) throw new Error('A poll needs at least two different choices.');
	if (out.length > CHOICE_MAX) throw new Error('A poll can have at most ' + CHOICE_MAX + ' choices.');
	return out;
}

function JsonList(raw) {
	try {
		const parsed = JSON.parse(String(raw || '[]'));
		return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [];
	} catch {
		return [];
	}
}

function JsonObject(raw) {
	try {
		const parsed = JSON.parse(String(raw || '{}'));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function VotesFor(db, pollId) {
	return db.prepare('SELECT slug, choice, voted_at FROM votes WHERE poll_id = ? ORDER BY voted_at ASC').all(pollId);
}

function Members(root, group) {
	if (!group || !root) return [];
	return ListHouses(root).filter((h) => GroupOf(h) === group && h.enabled !== false);
}

function NameOf(houses, slug) {
	if (slug === USER) return 'User';
	if (slug === LOCI) return 'Loci';
	const house = houses.find((h) => h.slug === slug);
	return house ? (house.name || house.slug) : slug;
}

function CountVotes(choices, votes) {
	const tally = {};
	for (const choice of choices) tally[choice] = 0;
	for (const vote of votes) {
		if (Object.prototype.hasOwnProperty.call(tally, vote.choice)) tally[vote.choice] += 1;
	}
	return tally;
}

/**
 * `live` adds the running count to an open poll. Only the user's board asks for it; an
 * agent sees the count once the poll closes, so it cannot follow the crowd.
 */
function PollView(poll, votes, slug, houses, live) {
	const mine = votes.find((v) => v.slug === slug);
	const choices = JsonList(poll.choices);
	const view = {
		id: poll.id,
		question: poll.question,
		choices,
		numbered: NumberedChoices(choices),
		created_at: poll.created_at,
		closes_at: poll.closes_at,
		opened_by: NameOf(houses, poll.opened_by),
		status: poll.status,
		voted: !!mine,
		your_choice: mine ? mine.choice : '',
		// Who has voted is public. What they chose stays hidden until the poll closes.
		voters: votes.map((v) => NameOf(houses, v.slug))
	};
	if (poll.status === 'closed') {
		view.closed_at = poll.closed_at || '';
		view.tally = JsonObject(poll.tally);
		view.absent = JsonList(poll.absent);
	} else if (live) {
		view.tally = CountVotes(choices, votes);
		const byChoice = {};
		for (const choice of choices) byChoice[choice] = [];
		for (const vote of votes) {
			if (byChoice[vote.choice]) byChoice[vote.choice].push(NameOf(houses, vote.slug));
		}
		view.voters_by_choice = byChoice;
	}
	return view;
}

function OpenRow(db, group) {
	return db.prepare(
		"SELECT * FROM polls WHERE grp = ? AND status = 'open' ORDER BY id DESC LIMIT 1"
	).get(group) || null;
}

function IsPastDeadline(poll, now) {
	return Date.parse(poll.closes_at) <= (now || Date.now());
}

function NoticeView(row, houses, readSet) {
	return {
		id: row.id,
		text: row.text,
		author: NameOf(houses, row.author),
		created_at: row.created_at,
		unread: readSet ? !readSet.has(row.id) : false
	};
}

function InsertNotice(db, group, text, author, readBy) {
	const info = db.prepare(
		'INSERT INTO notices (grp, text, author, created_at) VALUES (?, ?, ?, ?)'
	).run(group, text, author, new Date().toISOString());
	const id = Number(info.lastInsertRowid);
	const mark = db.prepare('INSERT OR IGNORE INTO notice_reads (notice_id, slug) VALUES (?, ?)');
	for (const slug of readBy || []) {
		if (slug) mark.run(id, slug);
	}
	return id;
}

function ReadSet(db, group, slug) {
	if (!slug) return new Set();
	const rows = db.prepare(
		'SELECT r.notice_id FROM notice_reads r JOIN notices n ON n.id = r.notice_id WHERE n.grp = ? AND r.slug = ?'
	).all(group, slug);
	return new Set(rows.map((r) => r.notice_id));
}

/**
 * The board as one house sees it. `markRead` is set when that house's agent examines it,
 * so each notice is shown to an agent once.
 */
export function BoardForHouse(root, house, opts) {
	const group = GroupOf(house);
	const slug = SlugOf(house);
	const empty = { group: '', project_manager: false, open: null, polls: [], notices: [] };
	if (!group) return empty;
	const houses = root ? ListHouses(root) : [];
	return WithDb((db) => {
		const open = OpenRow(db, group);
		const closed = db.prepare(
			"SELECT * FROM polls WHERE grp = ? AND status = 'closed' ORDER BY id DESC LIMIT ?"
		).all(group, RECENT_POLLS);
		const rows = db.prepare(
			'SELECT * FROM notices WHERE grp = ? ORDER BY id DESC LIMIT ?'
		).all(group, RECENT_NOTICES);
		const reads = opts && opts.reader ? ReadSet(db, group, slug) : null;
		const notices = rows.map((row) => NoticeView(row, houses, reads));
		if (opts && opts.markRead && slug) {
			const mark = db.prepare('INSERT OR IGNORE INTO notice_reads (notice_id, slug) VALUES (?, ?)');
			for (const row of rows) mark.run(row.id, slug);
		}
		return {
			group,
			project_manager: !!(house && house.project_manager),
			open: open ? PollView(open, VotesFor(db, open.id), slug, houses, !!(opts && opts.live)) : null,
			polls: closed.map((poll) => PollView(poll, VotesFor(db, poll.id), slug, houses)),
			notices
		};
	});
}

/**
 * A short line for the next wake: unread notices and an open poll this house has not voted in.
 * Does not mark anything read; examining the Notice Board does.
 */
export function BoardNudge(root, house) {
	const group = GroupOf(house);
	const slug = SlugOf(house);
	if (!group || !slug || house.enabled === false) return '';
	return WithDb((db) => {
		const lines = [];
		const unread = db.prepare(
			'SELECT COUNT(*) AS n FROM notices n WHERE n.grp = ? AND NOT EXISTS ' +
			'(SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.slug = ?)'
		).get(group, slug);
		const count = unread ? Number(unread.n) : 0;
		if (count === 1) lines.push('You have 1 unread group notice. Examine the notice_board to read it.');
		if (count > 1) lines.push('You have ' + count + ' unread group notices. Examine the notice_board to read them.');
		const open = OpenRow(db, group);
		if (open && !IsPastDeadline(open)) {
			const mine = db.prepare('SELECT 1 FROM votes WHERE poll_id = ? AND slug = ?').get(open.id, slug);
			if (!mine) {
				lines.push('An open poll is waiting for your vote: "' + open.question + '" (choices: '
					+ NumberedChoices(JsonList(open.choices)) + '; closes ' + open.closes_at + '). Use send_action action "vote" target "notice_board" with payload {"choice":1}, the choice number.');
			}
		}
		return lines.join('\n');
	});
}

export function OpenPoll(root, house, payload, openedBy) {
	const group = RequireGroup(house);
	const question = String(payload && payload.question || '').trim();
	if (!question) throw new Error('question is required.');
	if (question.length > QUESTION_MAX) throw new Error('question is too long (max ' + QUESTION_MAX + ' characters).');
	const choices = ParseChoices(payload && payload.choices);
	const dur = ParseDuration(payload && payload.in);
	if (dur.seconds < MIN_SECONDS) throw new Error('A poll must stay open for at least 1 minute.');
	const now = new Date();
	const closes = new Date(now.getTime() + dur.seconds * 1000).toISOString();
	const houses = root ? ListHouses(root) : [];
	return WithDb((db) => {
		if (OpenRow(db, group)) throw new Error('This group already has an open poll.');
		const info = db.prepare(
			'INSERT INTO polls (grp, question, choices, created_at, closes_at, opened_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
		).run(group, question, JSON.stringify(choices), now.toISOString(), closes, String(openedBy || USER), 'open');
		const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(Number(info.lastInsertRowid));
		return PollView(poll, [], SlugOf(house), houses);
	});
}

/** `1. East, 2. West` — the numbers an agent may vote with. */
export function NumberedChoices(choices) {
	return (choices || []).map((c, i) => (i + 1) + '. ' + c).join(', ');
}

/**
 * The choice text wins, so a choice that is itself "2" still means that choice.
 * Otherwise a number (1, "2", "2.") picks by position.
 */
function MatchChoice(choices, raw) {
	const text = String(raw == null ? '' : raw).trim();
	if (!text) throw new Error('choice is required.');
	const exact = choices.find((c) => c === text);
	if (exact) return exact;
	const folded = choices.find((c) => c.toLowerCase() === text.toLowerCase());
	if (folded) return folded;
	const key = text.replace(/[.)]$/, '').trim();
	const index = /^\d+$/.test(key) ? Number(key) - 1 : -1;
	if (index >= 0 && index < choices.length) return choices[index];
	throw new Error('choice must be a number from 1 to ' + choices.length + ' or one of: ' + choices.join(', '));
}

export function CastVote(root, house, payload) {
	const group = RequireGroup(house);
	const slug = SlugOf(house);
	if (!slug) throw new Error('Only a house can vote.');
	if (house.enabled === false) throw new Error('This house is disabled.');
	const houses = root ? ListHouses(root) : [];
	return WithDb((db) => {
		const open = OpenRow(db, group);
		if (!open) throw new Error('There is no open poll.');
		if (IsPastDeadline(open)) throw new Error('That poll has closed.');
		const choice = MatchChoice(JsonList(open.choices), payload && payload.choice);
		const prev = db.prepare('SELECT 1 FROM votes WHERE poll_id = ? AND slug = ?').get(open.id, slug);
		if (prev) throw new Error('This house already voted.');
		db.prepare('INSERT INTO votes (poll_id, slug, choice, voted_at) VALUES (?, ?, ?, ?)').run(
			open.id, slug, choice, new Date().toISOString()
		);
		return PollView(open, VotesFor(db, open.id), slug, houses);
	});
}

export function FormatPollResult(poll) {
	const lines = ['Poll closed: "' + poll.question + '"'];
	const tally = poll.tally || {};
	for (const choice of poll.choices || []) lines.push('- ' + choice + ': ' + (tally[choice] || 0));
	const absent = poll.absent || [];
	lines.push(absent.length ? 'Did not vote: ' + absent.join(', ') + '.' : 'Every house voted.');
	return lines.join('\n');
}

/**
 * Count the votes and post the result as a notice. `readBy` already has the result
 * (the managers about to be woken, or the manager who closed it), so it is not unread for them.
 */
function Freeze(db, poll, root, houses, woke, readBy) {
	const votes = VotesFor(db, poll.id);
	const tally = CountVotes(JsonList(poll.choices), votes);
	const voted = new Set(votes.map((v) => v.slug));
	const absent = Members(root, poll.grp).filter((h) => !voted.has(h.slug)).map((h) => h.name || h.slug);
	db.prepare(
		"UPDATE polls SET status = 'closed', closed_at = ?, tally = ?, absent = ?, woke = ? WHERE id = ?"
	).run(new Date().toISOString(), JSON.stringify(tally), JSON.stringify(absent), woke ? 1 : 0, poll.id);
	const closed = db.prepare('SELECT * FROM polls WHERE id = ?').get(poll.id);
	const view = PollView(closed, votes, '', houses);
	InsertNotice(db, poll.grp, FormatPollResult(view), LOCI, readBy);
	return closed;
}

function Managers(houses, group) {
	return houses.filter((h) => GroupOf(h) === group && h.project_manager && h.enabled !== false);
}

/**
 * Close the open poll now. When a project manager closes it, that manager already has the
 * result and nobody is woken; other managers see it as an unread notice. When the user
 * closes it, the managers are woken on the next tick.
 */
export function ClosePoll(root, house, opts) {
	const group = RequireGroup(house);
	const houses = root ? ListHouses(root) : [];
	const byManager = !!(opts && opts.byManager);
	return WithDb((db) => {
		const open = OpenRow(db, group);
		if (!open) throw new Error('There is no open poll.');
		const readBy = byManager
			? [SlugOf(house)]
			: Managers(houses, group).map((h) => h.slug);
		const poll = Freeze(db, open, root, houses, byManager, readBy);
		return PollView(poll, VotesFor(db, poll.id), SlugOf(house), houses);
	});
}

export function AddNotice(root, house, payload, author) {
	const group = RequireGroup(house);
	const text = String(payload && payload.text || '').trim();
	if (!text) throw new Error('text is required.');
	if (text.length > NOTICE_MAX) throw new Error('A notice is too long (max ' + NOTICE_MAX + ' characters).');
	const by = String(author || USER);
	const houses = root ? ListHouses(root) : [];
	return WithDb((db) => {
		const id = InsertNotice(db, group, text, by, by === USER ? [] : [by]);
		const row = db.prepare('SELECT * FROM notices WHERE id = ?').get(id);
		return NoticeView(row, houses, null);
	});
}

/**
 * Close polls past their deadline. The result is posted as a notice right away.
 * Waking the managers waits while a game is connected, like every other wake.
 * @returns {{ slug: string, text: string }[]}
 */
export function TakeClosedPolls(root, now, opts) {
	const when = now instanceof Date ? now : new Date();
	const houses = ListHouses(root);
	const wakes = [];
	WithDb((db) => {
		const due = db.prepare(
			"SELECT * FROM polls WHERE status = 'open' AND closes_at <= ? ORDER BY id ASC"
		).all(when.toISOString());
		for (const row of due) Freeze(db, row, root, houses, false, Managers(houses, row.grp).map((h) => h.slug));
		if (opts && opts.gaming) return;
		const pending = db.prepare(
			"SELECT * FROM polls WHERE status = 'closed' AND woke = 0 ORDER BY id ASC"
		).all();
		for (const row of pending) {
			const text = 'System message: ' + FormatPollResult(PollView(row, VotesFor(db, row.id), '', houses));
			for (const house of Managers(houses, row.grp)) wakes.push({ slug: house.slug, text });
			db.prepare('UPDATE polls SET woke = 1 WHERE id = ?').run(row.id);
		}
	});
	return wakes;
}
