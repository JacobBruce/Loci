import fs from 'node:fs';
import path from 'node:path';

export const ALARMS_FILE = 'ALARMS';
export const ALARMS_CAP = 16;
const TEXT_MAX = 200;
const NEXT_SCAN_MINUTES = 8 * 24 * 60;

const FIELD_BOUNDS = [
	{ min: 0, max: 59 },
	{ min: 0, max: 23 },
	{ min: 1, max: 31 },
	{ min: 1, max: 12 },
	{ min: 0, max: 7 }
];

function AlarmError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

export function AlarmsPath(houseDir) {
	return path.join(houseDir, ALARMS_FILE);
}

export function MinuteKey(date) {
	const d = date instanceof Date ? date : new Date(date);
	const y = d.getFullYear();
	const mo = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return y + '-' + mo + '-' + day + 'T' + hh + ':' + mm;
}

export function MsUntilNextMinute(now) {
	const t = now instanceof Date ? now.getTime() : (now == null ? Date.now() : Number(now));
	return 60000 - (t % 60000);
}

function ParseField(src, bound) {
	const raw = String(src || '').trim();
	if (!raw) throw AlarmError('Cron field is empty.');
	const allowed = new Set();
	let star = false;
	for (const part of raw.split(',')) {
		const bit = part.trim();
		if (!bit) throw AlarmError('Empty cron list item.');
		let range = bit;
		let step = 1;
		const slash = bit.indexOf('/');
		if (slash >= 0) {
			range = bit.slice(0, slash);
			step = Number(bit.slice(slash + 1));
			if (!Number.isInteger(step) || step < 1) {
				throw AlarmError('Cron step must be a positive integer.');
			}
		}
		if (range === '*') {
			star = true;
			for (let n = bound.min; n <= bound.max; n += step) allowed.add(n);
			continue;
		}
		const dash = range.indexOf('-');
		if (dash >= 0) {
			const a = Number(range.slice(0, dash));
			const b = Number(range.slice(dash + 1));
			if (!Number.isInteger(a) || !Number.isInteger(b) || a < bound.min || b > bound.max || a > b) {
				throw AlarmError('Cron range is out of bounds: ' + bit);
			}
			for (let n = a; n <= b; n += step) allowed.add(n);
			continue;
		}
		const n = Number(range);
		if (!Number.isInteger(n) || n < bound.min || n > bound.max) {
			throw AlarmError('Cron value is out of bounds: ' + bit);
		}
		if (step !== 1 && slash >= 0) {
			for (let v = n; v <= bound.max; v += step) allowed.add(v);
		} else {
			allowed.add(n);
		}
	}
	if (bound.max === 7 && allowed.has(7)) allowed.add(0);
	return { allowed, star };
}

export function ParseCronExpr(expr) {
	const parts = String(expr || '').trim().split(/\s+/);
	if (parts.length !== 5) {
		throw AlarmError('Cron expression must have 5 fields (minute hour day month weekday).');
	}
	return parts.map((part, i) => ParseField(part, FIELD_BOUNDS[i]));
}

export function CronMatches(expr, date) {
	const d = date instanceof Date ? date : new Date(date);
	const fields = ParseCronExpr(expr);
	const minute = d.getMinutes();
	const hour = d.getHours();
	const day = d.getDate();
	const month = d.getMonth() + 1;
	const weekday = d.getDay();
	if (!fields[0].allowed.has(minute)) return false;
	if (!fields[1].allowed.has(hour)) return false;
	if (!fields[3].allowed.has(month)) return false;
	const domOk = fields[2].star || fields[2].allowed.has(day);
	const dowOk = fields[4].star || fields[4].allowed.has(weekday);
	if (!fields[2].star && !fields[4].star) return domOk || dowOk;
	return domOk && dowOk;
}

function StripQuotes(raw) {
	const s = String(raw || '').trim();
	if (s.length >= 2) {
		const a = s[0];
		const b = s[s.length - 1];
		if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
			return s.slice(1, -1);
		}
	}
	return s;
}

function ParseDescription(raw) {
	const s = String(raw || '').trim();
	if (!s) return '';
	if (s.startsWith('"')) {
		try {
			const parsed = JSON.parse(s);
			if (typeof parsed === 'string') return parsed;
		} catch {
			// fall through
		}
	}
	return StripQuotes(s);
}

export function ParseAlarmLine(line) {
	const trimmed = String(line || '').trim();
	if (!trimmed || trimmed.startsWith('#')) return null;
	const m = trimmed.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
	if (!m) throw AlarmError('Alarm line must be 5 cron fields and an optional description.');
	const expr = [m[1], m[2], m[3], m[4], m[5]].join(' ');
	ParseCronExpr(expr);
	let text = ParseDescription(m[6] || '');
	if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX);
	return { expr, text };
}

export function FormatAlarmLine(expr, text) {
	const e = String(expr || '').trim();
	const t = String(text || '').trim();
	if (!t) return e;
	return e + ' ' + JSON.stringify(t);
}

export function ParseAlarmsFile(body) {
	const src = String(body || '').replace(/\r\n/g, '\n');
	const alarms = [];
	const errors = [];
	const rows = src.split('\n');
	for (let i = 0; i < rows.length; i++) {
		try {
			const parsed = ParseAlarmLine(rows[i]);
			if (parsed) alarms.push({ ...parsed, line: i + 1 });
		} catch (err) {
			errors.push({ line: i + 1, error: err && err.message ? String(err.message) : String(err) });
		}
	}
	return { alarms, errors };
}

export function ReadAlarms(houseDir) {
	const p = AlarmsPath(houseDir);
	if (!fs.existsSync(p)) return { alarms: [], errors: [], raw: '' };
	const raw = fs.readFileSync(p, 'utf8');
	return { ...ParseAlarmsFile(raw), raw };
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
	fs.writeFileSync(AlarmsPath(houseDir), body, 'utf8');
}

function TryParseLine(line) {
	try {
		return ParseAlarmLine(line);
	} catch {
		return undefined;
	}
}

export function WriteAlarms(houseDir, alarms) {
	const list = Array.isArray(alarms) ? alarms : [];
	if (list.length > ALARMS_CAP) {
		throw AlarmError('At most ' + ALARMS_CAP + ' alarms.');
	}
	const lines = [];
	for (const row of list) {
		ParseCronExpr(row.expr);
		lines.push(FormatAlarmLine(row.expr, row.text));
	}
	WriteRaw(houseDir, lines);
	return { alarms: list.map((row, i) => ({ expr: row.expr, text: String(row.text || ''), line: i + 1 })), path: ALARMS_FILE };
}

export function EnsureAlarmsFile(houseDir, seed) {
	const p = AlarmsPath(houseDir);
	if (fs.existsSync(p)) return;
	const text = seed == null ? '' : String(seed);
	fs.writeFileSync(p, text, 'utf8');
}

function ParsePayloadObject(payload) {
	const raw = String(payload || '').trim();
	if (!raw) throw AlarmError('payload is required.');
	if (raw.startsWith('{')) {
		let obj;
		try {
			obj = JSON.parse(raw);
		} catch {
			throw AlarmError('payload must be a cron line or JSON {"expr":"0 * * * *","text":"hourly"}.');
		}
		if (!obj || typeof obj !== 'object') {
			throw AlarmError('payload JSON must be an object.');
		}
		return obj;
	}
	const parsed = ParseAlarmLine(raw);
	if (!parsed) throw AlarmError('payload is not a valid alarm line.');
	return parsed;
}

export function SetAlarm(houseDir, payload) {
	const obj = ParsePayloadObject(payload);
	const expr = String(obj.expr || obj.cron || '').trim();
	if (!expr) throw AlarmError('payload.expr is required (5-field cron).');
	ParseCronExpr(expr);
	let text = StripQuotes(obj.text || obj.description || '');
	if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX);
	const current = ReadAlarms(houseDir);
	if (current.errors.length) {
		throw AlarmError('ALARMS has invalid lines. Fix the file in Manage House, then retry.');
	}
	const exists = current.alarms.some((row) => row.expr === expr);
	if (!exists && current.alarms.length >= ALARMS_CAP) {
		throw AlarmError('At most ' + ALARMS_CAP + ' alarms.');
	}
	const formatted = FormatAlarmLine(expr, text);
	const next = [];
	let replaced = false;
	for (const line of FileLines(current.raw)) {
		const parsed = TryParseLine(line);
		if (parsed && parsed.expr === expr && !replaced) {
			next.push(formatted);
			replaced = true;
			continue;
		}
		next.push(line);
	}
	if (!replaced) next.push(formatted);
	WriteRaw(houseDir, next);
	const written = ReadAlarms(houseDir);
	const row = written.alarms.find((a) => a.expr === expr);
	return { alarm: row, count: written.alarms.length };
}

export function StopAlarm(houseDir, payload) {
	const raw = String(payload || '').trim();
	if (!raw) throw AlarmError('payload is required (expr, description, or JSON).');
	let expr = '';
	let text = '';
	if (raw.startsWith('{')) {
		let obj;
		try {
			obj = JSON.parse(raw);
		} catch {
			throw AlarmError('payload JSON must be {"expr":"…"} or {"text":"…"}.');
		}
		expr = String(obj && (obj.expr || obj.cron) || '').trim();
		text = StripQuotes(obj && (obj.text || obj.description) || '');
	} else {
		try {
			const parsed = ParseAlarmLine(raw);
			if (parsed) {
				expr = parsed.expr;
				text = parsed.text;
			}
		} catch {
			text = StripQuotes(raw);
		}
	}
	if (!expr && !text) throw AlarmError('Say which alarm to stop (expr or description).');
	const current = ReadAlarms(houseDir);
	if (current.errors.length) {
		throw AlarmError('ALARMS has invalid lines. Fix the file in Manage House, then retry.');
	}
	const removed = [];
	const next = [];
	for (const line of FileLines(current.raw)) {
		const parsed = TryParseLine(line);
		if (parsed && ((expr && parsed.expr === expr) || (text && parsed.text === text))) {
			removed.push(parsed);
			continue;
		}
		next.push(line);
	}
	if (!removed.length) throw AlarmError('No matching alarm.');
	WriteRaw(houseDir, next);
	return { stopped: removed.map((row) => ({ expr: row.expr, text: row.text })), count: ReadAlarms(houseDir).alarms.length };
}

export function MatchAlarms(houseDir, date) {
	const { alarms } = ReadAlarms(houseDir);
	const out = [];
	for (const row of alarms) {
		try {
			if (CronMatches(row.expr, date)) out.push(row);
		} catch {
			// skip invalid
		}
	}
	return out;
}

export function NextAlarmFire(expr, from) {
	const start = from instanceof Date ? new Date(from.getTime()) : new Date(from);
	start.setSeconds(0, 0);
	start.setMinutes(start.getMinutes() + 1);
	for (let i = 0; i < NEXT_SCAN_MINUTES; i++) {
		if (CronMatches(expr, start)) return new Date(start.getTime());
		start.setMinutes(start.getMinutes() + 1);
	}
	return null;
}

export function AlarmSummaries(houseDir, from) {
	const now = from instanceof Date ? from : new Date();
	const { alarms, errors } = ReadAlarms(houseDir);
	const list = [];
	let soonest = null;
	for (const row of alarms) {
		const next = NextAlarmFire(row.expr, now);
		const item = {
			expr: row.expr,
			text: row.text,
			next: next ? MinuteKey(next) : null
		};
		list.push(item);
		if (next && (!soonest || next < soonest.at)) soonest = { at: next, key: item.next };
	}
	return {
		path: ALARMS_FILE,
		alarms: list,
		errors,
		next: soonest ? soonest.key : null
	};
}

export function FormatAlarmWake(matches) {
	const rows = Array.isArray(matches) ? matches : [];
	const labels = rows.map((row) => row.text || row.expr);
	const unique = [];
	for (const label of labels) {
		if (label && !unique.includes(label)) unique.push(label);
	}
	const lines = ['This is an autonomous alarm wake.'];
	if (unique.length) lines.push('Triggered: ' + unique.join('; '));
	return lines.join('\n');
}
