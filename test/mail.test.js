import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallTool } from '../src/tools.js';
import { AttachUnreadMail, CountInbox, FormatUnreadMail } from '../src/mail.js';

function SeedHouse(root, slug, meta) {
	const dir = path.join(root, slug);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'BOOT.md'), '# Boot\n', 'utf8');
	fs.writeFileSync(path.join(dir, 'house.json'), JSON.stringify({
		name: meta.name || slug,
		group: meta.group || '',
		enabled: true
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

test('send_mail delivers to group inbox and sent; slug@group is accepted', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-mail-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove' });
	const cedar = SeedHouse(root, 'cedar', { name: 'Cedar', group: 'grove' });
	SeedHouse(root, 'lone', { name: 'Lone', group: '' });

	const sent = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({
			to: 'cedar@grove',
			subject: 'Shelf notes',
			body: 'Please file the oak samples.'
		})
	});
	assert.equal(sent.ok, true);
	assert.equal(sent.delivered, true);
	assert.equal(sent.to, 'cedar');
	assert.equal(CountInbox(cedar), 1);
	assert.equal(CountInbox(maple), 0);
	const inboxFiles = fs.readdirSync(path.join(cedar, 'mail', 'inbox'));
	assert.equal(inboxFiles.length, 1);
	const letter = fs.readFileSync(path.join(cedar, 'mail', 'inbox', inboxFiles[0]), 'utf8');
	assert.match(letter, /^---\nfrom: maple\nto: cedar\nsubject: Shelf notes\n/m);
	assert.match(letter, /Please file the oak samples/);
	const sentFiles = fs.readdirSync(path.join(maple, 'mail', 'sent'));
	assert.deepEqual(sentFiles, inboxFiles);

	const slugOnly = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: { to: 'cedar', subject: 'Second', body: '' }
	});
	assert.equal(slugOnly.ok, true);
	assert.equal(CountInbox(cedar), 2);

	const byName = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: { to: 'Cedar', subject: 'By name', body: '' }
	});
	assert.equal(byName.ok, true);
	assert.equal(byName.to, 'cedar');
	assert.equal(CountInbox(cedar), 3);
});

test('send_mail refuses solitary, other groups, self, and the user', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-mail-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove' });
	SeedHouse(root, 'cedar', { name: 'Cedar', group: 'grove' });
	const lone = SeedHouse(root, 'lone', { name: 'Lone', group: '' });
	SeedHouse(root, 'pine', { name: 'Pine', group: 'orchard' });

	const solitary = await CallTool(Ctx(lone, { slug: 'lone', name: 'Lone', group: '' }), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'maple', subject: 'Hi', body: 'x' })
	});
	assert.equal(solitary.ok, false);
	assert.match(solitary.error, /Solitary/i);

	const other = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'pine', subject: 'Hi', body: 'x' })
	});
	assert.equal(other.ok, false);
	assert.match(other.error, /group/i);

	const badAt = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'cedar@orchard', subject: 'Hi', body: 'x' })
	});
	assert.equal(badAt.ok, false);
	assert.match(badAt.error, /does not match/i);

	const self = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'maple', subject: 'Hi', body: 'x' })
	});
	assert.equal(self.ok, false);
	assert.match(self.error, /yourself/i);

	const selfByName = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'Maple', subject: 'Hi', body: 'x' })
	});
	assert.equal(selfByName.ok, false);
	assert.match(selfByName.error, /yourself/i);

	const user = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'user', subject: 'Hi', body: 'x' })
	});
	assert.equal(user.ok, false);
	assert.match(user.error, /notify_user/i);
});

test('read_file of mail/inbox moves the letter to mail/read; glob does not', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-mail-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove' });
	const cedar = SeedHouse(root, 'cedar', { name: 'Cedar', group: 'grove' });
	await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'cedar', subject: 'Hello', body: 'World' })
	});
	const listed = await CallTool(Ctx(cedar, { slug: 'cedar', name: 'Cedar', group: 'grove' }), 'search_files', {
		mode: 'glob',
		pattern: 'mail/inbox/*.md'
	});
	assert.equal(listed.ok, true);
	assert.equal(listed.matches.length, 1);
	assert.equal(CountInbox(cedar), 1);

	const rel = listed.matches[0].path;
	const read = await CallTool(Ctx(cedar, { slug: 'cedar', name: 'Cedar', group: 'grove' }), 'read_file', {
		path: rel
	});
	assert.equal(read.ok, true);
	assert.equal(read.moved, true);
	assert.equal(read.previous_path, rel);
	assert.match(read.path, /^mail\/read\//);
	assert.match(read.note, /mail\/read\//);
	assert.match(read.text, /World/);
	assert.equal(CountInbox(cedar), 0);
	assert.equal(fs.existsSync(path.join(cedar, rel)), false);
	assert.equal(fs.existsSync(path.join(cedar, read.path)), true);

	const again = await CallTool(Ctx(cedar, { slug: 'cedar', name: 'Cedar', group: 'grove' }), 'read_file', {
		path: read.path
	});
	assert.equal(again.ok, true);
	assert.equal(again.moved, undefined);

	const locked = await CallTool(Ctx(cedar, { slug: 'cedar', name: 'Cedar', group: 'grove' }), 'write_file', {
		path: 'mail/read/' + path.basename(read.path),
		text: 'rewrite\n'
	});
	assert.equal(locked.ok, false);
	assert.match(locked.error, /read-only/i);
});

test('boot and examine report unread count; AttachUnreadMail adds a one-liner', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-mail-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove' });
	const cedar = SeedHouse(root, 'cedar', { name: 'Cedar', group: 'grove' });
	const cedarCtx = Ctx(cedar, { slug: 'cedar', name: 'Cedar', group: 'grove' });
	const bootEmpty = await CallTool(cedarCtx, 'send_action', { action: 'boot', target: 'pc' });
	assert.equal(bootEmpty.ok, true);
	assert.equal(bootEmpty.mail.unread, 0);

	await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'cedar', subject: 'Hello', body: 'World' })
	});
	const boot = await CallTool(cedarCtx, 'send_action', { action: 'boot', target: 'pc' });
	assert.equal(boot.mail.unread, 1);
	const exam = await CallTool(cedarCtx, 'send_action', { action: 'examine', target: 'pc' });
	assert.equal(exam.mail.unread, 1);
	assert.equal(FormatUnreadMail(1), 'You have 1 unread item in mail/inbox.');
	assert.match(AttachUnreadMail(cedar, 'Wake.'), /1 unread item/);
});

test('send_mail prefers a peer named like the address over a same-slug house in another group', async () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-mail-')), 'houses');
	const maple = SeedHouse(root, 'maple', { name: 'Maple', group: 'grove' });
	const peer = SeedHouse(root, 'cedar-2', { name: 'Cedar', group: 'grove' });
	const other = SeedHouse(root, 'cedar', { name: 'Cedar', group: 'orchard' });

	const sent = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'cedar', subject: 'Hello', body: 'Hi' })
	});
	assert.equal(sent.ok, true);
	assert.equal(sent.to, 'cedar-2');
	assert.equal(CountInbox(peer), 1);
	assert.equal(CountInbox(other), 0);

	const away = await CallTool(Ctx(maple), 'send_action', {
		action: 'send_mail',
		target: 'pc',
		payload: JSON.stringify({ to: 'cedar@orchard', subject: 'Hello', body: 'Hi' })
	});
	assert.equal(away.ok, false);
});
