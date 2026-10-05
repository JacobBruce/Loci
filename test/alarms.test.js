import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	CronMatches,
	FormatAlarmWake,
	FormatAlarmLine,
	MatchAlarms,
	MsUntilNextMinute,
	NextAlarmFire,
	ParseAlarmLine,
	ParseCronExpr,
	ReadAlarms,
	SetAlarm,
	StopAlarm,
	WriteAlarms
} from '../src/alarms.js';

function TempHouse() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'loci-alarms-'));
}

test('ParseCronExpr accepts steps, lists, and ranges', () => {
	const hourly = ParseCronExpr('0 * * * *');
	assert.equal(hourly[0].allowed.has(0), true);
	assert.equal(hourly[0].allowed.has(1), false);
	assert.equal(hourly[1].star, true);
	const every15 = ParseCronExpr('*/15 * * * *');
	assert.deepEqual([...every15[0].allowed].sort((a, b) => a - b), [0, 15, 30, 45]);
	const weekdays = ParseCronExpr('0 9 * * 1-5');
	assert.equal(weekdays[4].allowed.has(1), true);
	assert.equal(weekdays[4].allowed.has(0), false);
	assert.equal(weekdays[4].star, false);
});

test('CronMatches uses local fields; Sunday 7 equals 0', () => {
	const noon = new Date(2026, 8, 14, 12, 0, 0); // Monday
	assert.equal(CronMatches('0 * * * *', noon), true);
	assert.equal(CronMatches('0 12 * * *', noon), true);
	assert.equal(CronMatches('0 13 * * *', noon), false);
	assert.equal(CronMatches('*/15 * * * *', new Date(2026, 8, 14, 12, 15, 0)), true);
	assert.equal(CronMatches('*/15 * * * *', new Date(2026, 8, 14, 12, 16, 0)), false);
	const sunday = new Date(2026, 8, 13, 9, 0, 0);
	assert.equal(CronMatches('0 9 * * 0', sunday), true);
	assert.equal(CronMatches('0 9 * * 7', sunday), true);
	assert.equal(CronMatches('0 9 * * 1', sunday), false);
});

test('day-of-month and day-of-week are OR when both are restricted', () => {
	const monday = new Date(2026, 8, 14, 0, 0, 0);
	assert.equal(CronMatches('0 0 1 * 1', monday), true);
	assert.equal(CronMatches('0 0 14 * 0', monday), true);
	assert.equal(CronMatches('0 0 1 * 0', monday), false);
});

test('ParseAlarmLine takes an optional quoted description', () => {
	assert.equal(ParseAlarmLine('# comment'), null);
	assert.deepEqual(ParseAlarmLine('0 * * * * "hourly"'), { expr: '0 * * * *', text: 'hourly' });
	assert.deepEqual(ParseAlarmLine("*/15 * * * * 'every 15 mins'"), { expr: '*/15 * * * *', text: 'every 15 mins' });
	assert.deepEqual(ParseAlarmLine('0 9 * * * daily 9:00'), { expr: '0 9 * * *', text: 'daily 9:00' });
	const quoted = FormatAlarmLine('0 * * * *', 'say "hi"');
	assert.equal(ParseAlarmLine(quoted).text, 'say "hi"');
});

test('NextAlarmFire is the next matching minute, not now', () => {
	const at = new Date(2026, 8, 14, 12, 0, 30);
	const next = NextAlarmFire('0 * * * *', at);
	assert.equal(next.getHours(), 13);
	assert.equal(next.getMinutes(), 0);
	const q = NextAlarmFire('*/15 * * * *', new Date(2026, 8, 14, 12, 0, 0));
	assert.equal(q.getMinutes(), 15);
});

test('set_alarm appends, updates the same expr, and stop_alarm removes by text', () => {
	const dir = TempHouse();
	SetAlarm(dir, '{"expr":"0 * * * *","text":"hourly"}');
	SetAlarm(dir, '*/15 * * * * "every 15 mins"');
	SetAlarm(dir, '{"expr":"0 * * * *","text":"hour"}');
	const listed = ReadAlarms(dir);
	assert.equal(listed.alarms.length, 2);
	assert.equal(listed.alarms[0].text, 'hour');
	const stopped = StopAlarm(dir, 'every 15 mins');
	assert.equal(stopped.stopped.length, 1);
	assert.equal(ReadAlarms(dir).alarms.length, 1);
});

test('set_alarm and stop_alarm keep comments and blank lines', () => {
	const dir = TempHouse();
	fs.writeFileSync(path.join(dir, 'ALARMS'), [
		'# user seed',
		'0 * * * * "hourly"',
		'',
		'# leave this',
		''
	].join('\n'), 'utf8');
	SetAlarm(dir, '{"expr":"0 * * * *","text":"hour"}');
	SetAlarm(dir, '*/15 * * * * "every 15 mins"');
	let raw = fs.readFileSync(path.join(dir, 'ALARMS'), 'utf8');
	assert.match(raw, /^# user seed$/m);
	assert.match(raw, /^# leave this$/m);
	assert.match(raw, /"hour"/);
	assert.match(raw, /"every 15 mins"/);
	StopAlarm(dir, 'every 15 mins');
	raw = fs.readFileSync(path.join(dir, 'ALARMS'), 'utf8');
	assert.match(raw, /^# user seed$/m);
	assert.match(raw, /^# leave this$/m);
	assert.match(raw, /"hour"/);
	assert.doesNotMatch(raw, /every 15 mins/);
});

test('MatchAlarms treats several hits in the same minute as one list', () => {
	const dir = TempHouse();
	WriteAlarms(dir, [
		{ expr: '0 * * * *', text: 'hourly' },
		{ expr: '*/15 * * * *', text: 'every 15 mins' }
	]);
	const hits = MatchAlarms(dir, new Date(2026, 8, 14, 12, 0, 0));
	assert.equal(hits.length, 2);
	assert.equal(FormatAlarmWake(hits), 'This is an autonomous alarm wake.\nTriggered: hourly; every 15 mins');
	assert.equal(MatchAlarms(dir, new Date(2026, 8, 14, 12, 15, 0)).length, 1);
});

test('alarm cap is 16', () => {
	const dir = TempHouse();
	for (let i = 0; i < 16; i++) {
		SetAlarm(dir, i + ' * * * * "a' + i + '"');
	}
	assert.throws(() => SetAlarm(dir, '0 0 * * * "overflow"'), /16/);
});

test('MsUntilNextMinute is the remainder of the current minute', () => {
	assert.equal(MsUntilNextMinute(0), 60000);
	assert.equal(MsUntilNextMinute(1500), 58500);
	assert.equal(MsUntilNextMinute(59999), 1);
});
