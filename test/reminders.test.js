import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CallTool } from '../src/tools.js';
import {
	AttachDueReminders,
	FormatDueReminders,
	FormatRemaining,
	ListReminders,
	ParseDuration,
	SetReminder
} from '../src/reminders.js';

function TempHouse() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-rem-'));
	fs.mkdirSync(path.join(dir, 'calendar'), { recursive: true });
	return dir;
}

function BackdateAll(houseDir) {
	const db = new DatabaseSync(path.join(houseDir, 'index.db'));
	try {
		db.prepare('UPDATE reminders SET due_at = ?').run(new Date(Date.now() - 1000).toISOString());
	} finally {
		db.close();
	}
}

function Ctx(houseDir, extra) {
	return {
		houseDir,
		name: 'Maple',
		slug: 'maple',
		workspaces: [],
		run_command: false,
		reminders: true,
		...extra
	};
}

test('ParseDuration accepts compact relative units and seconds', () => {
	assert.equal(ParseDuration(90).seconds, 90);
	assert.equal(ParseDuration('90').seconds, 90);
	assert.equal(ParseDuration('30s').seconds, 30);
	assert.equal(ParseDuration('15m').seconds, 15 * 60);
	assert.equal(ParseDuration('2h').seconds, 2 * 3600);
	assert.equal(ParseDuration('1d').seconds, 86400);
	assert.equal(ParseDuration('1 hour').seconds, 3600);
	assert.throws(() => ParseDuration('7:00'), /relative/);
	assert.throws(() => ParseDuration('0s'), /at least 1/);
});

test('FormatRemaining uses compact units', () => {
	assert.equal(FormatRemaining(0), 'due');
	assert.equal(FormatRemaining(-3), 'due');
	assert.equal(FormatRemaining(45), '45s');
	assert.equal(FormatRemaining(90), '1m 30s');
	assert.equal(FormatRemaining(120), '2m');
	assert.equal(FormatRemaining(3600), '1h');
	assert.equal(FormatRemaining(5400), '1h 30m');
	assert.equal(FormatRemaining(86400), '1d');
	assert.equal(FormatRemaining(90000), '1d 1h');
});

test('set_reminder stores a row, lists it, and writes the calendar', async () => {
	const houseDir = TempHouse();
	const set = await CallTool(Ctx(houseDir), 'send_action', {
		action: 'set_reminder',
		target: 'pc',
		payload: JSON.stringify({ text: 'Check the mail', in: '1h' })
	});
	assert.equal(set.ok, true);
	assert.equal(set.reminder.text, 'Check the mail');
	assert.equal(set.reminder.in, '1h');
	assert.equal(set.reminder.due_in_seconds, 3600);
	assert.match(set.reminder.calendar, /^calendar\/\d{4}-\d{2}-\d{2}\.md$/);
	const cal = fs.readFileSync(path.join(houseDir, set.reminder.calendar), 'utf8');
	assert.match(cal, /Check the mail/);
	assert.match(cal, /in 1h/);

	const listed = await CallTool(Ctx(houseDir), 'send_action', { action: 'list_reminders', target: 'pc' });
	assert.equal(listed.ok, true);
	assert.equal(listed.enabled, true);
	assert.equal(listed.reminders.length, 1);
	assert.equal(listed.reminders[0].id, set.reminder.id);
	assert.equal(listed.cap, 16);
});

test('cancel_reminder removes a row by id', async () => {
	const houseDir = TempHouse();
	const set = SetReminder(houseDir, JSON.stringify({ text: 'Stretch', in: '5m' }));
	const cancelled = await CallTool(Ctx(houseDir), 'send_action', {
		action: 'cancel_reminder',
		target: 'pc',
		payload: String(set.id)
	});
	assert.equal(cancelled.ok, true);
	assert.equal(cancelled.cancelled.id, set.id);
	assert.equal(ListReminders(houseDir).reminders.length, 0);
});

test('due reminders attach to an initiating message and are consumed', () => {
	const houseDir = TempHouse();
	SetReminder(houseDir, JSON.stringify({ text: 'Check the mail', in: '1h' }));
	BackdateAll(houseDir);
	const attached = AttachDueReminders(houseDir, 'Hello', { enabled: true });
	assert.match(attached, /^Hello\n\nDue house reminders:\n- Check the mail \(due (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}\)$/);
	assert.equal(ListReminders(houseDir).reminders.length, 0);
});

test('AttachDueReminders skips when disabled and leaves rows queued', () => {
	const houseDir = TempHouse();
	SetReminder(houseDir, JSON.stringify({ text: 'Skip me', in: '1h' }));
	BackdateAll(houseDir);
	const skipped = AttachDueReminders(houseDir, 'Hi', { enabled: false });
	assert.equal(skipped, 'Hi');
	assert.equal(ListReminders(houseDir).reminders.length, 1);
	assert.match(FormatDueReminders([{ text: 'Skip me' }]), /Due house reminders:/);
});

test('reminder cap is 16', () => {
	const houseDir = TempHouse();
	for (let i = 0; i < 16; i++) {
		SetReminder(houseDir, JSON.stringify({ text: 'n' + i, in: '1h' }));
	}
	assert.throws(
		() => SetReminder(houseDir, JSON.stringify({ text: 'overflow', in: '1h' })),
		/cap/i
	);
});
