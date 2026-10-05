import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallTool } from '../src/tools.js';

function SeedHouse(root, slug, meta) {
	const dir = path.join(root, slug);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'house.json'), JSON.stringify({
		name: meta.name || slug,
		group: meta.group || '',
		enabled: meta.enabled !== false,
		max_turns: meta.max_turns || 0
	}, null, '\t') + '\n', 'utf8');
	return dir;
}

function Ctx(houseDir, extra) {
	return {
		houseDir,
		housesRoot: path.dirname(houseDir),
		name: 'Maple',
		slug: 'maple',
		group: 'grove',
		workspaces: [],
		run_command: false,
		...extra
	};
}

test('dm wakes a group house with a short nudge and reports only delivery', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-dm-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove' });
	SeedHouse(root, 'cedar', { name: 'Cedar', group: 'grove' });
	let woke = null;
	const sent = await CallTool(Ctx(maple, {
		wake_house: (slug, text) => {
			woke = { slug, text };
			return { ok: true };
		}
	}), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: JSON.stringify({
			to: 'cedar@grove',
			text: 'Hey I need a thing ASAP. I sent you an email with more details.'
		})
	});
	assert.equal(sent.ok, true);
	assert.equal(sent.delivered, true);
	assert.equal(sent.to, 'cedar');
	assert.equal(sent.queued, undefined);
	assert.equal(woke.slug, 'cedar');
	assert.equal(
		woke.text,
		'Maple (maple) sent you a DM: Hey I need a thing ASAP. I sent you an email with more details.'
	);
});

test('dm refuses long text, solitary houses, self, and a house that must not wake', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-dm-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove' });
	const cedar = SeedHouse(root, 'cedar', { name: 'Cedar', group: 'grove' });
	const lone = SeedHouse(root, 'lone', { name: 'Lone', group: '' });
	const capped = SeedHouse(root, 'capped', { name: 'Capped', group: 'grove', max_turns: 1 });
	SeedHouse(root, 'off', { name: 'Off', group: 'grove', enabled: false });
	fs.writeFileSync(path.join(cedar, 'world.json'), JSON.stringify({
		waiting_on_user: { kind: 'notify', text: 'stuck' }
	}) + '\n', 'utf8');
	fs.writeFileSync(path.join(capped, 'world.json'), JSON.stringify({ turns: 1 }) + '\n', 'utf8');
	let calls = 0;
	const wake = () => {
		calls += 1;
		return { ok: true };
	};

	const long = await CallTool(Ctx(maple, { wake_house: wake }), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: JSON.stringify({ to: 'cedar', text: 'x'.repeat(257) })
	});
	assert.equal(long.ok, false);
	assert.match(long.error, /256/);
	assert.match(long.error, /send_mail/);

	const solitary = await CallTool(Ctx(lone, { slug: 'lone', name: 'Lone', group: '', wake_house: wake }), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: JSON.stringify({ to: 'maple', text: 'now' })
	});
	assert.equal(solitary.ok, false);
	assert.match(solitary.error, /Solitary/i);

	const self = await CallTool(Ctx(maple, { wake_house: wake }), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: JSON.stringify({ to: 'maple', text: 'now' })
	});
	assert.equal(self.ok, false);
	assert.match(self.error, /yourself/i);

	const waiting = await CallTool(Ctx(maple, { wake_house: wake }), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: JSON.stringify({ to: 'cedar', text: 'now' })
	});
	assert.equal(waiting.ok, false);
	assert.match(waiting.error, /waiting on the user/);

	const disabled = await CallTool(Ctx(maple, { wake_house: wake }), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: JSON.stringify({ to: 'off', text: 'now' })
	});
	assert.equal(disabled.ok, false);
	assert.match(disabled.error, /disabled/);

	const limited = await CallTool(Ctx(maple, { wake_house: wake }), 'send_action', {
		action: 'dm',
		target: 'pc',
		payload: JSON.stringify({ to: 'capped', text: 'now' })
	});
	assert.equal(limited.ok, false);
	assert.match(limited.error, /turn limit/);
	assert.equal(calls, 0);
});
