import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MinuteKey } from '../src/alarms.js';
import { ReadEvents, StampFromDate } from '../src/events.js';
import { CreateHouse } from '../src/house.js';
import { RunAlarmTick } from '../src/tick.js';

function TempRoot() {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-tick-')), 'houses');
}

function LastAlarmMinute(houseDir) {
	const p = path.join(houseDir, 'world.json');
	if (!fs.existsSync(p)) return '';
	try {
		return String(JSON.parse(fs.readFileSync(p, 'utf8')).last_alarm_minute || '');
	} catch {
		return '';
	}
}

test('tick skips a working house without consuming the minute or dropping events', () => {
	const root = TempRoot();
	const house = CreateHouse(root, {
		name: 'Maple',
		model: 'test',
		alarms: '* * * * * "minutely"'
	});
	const now = new Date(2026, 8, 19, 12, 0, 0);
	fs.writeFileSync(
		path.join(house.path, 'EVENTS'),
		StampFromDate(now).at + ' "due event"\n',
		'utf8'
	);
	const queued = [];
	const busy = new Set([house.slug]);
	const firedBusy = RunAlarmTick(root, now, {
		isWorking: (slug) => busy.has(slug),
		enqueue: (row, matches) => {
			queued.push({ slug: row.slug, matches });
			return true;
		}
	});
	assert.equal(firedBusy.length, 0);
	assert.equal(queued.length, 0);
	assert.equal(ReadEvents(house.path).events.length, 1);
	assert.equal(LastAlarmMinute(house.path), '');
	busy.clear();
	const fired = RunAlarmTick(root, now, {
		isWorking: (slug) => busy.has(slug),
		enqueue: (row, matches) => {
			queued.push({ slug: row.slug, matches });
			return true;
		}
	});
	assert.equal(fired.length, 1);
	assert.equal(fired[0].slug, house.slug);
	assert.equal(queued.length, 1);
	assert.equal(ReadEvents(house.path).events.length, 0);
	assert.equal(LastAlarmMinute(house.path), MinuteKey(now));
	assert.equal(RunAlarmTick(root, now, {
		isWorking: () => false,
		enqueue: () => true
	}).length, 0);
});

test('a later minute still fires events skipped while working', () => {
	const root = TempRoot();
	const house = CreateHouse(root, { name: 'Cedar', model: 'test', alarms: '' });
	const first = new Date(2026, 8, 19, 12, 0, 0);
	const next = new Date(2026, 8, 19, 12, 1, 0);
	fs.writeFileSync(
		path.join(house.path, 'EVENTS'),
		StampFromDate(first).at + ' "overdue"\n',
		'utf8'
	);
	const busy = new Set([house.slug]);
	assert.equal(RunAlarmTick(root, first, {
		isWorking: (slug) => busy.has(slug),
		enqueue: () => true
	}).length, 0);
	assert.equal(ReadEvents(house.path).events.length, 1);
	busy.clear();
	const fired = RunAlarmTick(root, next, {
		isWorking: () => false,
		enqueue: () => true
	});
	assert.equal(fired.length, 1);
	assert.equal(fired[0].matches[0].text, 'overdue');
	assert.equal(ReadEvents(house.path).events.length, 0);
});

test('events stay if enqueue refuses after the house looks free', () => {
	const root = TempRoot();
	const house = CreateHouse(root, { name: 'Birch', model: 'test', alarms: '' });
	const now = new Date(2026, 8, 19, 12, 0, 0);
	fs.writeFileSync(
		path.join(house.path, 'EVENTS'),
		StampFromDate(now).at + ' "keep me"\n',
		'utf8'
	);
	const fired = RunAlarmTick(root, now, {
		isWorking: () => false,
		enqueue: () => false
	});
	assert.equal(fired.length, 0);
	assert.equal(ReadEvents(house.path).events.length, 1);
});
