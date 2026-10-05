import fs from 'node:fs';
import path from 'node:path';

const NAME_MAX = 120;
const RELATION_MAX = 80;
const BODY_MAX = 8 * 1024;
const EXAMINE_NAME_CAP = 100;

function ContactError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

function HouseDir(house) {
	const dir = String(house && house.path || '').trim();
	if (!dir) throw ContactError('House directory is missing.');
	return dir;
}

function YamlScalar(value) {
	return String(value || '').replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
}

function ItemSlug(name) {
	const slug = String(name || '')
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'contact';
}

export function LetterOf(slug) {
	const ch = String(slug || '')[0];
	if (ch && ch >= 'a' && ch <= 'z') return ch;
	return '#';
}

function ContactsRoot(houseDir) {
	return path.join(houseDir, 'contacts');
}

function LetterDir(houseDir, letter) {
	return path.join(ContactsRoot(houseDir), letter);
}

export function EnsureContactsDir(houseDir) {
	fs.mkdirSync(ContactsRoot(houseDir), { recursive: true });
}

function UniqueName(dir, base) {
	const stem = String(base || 'contact').replace(/\.md$/i, '');
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

function NameFrom(meta, body, filename) {
	const named = String(meta && (meta.name || meta.title) || '').trim();
	if (named) return named;
	const heading = String(body || '').match(/^\s*#\s+(.+)/m);
	if (heading) return heading[1].trim();
	return path.basename(filename, '.md').replace(/-/g, ' ');
}

function RelPath(letter, filename) {
	return 'contacts/' + letter + '/' + filename;
}

function ListContactFiles(houseDir) {
	EnsureContactsDir(houseDir);
	const root = ContactsRoot(houseDir);
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

function ReadContactFile(houseDir, letter, filename) {
	const abs = path.join(LetterDir(houseDir, letter), filename);
	if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
		throw ContactError('Unknown contact file.');
	}
	const parsed = ParseFrontmatter(fs.readFileSync(abs, 'utf8'));
	return {
		file: RelPath(letter, filename),
		letter,
		filename,
		name: NameFrom(parsed.meta, parsed.body, filename),
		relation: String(parsed.meta.relation || parsed.meta.relationship || '').trim(),
		at: String(parsed.meta.at || '').trim(),
		body: String(parsed.body || '').replace(/\r\n/g, '\n').replace(/\s+$/, '')
	};
}

function WriteContact(houseDir, item) {
	const dir = LetterDir(houseDir, item.letter);
	fs.mkdirSync(dir, { recursive: true });
	let body = String(item.body || '').replace(/\r\n/g, '\n');
	if (body && !body.endsWith('\n')) body += '\n';
	const text = [
		'---',
		'name: ' + YamlScalar(item.name),
		'relation: ' + YamlScalar(item.relation),
		'at: ' + YamlScalar(item.at),
		'---',
		'',
		body
	].join('\n');
	fs.writeFileSync(path.join(dir, item.filename), text, 'utf8');
}

function ContactCards(houseDir) {
	EnsureContactsDir(houseDir);
	const items = ListContactFiles(houseDir).map((row) => {
		const card = ReadContactFile(houseDir, row.letter, row.file);
		return {
			file: card.file,
			name: card.name,
			relation: card.relation,
			letter: card.letter
		};
	});
	items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.file.localeCompare(b.file));
	return items;
}

export function ContactsState(houseDir) {
	const rel = 'contacts/';
	if (!houseDir) return { path: rel, count: 0, items: [] };
	const items = ContactCards(houseDir);
	return { path: rel, count: items.length, items };
}

export function SummarizeContacts(houseDir) {
	const rel = 'contacts/';
	if (!houseDir) return { path: rel, count: 0 };
	EnsureContactsDir(houseDir);
	const files = ListContactFiles(houseDir);
	const out = { path: rel, count: files.length };
	if (files.length > EXAMINE_NAME_CAP) return out;
	out.names = ContactCards(houseDir).map((row) => row.name);
	return out;
}

function FindContact(houseDir, query) {
	EnsureContactsDir(houseDir);
	const raw = String(query || '').trim();
	if (!raw) throw ContactError('payload.contact is required (name or file).');
	const items = ListContactFiles(houseDir).map((row) => ReadContactFile(houseDir, row.letter, row.file));
	const posix = raw.replace(/\\/g, '/');
	const base = path.basename(posix);
	const withMd = base.toLowerCase().endsWith('.md') ? base : base + '.md';
	const byFile = items.filter((t) => {
		return t.file === posix || t.file === 'contacts/' + posix || t.filename === base || t.filename === withMd;
	});
	if (byFile.length === 1) return byFile[0];
	const q = raw.toLowerCase();
	const byName = items.filter((t) => t.name.toLowerCase() === q);
	if (byName.length === 1) return byName[0];
	if (byFile.length > 1 || byName.length > 1) {
		throw ContactError('That name matches more than one contact. Use the file name.');
	}
	throw ContactError('No contact named "' + raw + '".');
}

export function CreateContact(house, payload) {
	const houseDir = HouseDir(house);
	EnsureContactsDir(houseDir);
	const name = YamlScalar(payload && (payload.name || payload.title));
	if (!name) throw ContactError('A name is required.');
	if (name.length > NAME_MAX) throw ContactError('Name is too long (max ' + NAME_MAX + ' characters).');
	const relation = YamlScalar(payload && (payload.relation || payload.relationship));
	if (relation.length > RELATION_MAX) {
		throw ContactError('Relation is too long (max ' + RELATION_MAX + ' characters).');
	}
	let body = payload && payload.body != null ? String(payload.body) : '';
	if (Buffer.byteLength(body, 'utf8') > BODY_MAX) {
		throw ContactError('Body is too large (max ' + BODY_MAX + ' bytes).');
	}
	body = body.replace(/\r\n/g, '\n');
	const slug = ItemSlug(name);
	const letter = LetterOf(slug);
	const filename = UniqueName(LetterDir(houseDir, letter), slug);
	const item = {
		letter,
		filename,
		name,
		relation,
		at: new Date().toISOString(),
		body
	};
	WriteContact(houseDir, item);
	return {
		file: RelPath(letter, filename),
		name,
		relation,
		letter,
		contacts: ContactsState(houseDir)
	};
}

export function RemoveContact(house, query) {
	const houseDir = HouseDir(house);
	const found = FindContact(houseDir, query);
	const abs = path.join(LetterDir(houseDir, found.letter), found.filename);
	fs.unlinkSync(abs);
	const dir = LetterDir(houseDir, found.letter);
	try {
		if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
	} catch {
		// leave the letter folder
	}
	return {
		file: found.file,
		name: found.name,
		contacts: ContactsState(houseDir)
	};
}
