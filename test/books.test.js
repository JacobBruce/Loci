import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallAgpi } from '../src/agpi.js';
import { CallTool } from '../src/tools.js';
import { BooksBoard, LetterOf, ParseTags } from '../src/books.js';

function House() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-books-'));
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
	assert.equal(LetterOf('grove-notes'), 'g');
	assert.equal(LetterOf('123'), '#');
});

test('ParseTags accepts arrays and comma strings', () => {
	assert.deepEqual(ParseTags(['Memory', 'people', 'memory']), ['memory', 'people']);
	assert.deepEqual(ParseTags('Alpha, beta; Alpha'), ['alpha', 'beta']);
});

test('create_book writes library/<letter>/<slug>.md and walks to library', async () => {
	const house = House();
	const ctx = Ctx(house);
	const made = await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: {
			title: 'Grove Notes',
			tags: ['group', 'memory'],
			description: 'How the grove works.',
			source: 'https://example.com/grove',
			body: 'Members share a named group.'
		}
	});
	assert.equal(made.ok, true);
	assert.equal(made.file, 'library/g/grove-notes.md');
	assert.equal(made.title, 'Grove Notes');
	assert.deepEqual(made.tags, ['group', 'memory']);
	assert.equal(made.source, 'https://example.com/grove');
	assert.equal(made.count, 1);
	assert.equal(made.description, undefined);
	assert.equal(made.walked, undefined);
	assert.equal(made.from, undefined);
	const text = fs.readFileSync(path.join(house.path, 'library', 'g', 'grove-notes.md'), 'utf8');
	assert.match(text, /^---\ntitle: Grove Notes\ntags: group, memory\ndescription: How the grove works\.\nsource: https:\/\/example.com\/grove\nat: /);
	assert.match(text, /Members share a named group\./);
});

test('examine Book Shelf lists newest and accessed previews, not bodies', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'shelf',
		payload: { title: 'Cedar', description: 'A tree.', body: 'Secret bark notes.' }
	});
	const seen = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'book_shelf' });
	assert.equal(seen.ok, true);
	assert.equal(seen.books.path, 'library/');
	assert.equal(seen.books.count, 1);
	assert.equal(seen.books.titles, undefined);
	assert.equal(seen.books.newest[0].title, 'Cedar');
	assert.equal(seen.books.newest[0].file, 'library/c/cedar.md');
	assert.equal(seen.books.accessed.length, 0);
	assert.equal(JSON.stringify(seen).includes('Secret bark notes'), false);
	assert.ok(seen.actions.some((a) => a.action === 'search_books'));
});

test('read_file bumps access; search_books ranks by title and does not bump', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Alpha Tree', tags: ['plants'], description: 'First file.', body: 'Alpha body.' }
	});
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Beta Notes', tags: ['memory'], description: 'Second file.', body: 'Beta body.' }
	});
	const read = await CallTool(ctx, 'read_file', { path: 'library/a/alpha-tree.md' });
	assert.equal(read.ok, true);
	const seen = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'book_shelf' });
	assert.equal(seen.books.accessed[0].title, 'Alpha Tree');
	const hit = await CallAgpi(ctx, 'send_action', {
		action: 'search_books',
		target: 'book_shelf',
		payload: { query: 'alpha' }
	});
	assert.equal(hit.ok, true);
	assert.equal(hit.order, 'relevant');
	assert.equal(hit.items[0].title, 'Alpha Tree');
	assert.equal(hit.items[0].access_count, 1);
	assert.equal(JSON.stringify(hit).includes('Alpha body'), false);
	const tagged = await CallAgpi(ctx, 'send_action', {
		action: 'search_books',
		target: 'book_shelf',
		payload: { tags: ['memory'], order: 'created' }
	});
	assert.equal(tagged.count, 1);
	assert.equal(tagged.items[0].title, 'Beta Notes');
	const afterSearch = await CallAgpi(ctx, 'send_action', { action: 'examine', target: 'book_shelf' });
	assert.equal(afterSearch.books.accessed.length, 1);
});

test('search_books filters by source substring', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Wiki Tree', source: 'https://en.wikipedia.org/wiki/Tree', body: 'Leaves.' }
	});
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'House Note', source: 'Maple', body: 'Local.' }
	});
	const wiki = await CallAgpi(ctx, 'send_action', {
		action: 'search_books',
		target: 'book_shelf',
		payload: { source: 'wikipedia' }
	});
	assert.equal(wiki.ok, true);
	assert.equal(wiki.source, 'wikipedia');
	assert.equal(wiki.count, 1);
	assert.equal(wiki.items[0].title, 'Wiki Tree');
	const both = await CallAgpi(ctx, 'send_action', {
		action: 'search_books',
		target: 'book_shelf',
		payload: { query: 'note', source: 'wikipedia' }
	});
	assert.equal(both.count, 0);
	const named = await CallAgpi(ctx, 'send_action', {
		action: 'search_books',
		target: 'book_shelf',
		payload: { query: 'house', source: 'Maple' }
	});
	assert.equal(named.count, 1);
	assert.equal(named.items[0].title, 'House Note');
});

test('BooksBoard lists by order and still filters a query', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Older Note', body: 'First.' }
	});
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Peek Me', body: 'Hidden body.' }
	});
	const newest = BooksBoard(house.path, { order: 'created' });
	assert.equal(newest.items[0].title, 'Peek Me');
	assert.equal(newest.items[1].title, 'Older Note');
	const hit = BooksBoard(house.path, { query: 'peek', order: 'created' });
	assert.equal(hit.items.length, 1);
	assert.equal(hit.items[0].title, 'Peek Me');
	assert.equal(JSON.stringify(hit).includes('Hidden body'), false);
	const miss = BooksBoard(house.path, { query: 'zzz', order: 'created' });
	assert.equal(miss.count, 0);
	const ranked = BooksBoard(house.path, { order: 'relevant' });
	assert.equal(ranked.count, 0);
	assert.deepEqual(ranked.items, []);
});

test('search_books rebuilds the catalog if index.db is missing', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Rebuild Me', body: 'Keep this.' }
	});
	fs.unlinkSync(path.join(house.path, 'index.db'));
	const hit = await CallAgpi(ctx, 'send_action', {
		action: 'search_books',
		target: 'book_shelf',
		payload: { query: 'rebuild' }
	});
	assert.equal(hit.ok, true);
	assert.equal(hit.items[0].title, 'Rebuild Me');
});

test('create_book requires a body', async () => {
	const house = House();
	const ctx = Ctx(house);
	const empty = await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Empty' }
	});
	assert.equal(empty.ok, false);
	assert.match(empty.error, /body is required/i);
	const blank = await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Blank', body: '   \n' }
	});
	assert.equal(blank.ok, false);
	assert.match(blank.error, /body is required/i);
});

test('remove_book deletes by title; source may be omitted', async () => {
	const house = House();
	const ctx = Ctx(house);
	const made = await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Self Note', body: 'Generated here.' }
	});
	assert.equal(made.source, '');
	const gone = await CallAgpi(ctx, 'send_action', {
		action: 'remove_book',
		target: 'book_shelf',
		payload: { book: 'Self Note' }
	});
	assert.equal(gone.ok, true);
	assert.equal(gone.count, 0);
	assert.equal(fs.existsSync(path.join(house.path, 'library', 's', 'self-note.md')), false);
});

test('re-index without at keeps created_at', async () => {
	const house = House();
	const ctx = Ctx(house);
	await CallAgpi(ctx, 'send_action', {
		action: 'create_book',
		target: 'book_shelf',
		payload: { title: 'Keep Stamp', body: 'Body stays.' }
	});
	const first = BooksBoard(house.path, { order: 'created' });
	const stamp = first.items[0].created_at;
	assert.ok(stamp);
	const rel = first.items[0].file;
	const abs = path.join(house.path, rel);
	const stripped = fs.readFileSync(abs, 'utf8').replace(/^at: .+\n/m, '');
	assert.equal(stripped.includes('\nat:'), false);
	const wrote = await CallTool(ctx, 'write_file', { path: rel, text: stripped });
	assert.equal(wrote.ok, true);
	const again = BooksBoard(house.path, { order: 'created' });
	assert.equal(again.items[0].created_at, stamp);
});

test('write_file cannot create a book', async () => {
	const house = House();
	const ctx = Ctx(house);
	const wrote = await CallTool(ctx, 'write_file', {
		path: 'library/z/new.md',
		text: '---\ntitle: Zed\ntags:\ndescription:\nsource:\nat: x\n---\n\n'
	});
	assert.equal(wrote.ok, false);
	assert.match(wrote.error, /Book Shelf|cannot create/i);
});
