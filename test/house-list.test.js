import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ListHouses } from '../src/house.js';
import { SetEvent } from '../src/events.js';

function SeedHouse(root, slug, meta) {
	const dir = path.join(root, slug);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'BOOT.md'), '# Boot\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'house.json'), JSON.stringify({ name: slug, ...meta }, null, '\t') + '\n', 'utf8');
	return dir;
}

test('ListHouses reports alarm and event counts and the manager flag for the cards', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-list-'));
	const boss = SeedHouse(root, 'boss', { group: 'team', project_manager: true });
	SeedHouse(root, 'solo', {});
	fs.writeFileSync(path.join(boss, 'ALARMS'), '0 * * * * "hourly"\n', 'utf8');
	const when = new Date(Date.now() + 2 * 24 * 3600 * 1000);
	const pad = (n) => String(n).padStart(2, '0');
	const stamp = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) + ' 09:00';
	SetEvent(boss, stamp + ' "later"');

	const rows = ListHouses(root);
	const a = rows.find((h) => h.slug === 'boss');
	const b = rows.find((h) => h.slug === 'solo');
	assert.equal(a.alarm_count, 1);
	assert.equal(a.event_count, 1);
	assert.equal(a.project_manager, true);
	assert.equal(b.event_count, 0);
	assert.equal(b.project_manager, false);
});
