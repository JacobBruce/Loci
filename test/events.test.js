import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	CALENDAR_FILE_CAP,
	CalendarNoteExists,
	CalendarState,
	DropEvents,
	EVENTS_CAP,
	IsDatedCalendarRel,
	MatchEvents,
	ParseEventLine,
	ReadEvents,
	SetEvent,
	StampFromDate,
	StopEvent,
	TrimCalendarFiles
} from '../src/events.js';

function TempHouse() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'loci-events-'));
}

function FutureStamp(days, hours, minutes) {
	const d = new Date();
	d.setDate(d.getDate() + (days || 0));
	d.setHours(hours == null ? 9 : hours, minutes == null ? 0 : minutes, 0, 0);
	return StampFromDate(d);
}

test('ParseEventLine accepts quoted text and T separator', () => {
	const row = ParseEventLine('2026-10-01 09:30 "Dentist"');
	assert.equal(row.at, '2026-10-01 09:30');
	assert.equal(row.text, 'Dentist');
	const alt = ParseEventLine('2026-10-01T14:00 call home');
	assert.equal(alt.at, '2026-10-01 14:00');
	assert.equal(alt.text, 'call home');
	assert.equal(ParseEventLine('# comment'), null);
});

test('SetEvent writes EVENTS, rejects the past, and caps at 32', () => {
	const houseDir = TempHouse();
	const first = FutureStamp(2, 10, 0);
	const out = SetEvent(houseDir, { date: first.date, time: first.time, text: 'Tea' });
	assert.equal(out.count, 1);
	assert.equal(out.cap, EVENTS_CAP);
	assert.match(fs.readFileSync(path.join(houseDir, 'EVENTS'), 'utf8'), /Tea/);
	assert.throws(() => SetEvent(houseDir, '2020-01-01 09:00 "old"'), /past/i);
	for (let i = 1; i < EVENTS_CAP; i++) {
		const stamp = FutureStamp(3 + i, 11, 0);
		SetEvent(houseDir, { date: stamp.date, time: stamp.time, text: 'n' + i });
	}
	const extra = FutureStamp(40, 12, 0);
	assert.throws(() => SetEvent(houseDir, { date: extra.date, time: extra.time, text: 'overflow' }), /32/);
});

test('StopEvent removes by time or description', () => {
	const houseDir = TempHouse();
	const a = FutureStamp(5, 8, 0);
	const b = FutureStamp(6, 8, 0);
	SetEvent(houseDir, { date: a.date, time: a.time, text: 'Walk' });
	SetEvent(houseDir, { date: b.date, time: b.time, text: 'Run' });
	StopEvent(houseDir, JSON.stringify({ text: 'Walk' }));
	assert.equal(ReadEvents(houseDir).events.length, 1);
	assert.equal(ReadEvents(houseDir).events[0].text, 'Run');
	StopEvent(houseDir, b.at);
	assert.equal(ReadEvents(houseDir).events.length, 0);
});

test('MatchEvents includes the current minute and overdue rows; DropEvents removes them', () => {
	const houseDir = TempHouse();
	const now = new Date(2026, 8, 18, 14, 0, 0);
	fs.writeFileSync(houseDir + '/EVENTS', [
		'2026-09-18 13:59 "missed"',
		'2026-09-18 14:00 "now"',
		'2026-09-18 14:01 "later"'
	].join('\n') + '\n', 'utf8');
	const hits = MatchEvents(houseDir, now);
	assert.deepEqual(hits.map((row) => row.text), ['missed', 'now']);
	DropEvents(houseDir, hits);
	const left = ReadEvents(houseDir).events;
	assert.equal(left.length, 1);
	assert.equal(left[0].text, 'later');
});

test('TrimCalendarFiles archives dated notes above 32', () => {
	const houseDir = TempHouse();
	const cal = path.join(houseDir, 'calendar');
	fs.mkdirSync(cal, { recursive: true });
	for (let i = 1; i <= CALENDAR_FILE_CAP + 1; i++) {
		const day = '2026-01-' + String(i).padStart(2, '0');
		fs.writeFileSync(path.join(cal, day + '.md'), '# ' + day + '\n', 'utf8');
	}
	const archived = TrimCalendarFiles(houseDir);
	assert.equal(archived.length, 1);
	assert.equal(archived[0], 'archive/calendar/2026-01-01.md');
	assert.equal(fs.existsSync(path.join(cal, '2026-01-01.md')), false);
	assert.equal(fs.existsSync(path.join(houseDir, 'archive', 'calendar', '2026-01-01.md')), true);
	assert.equal(fs.readdirSync(cal).filter((n) => n.endsWith('.md')).length, CALENDAR_FILE_CAP);
	assert.equal(IsDatedCalendarRel('calendar/2026-01-02.md'), true);
	assert.equal(IsDatedCalendarRel('calendar/notes.md'), false);
});

test('CalendarState marks days with events and notes', () => {
	const houseDir = TempHouse();
	const stamp = FutureStamp(2, 15, 30);
	SetEvent(houseDir, { date: stamp.date, time: stamp.time, text: 'Show' });
	fs.mkdirSync(path.join(houseDir, 'calendar'), { recursive: true });
	fs.writeFileSync(path.join(houseDir, 'calendar', stamp.date + '.md'), '# notes\n', 'utf8');
	const state = CalendarState(houseDir, stamp.date.slice(0, 4) * 1, Number(stamp.date.slice(5, 7)));
	assert.equal(state.days[stamp.date].file, true);
	assert.equal(state.days[stamp.date].events[0].text, 'Show');
	assert.equal(CalendarNoteExists(houseDir, stamp.date), true);
});
