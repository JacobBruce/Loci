import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TITLE_MAX = 160;
const DESC_MAX = 500;
const SOURCE_MAX = 500;
export const USER_BOOK_SOURCE = 'created by user';
const TAG_MAX = 32;
const TAG_CAP = 16;
const BODY_MAX = 64 * 1024;
const INDEX_FILE = 'index.db';
const PREVIEW = 8;
const SEARCH_DEFAULT = 10;
const SEARCH_MAX = 32;
const SEARCH_SCAN = 200;
const ORDERS = ['relevant', 'accessed', 'created', 'popular'];

const BOOK_SCHEMA = `CREATE TABLE IF NOT EXISTS books (
	path TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	accessed_at TEXT,
	access_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS book_tags (
	path TEXT NOT NULL,
	tag TEXT NOT NULL,
	PRIMARY KEY (path, tag)
);
CREATE INDEX IF NOT EXISTS book_tags_tag ON book_tags(tag);
CREATE INDEX IF NOT EXISTS books_created ON books(created_at);
CREATE INDEX IF NOT EXISTS books_accessed ON books(accessed_at);
CREATE INDEX IF NOT EXISTS books_popular ON books(access_count);`;

function BookError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

function HouseDir(house) {
	const dir = String(house && house.path || '').trim();
	if (!dir) throw BookError('House directory is missing.');
	return dir;
}

function YamlScalar(value) {
	return String(value || '').replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
}

function ItemSlug(title) {
	const slug = String(title || '')
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'book';
}

export function LetterOf(slug) {
	const ch = String(slug || '')[0];
	if (ch && ch >= 'a' && ch <= 'z') return ch;
	return '#';
}

function LibraryRoot(houseDir) {
	return path.join(houseDir, 'library');
}

function LetterDir(houseDir, letter) {
	return path.join(LibraryRoot(houseDir), letter);
}

export function EnsureLibraryDir(houseDir) {
	fs.mkdirSync(LibraryRoot(houseDir), { recursive: true });
}

function UniqueName(dir, base) {
	const stem = String(base || 'book').replace(/\.md$/i, '');
	let name = stem + '.md';
	let n = 2;
	while (fs.existsSync(path.join(dir, name))) {
		name = stem + '-' + n + '.md';
		n += 1;
	}
	return name;
}

function ParseFrontmatter(text) {
	const src = String(text || '').replace(/\r\n/g, '\n');
	if (!src.startsWith('---\n')) return { meta: {}, body: src };
	const rest = src.slice(4);
	const end = rest.indexOf('\n---');
	if (end < 0) return { meta: {}, body: src };
	const raw = rest.slice(0, end);
	let body = rest.slice(end + 4);
	if (body.startsWith('\n')) body = body.slice(1);
	const meta = {};
	for (const line of raw.split('\n')) {
		const i = line.indexOf(':');
		if (i < 0) continue;
		const key = line.slice(0, i).trim().toLowerCase();
		const value = line.slice(i + 1).trim();
		if (key) meta[key] = value;
	}
	return { meta, body };
}

export function ParseTags(raw) {
	let list = [];
	if (Array.isArray(raw)) list = raw;
	else if (raw != null && String(raw).trim()) list = String(raw).split(/[,;]/);
	const out = [];
	const seen = new Set();
	for (const item of list) {
		const tag = YamlScalar(item)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, TAG_MAX);
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
		if (out.length >= TAG_CAP) break;
	}
	return out;
}

function TitleFrom(meta, body, filename) {
	const named = String(meta && (meta.title || meta.name) || '').trim();
	if (named) return named;
	const heading = String(body || '').match(/^\s*#\s+(.+)/m);
	if (heading) return heading[1].trim();
	return path.basename(filename, '.md').replace(/-/g, ' ');
}

function RelPath(letter, filename) {
	return 'library/' + letter + '/' + filename;
}

function ListBookFiles(houseDir) {
	EnsureLibraryDir(houseDir);
	const root = LibraryRoot(houseDir);
	const rows = [];
	if (!fs.existsSync(root)) return rows;
	for (const letter of fs.readdirSync(root).sort()) {
		const dir = path.join(root, letter);
		let st;
		try {
			st = fs.statSync(dir);
		} catch {
			continue;
		}
		if (!st.isDirectory()) continue;
		for (const name of fs.readdirSync(dir)) {
			if (name.startsWith('.') || !name.toLowerCase().endsWith('.md')) continue;
			const abs = path.join(dir, name);
			try {
				if (fs.statSync(abs).isFile()) rows.push({ letter, file: name, abs });
			} catch {
				// skip
			}
		}
	}
	return rows;
}

function ReadBookFile(houseDir, letter, filename) {
	const abs = path.join(LetterDir(houseDir, letter), filename);
	if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
		throw BookError('Unknown book file.');
	}
	const parsed = ParseFrontmatter(fs.readFileSync(abs, 'utf8'));
	return {
		file: RelPath(letter, filename),
		letter,
		filename,
		title: TitleFrom(parsed.meta, parsed.body, filename),
		tags: ParseTags(parsed.meta.tags),
		description: String(parsed.meta.description || '').trim(),
		source: String(parsed.meta.source || '').trim(),
		at: String(parsed.meta.at || parsed.meta.created_at || '').trim(),
		body: String(parsed.body || '').replace(/\r\n/g, '\n').replace(/\s+$/, '')
	};
}

function WriteBook(houseDir, item) {
	const dir = LetterDir(houseDir, item.letter);
	fs.mkdirSync(dir, { recursive: true });
	let body = String(item.body || '').replace(/\r\n/g, '\n');
	if (body && !body.endsWith('\n')) body += '\n';
	const text = [
		'---',
		'title: ' + YamlScalar(item.title),
		'tags: ' + item.tags.join(', '),
		'description: ' + YamlScalar(item.description),
		'source: ' + YamlScalar(item.source),
		'at: ' + YamlScalar(item.at),
		'---',
		'',
		body
	].join('\n');
	fs.writeFileSync(path.join(dir, item.filename), text, 'utf8');
}

function IndexPath(houseDir) {
	return path.join(houseDir, INDEX_FILE);
}

function WithIndex(houseDir, fn) {
	const db = new DatabaseSync(IndexPath(houseDir));
	try {
		db.exec(BOOK_SCHEMA);
		return fn(db);
	} finally {
		db.close();
	}
}

export function ParseLibraryRel(rel) {
	const posix = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
	const m = posix.match(/^library\/([^/]+)\/([^/]+\.md)$/i);
	if (!m) return null;
	return { file: 'library/' + m[1] + '/' + m[2], letter: m[1], filename: m[2] };
}

function CatalogRow(pathName, title, description, source, createdAt) {
	return {
		path: pathName,
		title: title || pathName,
		description: description || '',
		source: source || '',
		created_at: createdAt || ''
	};
}

function ReplaceTags(db, file, tags) {
	db.prepare('DELETE FROM book_tags WHERE path = ?').run(file);
	const ins = db.prepare('INSERT INTO book_tags (path, tag) VALUES (?, ?)');
	for (const tag of tags || []) ins.run(file, tag);
}

function UpsertCatalog(db, row, tags) {
	const prev = db.prepare('SELECT accessed_at, access_count, created_at FROM books WHERE path = ?').get(row.path);
	const created = row.created_at || (prev && prev.created_at) || new Date().toISOString();
	db.prepare(
		`INSERT INTO books (path, title, description, source, created_at, accessed_at, access_count)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			title = excluded.title,
			description = excluded.description,
			source = excluded.source,
			created_at = excluded.created_at`
	).run(
		row.path,
		row.title,
		row.description,
		row.source,
		created,
		prev ? prev.accessed_at : null,
		prev ? prev.access_count : 0
	);
	ReplaceTags(db, row.path, tags);
}

function DropCatalog(db, file) {
	db.prepare('DELETE FROM book_tags WHERE path = ?').run(file);
	db.prepare('DELETE FROM books WHERE path = ?').run(file);
}

function IndexFromFile(houseDir, letter, filename) {
	const book = ReadBookFile(houseDir, letter, filename);
	return {
		row: CatalogRow(book.file, book.title, book.description, book.source, book.at),
		tags: book.tags
	};
}

function ReconcileIndex(houseDir) {
	EnsureLibraryDir(houseDir);
	const files = ListBookFiles(houseDir);
	const have = new Set(files.map((row) => RelPath(row.letter, row.file)));
	WithIndex(houseDir, (db) => {
		const indexed = db.prepare('SELECT path FROM books').all();
		for (const row of indexed) {
			if (!have.has(row.path)) DropCatalog(db, row.path);
		}
		const known = new Set(indexed.map((row) => row.path));
		for (const file of files) {
			const rel = RelPath(file.letter, file.file);
			if (known.has(rel)) continue;
			const parsed = IndexFromFile(houseDir, file.letter, file.file);
			UpsertCatalog(db, parsed.row, parsed.tags);
		}
	});
}

function PreviewRow(row, stampKey) {
	const out = { file: row.path, title: row.title };
	if (stampKey && row[stampKey]) out[stampKey === 'created_at' ? 'at' : stampKey] = row[stampKey];
	return out;
}

export function SummarizeBooks(houseDir) {
	const rel = 'library/';
	if (!houseDir) return { path: rel, count: 0, newest: [], accessed: [] };
	ReconcileIndex(houseDir);
	return WithIndex(houseDir, (db) => {
		const count = Number(db.prepare('SELECT COUNT(*) AS n FROM books').get().n) || 0;
		const newest = db.prepare(
			'SELECT path, title, created_at FROM books ORDER BY created_at DESC, path ASC LIMIT ?'
		).all(PREVIEW);
		const accessed = db.prepare(
			'SELECT path, title, accessed_at FROM books WHERE accessed_at IS NOT NULL ORDER BY accessed_at DESC, path ASC LIMIT ?'
		).all(PREVIEW);
		return {
			path: rel,
			count,
			newest: newest.map((row) => PreviewRow(row, 'created_at')),
			accessed: accessed.map((row) => PreviewRow(row, 'accessed_at'))
		};
	});
}

export function TouchBookAccess(houseDir, rel) {
	const parsed = ParseLibraryRel(rel);
	if (!houseDir || !parsed) return;
	const abs = path.join(LetterDir(houseDir, parsed.letter), parsed.filename);
	if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
	try {
		WithIndex(houseDir, (db) => {
			let row = db.prepare('SELECT path FROM books WHERE path = ?').get(parsed.file);
			if (!row) {
				const fresh = IndexFromFile(houseDir, parsed.letter, parsed.filename);
				UpsertCatalog(db, fresh.row, fresh.tags);
			}
			const now = new Date().toISOString();
			db.prepare(
				'UPDATE books SET accessed_at = ?, access_count = access_count + 1 WHERE path = ?'
			).run(now, parsed.file);
		});
	} catch {
		// a failed index bump must not fail the read
	}
}

export function SyncBookFile(houseDir, rel) {
	const parsed = ParseLibraryRel(rel);
	if (!houseDir || !parsed) return;
	const abs = path.join(LetterDir(houseDir, parsed.letter), parsed.filename);
	try {
		if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
			WithIndex(houseDir, (db) => DropCatalog(db, parsed.file));
			return;
		}
		const fresh = IndexFromFile(houseDir, parsed.letter, parsed.filename);
		WithIndex(houseDir, (db) => UpsertCatalog(db, fresh.row, fresh.tags));
	} catch {
		// keep the read/write tool result
	}
}

function LikeNeedle(query) {
	return '%' + String(query || '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
}

function TagsOf(db, file) {
	return db.prepare('SELECT tag FROM book_tags WHERE path = ? ORDER BY tag ASC').all(file).map((row) => row.tag);
}

function ViewRow(db, row) {
	return {
		file: row.path,
		title: row.title,
		tags: TagsOf(db, row.path),
		description: row.description || '',
		source: row.source || '',
		created_at: row.created_at,
		accessed_at: row.accessed_at || null,
		access_count: Number(row.access_count) || 0
	};
}

function RankRow(view, query) {
	const q = String(query || '').trim().toLowerCase();
	if (!q) return 0;
	if (view.title.toLowerCase().includes(q)) return 3;
	if (view.tags.some((tag) => tag === q || tag.includes(q))) return 2;
	if (view.description.toLowerCase().includes(q)) return 1;
	return 0;
}

export function SearchBooks(house, payload) {
	const houseDir = HouseDir(house);
	EnsureLibraryDir(houseDir);
	const query = YamlScalar(payload && payload.query);
	const tags = ParseTags(payload && payload.tags);
	const source = YamlScalar(payload && payload.source);
	if (source.length > SOURCE_MAX) {
		throw BookError('Source is too long (max ' + SOURCE_MAX + ' characters).');
	}
	let order = String((payload && (payload.order != null ? payload.order : payload.mode)) || '').trim().toLowerCase();
	if (!order) order = query ? 'relevant' : 'accessed';
	if (!ORDERS.includes(order)) {
		throw BookError('Unknown search order "' + order + '". Valid: ' + ORDERS.join(', ') + '.');
	}
	let limit = payload && payload.limit != null ? Number(payload.limit) : SEARCH_DEFAULT;
	if (!Number.isFinite(limit)) throw BookError('payload.limit must be a number.');
	limit = Math.max(1, Math.min(SEARCH_MAX, Math.floor(limit)));
	if (order === 'relevant' && !query) {
		return { query, tags, source, order, limit, count: 0, items: [] };
	}
	ReconcileIndex(houseDir);
	return WithIndex(houseDir, (db) => {
		let sql = 'SELECT path, title, description, source, created_at, accessed_at, access_count FROM books';
		const where = [];
		const args = [];
		if (tags.length) {
			where.push(
				'path IN (SELECT path FROM book_tags WHERE tag IN (' +
				tags.map(() => '?').join(', ') +
				') GROUP BY path HAVING COUNT(DISTINCT tag) = ?)'
			);
			args.push(...tags, tags.length);
		}
		if (source) {
			where.push('source LIKE ? ESCAPE \'\\\'');
			args.push(LikeNeedle(source));
		}
		if (query) {
			const needle = LikeNeedle(query);
			where.push(
				'(title LIKE ? ESCAPE \'\\\' OR description LIKE ? ESCAPE \'\\\' OR path IN (SELECT path FROM book_tags WHERE tag LIKE ? ESCAPE \'\\\'))'
			);
			args.push(needle, needle, needle);
		}
		if (where.length) sql += ' WHERE ' + where.join(' AND ');
		if (order === 'created') sql += ' ORDER BY created_at DESC, path ASC';
		else if (order === 'popular') sql += ' ORDER BY access_count DESC, accessed_at DESC, path ASC';
		else sql += ' ORDER BY (accessed_at IS NULL), accessed_at DESC, path ASC';
		sql += ' LIMIT ?';
		args.push(order === 'relevant' ? SEARCH_SCAN : limit);
		let rows = db.prepare(sql).all(...args).map((row) => ViewRow(db, row));
		if (order === 'relevant') {
			rows = rows
				.map((row) => ({ row, rank: RankRow(row, query) }))
				.filter((item) => item.rank > 0)
				.sort((a, b) => {
					if (b.rank !== a.rank) return b.rank - a.rank;
					const at = String(b.row.accessed_at || '').localeCompare(String(a.row.accessed_at || ''));
					if (at) return at;
					return a.row.file.localeCompare(b.row.file);
				})
				.slice(0, limit)
				.map((item) => item.row);
		}
		return { query, tags, source, order, limit, count: rows.length, items: rows };
	});
}

export function BooksBoard(houseDir, payload) {
	const rel = 'library/';
	if (!houseDir) {
		return { path: rel, query: '', tags: [], source: '', order: 'created', limit: SEARCH_MAX, count: 0, items: [] };
	}
	const out = SearchBooks({ path: houseDir }, { ...(payload || {}), limit: SEARCH_MAX });
	return { path: rel, ...out };
}

function FindBook(houseDir, query) {
	EnsureLibraryDir(houseDir);
	const raw = String(query || '').trim();
	if (!raw) throw BookError('payload.book is required (title or file).');
	const items = ListBookFiles(houseDir).map((row) => ReadBookFile(houseDir, row.letter, row.file));
	const posix = raw.replace(/\\/g, '/');
	const base = path.basename(posix);
	const withMd = base.toLowerCase().endsWith('.md') ? base : base + '.md';
	const byFile = items.filter((t) => {
		return t.file === posix || t.file === 'library/' + posix || t.filename === base || t.filename === withMd;
	});
	if (byFile.length === 1) return byFile[0];
	const q = raw.toLowerCase();
	const byTitle = items.filter((t) => t.title.toLowerCase() === q);
	if (byTitle.length === 1) return byTitle[0];
	if (byFile.length > 1 || byTitle.length > 1) {
		throw BookError('That title matches more than one book. Use the file name.');
	}
	throw BookError('No book titled "' + raw + '".');
}

export function CreateBook(house, payload) {
	const houseDir = HouseDir(house);
	EnsureLibraryDir(houseDir);
	const title = YamlScalar(payload && (payload.title || payload.name));
	if (!title) throw BookError('A title is required.');
	if (title.length > TITLE_MAX) throw BookError('Title is too long (max ' + TITLE_MAX + ' characters).');
	const tags = ParseTags(payload && payload.tags);
	const description = YamlScalar(payload && payload.description);
	if (description.length > DESC_MAX) {
		throw BookError('Description is too long (max ' + DESC_MAX + ' characters).');
	}
	const source = YamlScalar(payload && payload.source);
	if (source.length > SOURCE_MAX) {
		throw BookError('Source is too long (max ' + SOURCE_MAX + ' characters).');
	}
	let body = payload && payload.body != null ? String(payload.body) : '';
	body = body.replace(/\r\n/g, '\n');
	if (!body.trim()) throw BookError('A body is required.');
	if (Buffer.byteLength(body, 'utf8') > BODY_MAX) {
		throw BookError('Body is too large (max ' + BODY_MAX + ' bytes).');
	}
	const slug = ItemSlug(title);
	const letter = LetterOf(slug);
	const filename = UniqueName(LetterDir(houseDir, letter), slug);
	const item = {
		letter,
		filename,
		title,
		tags,
		description,
		source,
		at: new Date().toISOString(),
		body
	};
	WriteBook(houseDir, item);
	const file = RelPath(letter, filename);
	WithIndex(houseDir, (db) => {
		UpsertCatalog(db, CatalogRow(file, title, description, source, item.at), tags);
	});
	return {
		file,
		title,
		tags,
		description,
		source,
		letter,
		books: SummarizeBooks(houseDir)
	};
}

export function RemoveBook(house, query) {
	const houseDir = HouseDir(house);
	const found = FindBook(houseDir, query);
	const abs = path.join(LetterDir(houseDir, found.letter), found.filename);
	fs.unlinkSync(abs);
	const dir = LetterDir(houseDir, found.letter);
	try {
		if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
	} catch {
		// leave the letter folder
	}
	WithIndex(houseDir, (db) => DropCatalog(db, found.file));
	return {
		file: found.file,
		title: found.title,
		books: SummarizeBooks(houseDir)
	};
}
