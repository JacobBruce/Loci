import fs from 'node:fs';
import path from 'node:path';

export const EVENTS_FILE = 'EVENTS';
export const EVENTS_CAP = 32;
export const CALENDAR_FILE_CAP = 32;
const TEXT_MAX = 200;
const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

function EventError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

export function EventsPath(houseDir) {
	return path.join(houseDir, EVENTS_FILE);
}

export function Pad2(n) {
	return String(n).padStart(2, '0');
}

export function StampFromDate(date) {
	const d = date instanceof Date ? date : new Date(date);
	const ymd = d.getFullYear() + '-' + Pad2(d.getMonth() + 1) + '-' + Pad2(d.getDate());
	const hm = Pad2(d.getHours()) + ':' + Pad2(d.getMinutes());
	return { date: ymd, time: hm, at: ymd + ' ' + hm };
}

function StripQuotes(raw) {
	const s = String(raw || '').trim();
	if (s.length >= 2) {
		const a = s[0];
		const b = s[s.length - 1];
		if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1);
	}
	return s;
}

function FileLines(raw) {
	const text = String(raw || '').replace(/\r\n/g, '\n');
	if (!text) return [];
	const lines = text.split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

function WriteRaw(houseDir, lines) {
	const body = lines.length ? lines.join('\n') + '\n' : '';
	fs.writeFileSync(EventsPath(houseDir), body, 'utf8');
}

export function FormatEventLine(at, text) {
	const stamp = String(at || '').trim();
	const t = String(text || '').trim();
	if (!t) return stamp;
	return stamp + ' ' + JSON.stringify(t);
}

export function ParseEventAt(datePart, timePart) {
	const ymd = String(datePart || '').trim();
	let hm = String(timePart || '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw EventError('Date must be YYYY-MM-DD.');
	if (/^\d{2}:\d{2}:\d{2}$/.test(hm)) hm = hm.slice(0, 5);
	if (!/^\d{2}:\d{2}$/.test(hm)) throw EventError('Time must be HH:MM.');
	const y = Number(ymd.slice(0, 4));
	const mo = Number(ymd.slice(5, 7));
	const d = Number(ymd.slice(8, 10));
	const hh = Number(hm.slice(0, 2));
	const mm = Number(hm.slice(3, 5));
	if (hh > 23 || mm > 59) throw EventError('Time is out of range.');
	const dt = new Date(y, mo - 1, d, hh, mm);
	if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
		throw EventError('Invalid date: ' + ymd);
	}
	return ymd + ' ' + hm;
}

export function ParseEventLine(line) {
	const raw = String(line || '').trim();
	if (!raw || raw.startsWith('#')) return null;
	const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?:\s+(.*))?$/);
	if (!m) throw EventError('Event line must be YYYY-MM-DD HH:MM "text".');
	const at = ParseEventAt(m[1], m[2] + ':' + m[3]);
	return {
		at,
		date: m[1],
		time: m[2] + ':' + m[3],
		text: StripQuotes(m[4] || '')
	};
}

function TryParseLine(line) {
	try {
		return ParseEventLine(line);
	} catch {
		return undefined;
	}
}

export function ReadEvents(houseDir) {
	const p = EventsPath(houseDir);
	const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
	const events = [];
	const errors = [];
	const rows = String(raw || '').replace(/\r\n/g, '\n').split('\n');
	for (let i = 0; i < rows.length; i++) {
		const line = rows[i];
		if (i === rows.length - 1 && line === '') continue;
		try {
			const parsed = ParseEventLine(line);
			if (parsed) events.push({ ...parsed, line: i + 1 });
		} catch (err) {
			errors.push({ line: i + 1, error: err && err.message ? err.message : String(err) });
		}
	}
	events.sort((a, b) => a.at.localeCompare(b.at) || a.line - b.line);
	return { events, errors, raw, path: EVENTS_FILE };
}

export function EnsureEventsFile(houseDir) {
	const p = EventsPath(houseDir);
	if (fs.existsSync(p)) return;
	fs.writeFileSync(p, '', 'utf8');
}

function RequireClean(houseDir) {
	const current = ReadEvents(houseDir);
	if (current.errors.length) {
		throw EventError('EVENTS has invalid lines. Fix the file, then retry.');
	}
	return current;
}

function ParseSetPayload(payload) {
	const raw = String(payload || '').trim();
	if (!raw) throw EventError('payload is required.');
	let date = '';
	let time = '';
	let text = '';
	if (raw.startsWith('{')) {
		let obj;
		try {
			obj = JSON.parse(raw);
		} catch {
			throw EventError('payload JSON must be {"at":"YYYY-MM-DD HH:MM","text":"…"} or {"date":"…","time":"…","text":"…"}.');
		}
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
			throw EventError('payload JSON must be an object.');
		}
		const at = String(obj.at || obj.when || '').trim();
		if (at) {
			const bits = at.split(/[ T]/);
			date = bits[0] || '';
			time = (bits[1] || '').slice(0, 5);
		}
		if (obj.date) date = String(obj.date).trim();
		if (obj.time) time = String(obj.time).trim().slice(0, 5);
		text = String(obj.text || obj.description || '').trim();
	} else {
		const parsed = ParseEventLine(raw);
		if (!parsed) throw EventError('payload is required.');
		return parsed;
	}
	const at = ParseEventAt(date, time);
	if (!text) throw EventError('text is required.');
	if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX);
	return { at, date: at.slice(0, 10), time: at.slice(11), text };
}

export function SetEvent(houseDir, payload) {
	EnsureEventsFile(houseDir);
	const parsed = typeof payload === 'object' && payload && !Array.isArray(payload)
		? ParseSetPayload(JSON.stringify(payload))
		: ParseSetPayload(payload);
	const now = StampFromDate(new Date()).at;
	if (parsed.at < now) throw EventError('That time is in the past.');
	const current = RequireClean(houseDir);
	const exists = current.events.some((row) => row.at === parsed.at && row.text === parsed.text);
	if (!exists && current.events.length >= EVENTS_CAP) {
		throw EventError('At most ' + EVENTS_CAP + ' events.');
	}
	const formatted = FormatEventLine(parsed.at, parsed.text);
	if (exists) {
		return { event: parsed, count: current.events.length, cap: EVENTS_CAP };
	}
	const next = FileLines(current.raw);
	next.push(formatted);
	WriteRaw(houseDir, next);
	return { event: parsed, count: current.events.length + 1, cap: EVENTS_CAP };
}

export function StopEvent(houseDir, payload) {
	EnsureEventsFile(houseDir);
	const raw = typeof payload === 'object' && payload && !Array.isArray(payload)
		? JSON.stringify(payload)
		: String(payload || '').trim();
	if (!raw) throw EventError('payload is required (at, description, or JSON).');
	let at = '';
	let text = '';
	if (raw.startsWith('{')) {
		let obj;
		try {
			obj = JSON.parse(raw);
		} catch {
			throw EventError('payload JSON must be {"at":"…"} or {"text":"…"}.');
		}
		at = String(obj && (obj.at || obj.when) || '').trim().replace('T', ' ').slice(0, 16);
		text = StripQuotes(obj && (obj.text || obj.description) || '');
		if (obj.date && obj.time) {
			at = ParseEventAt(obj.date, String(obj.time).slice(0, 5));
		}
	} else {
		try {
			const parsed = ParseEventLine(raw);
			if (parsed) {
				at = parsed.at;
				text = parsed.text;
			}
		} catch {
			text = StripQuotes(raw);
		}
	}
	if (!at && !text) throw EventError('Say which event to stop (time or description).');
	const current = RequireClean(houseDir);
	const removed = [];
	const next = [];
	for (const line of FileLines(current.raw)) {
		const parsed = TryParseLine(line);
		if (!parsed) {
			next.push(line);
			continue;
		}
		const atMatch = Boolean(at) && parsed.at === at;
		const textMatch = Boolean(text) && parsed.text === text;
		const hit = at && text ? (atMatch && textMatch) : (atMatch || textMatch);
		if (hit) {
			removed.push(parsed);
			continue;
		}
		next.push(line);
	}
	if (!removed.length) throw EventError('No matching event.');
	WriteRaw(houseDir, next);
	return {
		stopped: removed.map((row) => ({ at: row.at, text: row.text })),
		count: ReadEvents(houseDir).events.length,
		cap: EVENTS_CAP
	};
}

export function MatchEvents(houseDir, date) {
	const stamp = StampFromDate(date).at;
	return ReadEvents(houseDir).events.filter((row) => row.at <= stamp);
}

export function DropEvents(houseDir, matches) {
	const drop = new Set((matches || []).map((row) => row.line));
	if (!drop.size) return;
	const current = ReadEvents(houseDir);
	const next = [];
	const rows = FileLines(current.raw);
	for (let i = 0; i < rows.length; i++) {
		if (drop.has(i + 1)) continue;
		next.push(rows[i]);
	}
	WriteRaw(houseDir, next);
}

export function EventsOnDay(houseDir, ymd) {
	const day = String(ymd || '').trim();
	return ReadEvents(houseDir).events.filter((row) => row.date === day);
}

export function UpcomingEvents(houseDir, from, limit) {
	const stamp = StampFromDate(from || new Date()).at;
	const cap = limit == null ? 8 : Math.max(0, Math.floor(Number(limit)));
	return ReadEvents(houseDir).events.filter((row) => row.at >= stamp).slice(0, cap);
}

export function CalendarNoteRel(ymd) {
	return 'calendar/' + String(ymd || '').trim() + '.md';
}

export function CalendarNoteExists(houseDir, ymd) {
	return fs.existsSync(path.join(houseDir, 'calendar', String(ymd || '').trim() + '.md'));
}

export function IsDatedCalendarRel(rel) {
	const posix = String(rel || '').replace(/\\/g, '/');
	if (!posix.startsWith('calendar/')) return false;
	return DATE_FILE_RE.test(posix.slice('calendar/'.length));
}

export function TrimCalendarFiles(houseDir) {
	const dir = path.join(houseDir, 'calendar');
	if (!fs.existsSync(dir)) return [];
	const names = fs.readdirSync(dir).filter((name) => DATE_FILE_RE.test(name)).sort();
	const archived = [];
	while (names.length > CALENDAR_FILE_CAP) {
		const name = names.shift();
		const destDir = path.join(houseDir, 'archive', 'calendar');
		fs.mkdirSync(destDir, { recursive: true });
		let dest = path.join(destDir, name);
		let n = 2;
		while (fs.existsSync(dest)) {
			dest = path.join(destDir, name.replace(/\.md$/, '-' + n + '.md'));
			n++;
		}
		fs.renameSync(path.join(dir, name), dest);
		archived.push(path.relative(houseDir, dest).split(path.sep).join('/'));
	}
	return archived;
}

export function CalendarState(houseDir, year, month) {
	const events = ReadEvents(houseDir).events;
	const days = {};
	for (const row of events) {
		if (!days[row.date]) days[row.date] = { events: [], file: false };
		days[row.date].events.push({ at: row.at, time: row.time, text: row.text });
	}
	const calDir = path.join(houseDir, 'calendar');
	if (fs.existsSync(calDir)) {
		for (const name of fs.readdirSync(calDir)) {
			if (!DATE_FILE_RE.test(name)) continue;
			const day = name.slice(0, 10);
			if (!days[day]) days[day] = { events: [], file: true };
			else days[day].file = true;
		}
	}
	return {
		year,
		month,
		days,
		events: events.map((row) => ({ at: row.at, date: row.date, time: row.time, text: row.text })),
		count: events.length,
		cap: EVENTS_CAP
	};
}
