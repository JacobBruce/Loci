import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TrimCalendarFiles } from './events.js';

const INDEX_FILE = 'index.db';
const REMINDER_CAP = 16;
const TEXT_MAX = 500;
const DURATION_MAX = 30 * 24 * 60 * 60;

const SCHEMA = `CREATE TABLE IF NOT EXISTS reminders (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	text TEXT NOT NULL,
	due_at TEXT NOT NULL,
	created_at TEXT NOT NULL,
	duration TEXT NOT NULL
);`;

const UNIT_SECONDS = {
	s: 1,
	sec: 1,
	secs: 1,
	second: 1,
	seconds: 1,
	m: 60,
	min: 60,
	mins: 60,
	minute: 60,
	minutes: 60,
	h: 3600,
	hr: 3600,
	hrs: 3600,
	hour: 3600,
	hours: 3600,
	d: 86400,
	day: 86400,
	days: 86400
};

function ReminderError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

function IndexPath(houseDir) {
	return path.join(houseDir, INDEX_FILE);
}

function WithIndex(houseDir, fn) {
	const db = new DatabaseSync(IndexPath(houseDir));
	try {
		db.exec(SCHEMA);
		return fn(db);
	} finally {
		db.close();
	}
}

function LocalDate(d) {
	const dt = d || new Date();
	const y = dt.getFullYear();
	const m = String(dt.getMonth() + 1).padStart(2, '0');
	const day = String(dt.getDate()).padStart(2, '0');
	return y + '-' + m + '-' + day;
}

/**
 * Relative duration: a number of seconds, or a compact string (30s, 15m, 2h, 1d).
 * @param {unknown} raw
 * @returns {{ seconds: number, label: string }}
 */
export function ParseDuration(raw) {
	if (raw == null || raw === '') {
		throw ReminderError('payload.in is required (relative duration: 30s, 15m, 2h, 1d, or a number of seconds).');
	}
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 1) {
			throw ReminderError('payload.in must be at least 1 second.');
		}
		const seconds = Math.floor(raw);
		if (seconds > DURATION_MAX) throw ReminderError('payload.in is too long (max 30 days).');
		return { seconds, label: String(seconds) };
	}
	const text = String(raw).trim();
	if (/^\d+$/.test(text)) return ParseDuration(Number(text));
	const m = text.match(/^(\d+)\s*([a-z]+)$/i);
	if (!m) {
		throw ReminderError('payload.in must be a relative duration such as 30s, 15m, 2h, or 1d.');
	}
	const n = Number(m[1]);
	const unit = UNIT_SECONDS[m[2].toLowerCase()];
	if (!unit) throw ReminderError('payload.in unit must be s, m, h, or d.');
	if (!Number.isFinite(n) || n < 1) throw ReminderError('payload.in must be at least 1 second.');
	const seconds = n * unit;
	if (seconds > DURATION_MAX) throw ReminderError('payload.in is too long (max 30 days).');
	return { seconds, label: n + m[2].toLowerCase() };
}

function ParsePayload(raw) {
	const src = String(raw || '').trim();
	if (!src) {
		throw ReminderError('payload is required JSON: {"text":"…","in":"1h"}');
	}
	let obj;
	try {
		obj = JSON.parse(src);
	} catch {
		throw ReminderError('payload must be JSON: {"text":"…","in":"1h"}');
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		throw ReminderError('payload must be JSON: {"text":"…","in":"1h"}');
	}
	const text = String(obj.text || '').trim();
	if (!text) throw ReminderError('payload.text is required.');
	if (text.length > TEXT_MAX) throw ReminderError('payload.text is too long (max 500 characters).');
	const dur = ParseDuration(obj.in);
	return { text, ...dur };
}

/**
 * Compact remaining time for the PC reminders list.
 * @param {unknown} seconds
 */
export function FormatRemaining(seconds) {
	const n = Math.max(0, Math.floor(Number(seconds) || 0));
	if (n <= 0) return 'due';
	if (n < 60) return n + 's';
	if (n < 3600) {
		const m = Math.floor(n / 60);
		const s = n % 60;
		return s ? m + 'm ' + s + 's' : m + 'm';
	}
	if (n < 86400) {
		const h = Math.floor(n / 3600);
		const m = Math.floor((n % 3600) / 60);
		return m ? h + 'h ' + m + 'm' : h + 'h';
	}
	const d = Math.floor(n / 86400);
	const h = Math.floor((n % 86400) / 3600);
	return h ? d + 'd ' + h + 'h' : d + 'd';
}

function RowView(row, now) {
	const dueMs = Date.parse(row.due_at);
	const due_in_seconds = Number.isFinite(dueMs)
		? Math.max(0, Math.floor((dueMs - now) / 1000))
		: 0;
	return {
		id: row.id,
		text: row.text,
		in: row.duration,
		due: row.due_at,
		due_in_seconds
	};
}

function CountReminders(db) {
	const row = db.prepare('SELECT COUNT(*) AS n FROM reminders').get();
	return row && row.n ? Number(row.n) : 0;
}

function AppendCalendarLine(houseDir, text, label) {
	const day = LocalDate();
	const rel = 'calendar/' + day + '.md';
	const abs = path.join(houseDir, 'calendar', day + '.md');
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	const line = '- Reminder (in ' + label + '): ' + text;
	if (!fs.existsSync(abs)) {
		fs.writeFileSync(abs, '# ' + day + '\n\n' + line + '\n', 'utf8');
	} else {
		let body = fs.readFileSync(abs, 'utf8');
		if (body.length && !body.endsWith('\n')) body += '\n';
		fs.writeFileSync(abs, body + line + '\n', 'utf8');
	}
	TrimCalendarFiles(houseDir);
	return rel;
}

export function SetReminder(houseDir, payload) {
	const parsed = ParsePayload(payload);
	const now = Date.now();
	const created = new Date(now).toISOString();
	const due = new Date(now + parsed.seconds * 1000).toISOString();
	const row = WithIndex(houseDir, (db) => {
		if (CountReminders(db) >= REMINDER_CAP) {
			throw ReminderError('Reminder cap is ' + REMINDER_CAP + '. Cancel one first.');
		}
		const info = db.prepare(
			'INSERT INTO reminders (text, due_at, created_at, duration) VALUES (?, ?, ?, ?)'
		).run(parsed.text, due, created, parsed.label);
		return {
			id: Number(info.lastInsertRowid),
			text: parsed.text,
			in: parsed.label,
			due,
			due_in_seconds: parsed.seconds
		};
	});
	row.calendar = AppendCalendarLine(houseDir, parsed.text, parsed.label);
	return row;
}

export function ListReminders(houseDir) {
	const now = Date.now();
	return WithIndex(houseDir, (db) => {
		const rows = db.prepare('SELECT id, text, due_at, duration FROM reminders ORDER BY due_at ASC, id ASC').all();
		return {
			reminders: rows.map((r) => RowView(r, now)),
			cap: REMINDER_CAP
		};
	});
}

export function CancelReminder(houseDir, payload) {
	const src = String(payload || '').trim();
	let id;
	if (/^\d+$/.test(src)) {
		id = Number(src);
	} else {
		let obj;
		try {
			obj = JSON.parse(src);
		} catch {
			throw ReminderError('payload must be the reminder id, or JSON {"id":1}.');
		}
		id = Number(obj && obj.id);
	}
	if (!Number.isFinite(id) || id < 1) {
		throw ReminderError('payload must be the reminder id, or JSON {"id":1}.');
	}
	id = Math.floor(id);
	return WithIndex(houseDir, (db) => {
		const row = db.prepare('SELECT id, text, due_at, duration FROM reminders WHERE id = ?').get(id);
		if (!row) throw ReminderError('No reminder with id ' + id + '.');
		db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
		return { cancelled: RowView(row, Date.now()) };
	});
}

export function TakeDueReminders(houseDir) {
	const now = new Date().toISOString();
	return WithIndex(houseDir, (db) => {
		const rows = db.prepare(
			'SELECT id, text, due_at, duration FROM reminders WHERE due_at <= ? ORDER BY due_at ASC, id ASC'
		).all(now);
		if (!rows.length) return [];
		const ids = rows.map((r) => r.id);
		db.prepare(
			'DELETE FROM reminders WHERE id IN (' + ids.map(() => '?').join(', ') + ')'
		).run(...ids);
		return rows.map((r) => RowView(r, Date.now()));
	});
}

function DueLabel(iso, now) {
	const ms = Date.parse(String(iso || ''));
	if (!Number.isFinite(ms)) return '';
	const due = new Date(ms);
	const hh = String(due.getHours()).padStart(2, '0');
	const mm = String(due.getMinutes()).padStart(2, '0');
	const day = LocalDate(due);
	return day === LocalDate(now || new Date()) ? hh + ':' + mm : day + ' ' + hh + ':' + mm;
}

/** A reminder rides on the next wake, which can be hours late, so each line says when it was due. */
export function FormatDueReminders(rows, now) {
	const list = Array.isArray(rows) ? rows : [];
	if (!list.length) return '';
	const lines = ['Due house reminders:'];
	for (const row of list) {
		const when = DueLabel(row.due, now);
		lines.push('- ' + row.text + (when ? ' (due ' + when + ')' : ''));
	}
	return lines.join('\n');
}

/**
 * Append due reminder text to an initiating message. Does not start a turn.
 * Skips (leaves rows queued) when reminders are disabled, the house is asleep, or a game is connected.
 */
export function AttachDueReminders(houseDir, text, opts) {
	const body = String(text || '');
	if (opts && opts.enabled === false) return body;
	if (opts && (opts.asleep || opts.gaming)) return body;
	const due = TakeDueReminders(houseDir);
	if (!due.length) return body;
	const block = FormatDueReminders(due);
	return body ? body + '\n\n' + block : block;
}
