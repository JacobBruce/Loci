import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallAgpi } from '../src/agpi.js';
import { CallTool } from '../src/tools.js';
import { ContactsState, LetterOf } from '../src/contacts.js';

function House() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-contacts-'));
	fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({
		room: 'office',
		turns: 0
	}, null, '\t') + '\n', 'utf8');
	return { path: dir, slug: 'maple', name: 'Maple' };
}

function Ctx(house) {
	return { houseDir: house.path, name: 'Maple', slug: 'maple', workspaces: [], run_command: false };
}

test('LetterOf uses the first latin letter or hash', () => {
	assert.equal(LetterOf('maple'), 'm');
	assert.equal(LetterOf('alan'), 'a');
	assert.equal(LetterOf('123'), '#');
});

test('create_contact writes contacts/<letter>/<slug>.md and walks to the living room', async () => {
	const house = House();
	const ctx = Ctx(house);
	const made = await CallAgpi(ctx, 'send_action', {
		action: 'create_contact',
		target: 'address_book',
		payload: { name: 'Alan Grove', relation: 'colleague', body: 'Shares the grove group.' }
	});
	assert.equal(made.ok, true);
	assert.equal(made.file, 'contacts/a/alan-grove.md');
	assert.equal(made.name, 'Alan Grove');
	assert.equal(made.relation, 'colleague');
	assert.equal(made.count, 1);
	assert.equal(made.cap, undefined);
	assert.equal(made.description, undefined);
	assert.equal(made.walked, undefined);
	assert.equal(made.from, undefined);
	const text = fs.readFileSync(path.join(house.path, 'contacts', 'a', 'alan-grove.md'), 'utf8');
	assert.match(text, /^---\nname: Alan Grove\nrelation: colleague\nat: /);
	assert.match(text, /Shares the grove group\./);
});

test('examine Address Book lists names, not card bodies', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_contact',
		target: 'address_book',
		payload: { name: 'Cedar', relation: 'neighbor', body: 'Lives next door.' }
	});
	const seen = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'address_book' });
	assert.equal(seen.ok, true);
	assert.equal(seen.contacts.path, 'contacts/');
	assert.equal(seen.contacts.count, 1);
	assert.deepEqual(seen.contacts.names, ['Cedar']);
	assert.equal(seen.contacts.items, undefined);
	assert.equal(seen.contacts.cap, undefined);
	assert.equal(JSON.stringify(seen).includes('Lives next door'), false);
	assert.ok(seen.actions.some((a) => a.action === 'create_contact'));
	assert.ok(seen.actions.some((a) => a.action === 'remove_contact'));
	const state = ContactsState(house.path);
	assert.equal(state.items[0].file, 'contacts/c/cedar.md');
	assert.equal(state.items[0].relation, 'neighbor');
	assert.equal(state.items[0].letter, 'c');
	assert.equal(state.items[0].body, undefined);
});

test('remove_contact deletes by name', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_contact',
		target: 'address_book',
		payload: { name: 'Cedar' }
	});
	const gone = await CallAgpi(ctx, 'send_action', {
		action: 'remove_contact',
		target: 'address_book',
		payload: { contact: 'Cedar' }
	});
	assert.equal(gone.ok, true);
	assert.equal(gone.count, 0);
	assert.equal(fs.existsSync(path.join(house.path, 'contacts', 'c', 'cedar.md')), false);
});

test('address book is uncapped; examine drops names after 100; write_file cannot create a card', async () => {
	const house = House();
	const ctx = Ctx(house);
	function Seed(n) {
		for (let i = 0; i < n; i++) {
			const slug = 'person-' + String(i).padStart(3, '0');
			const dir = path.join(house.path, 'contacts', 'p');
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, slug + '.md'), '---\nname: Person ' + i + '\nrelation:\nat: x\n---\n\n', 'utf8');
		}
	}
	Seed(100);
	const listed = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'address_book' });
	assert.equal(listed.contacts.count, 100);
	assert.equal(listed.contacts.names.length, 100);
	Seed(101);
	const dropped = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'address_book' });
	assert.equal(dropped.contacts.count, 101);
	assert.equal(dropped.contacts.names, undefined);
	const wrote = await CallTool(ctx, 'write_file', {
		path: 'contacts/z/new.md',
		text: '---\nname: Zed\nrelation:\nat: x\n---\n\n'
	});
	assert.equal(wrote.ok, false);
	assert.match(wrote.error, /Address Book|cannot create/i);
});
