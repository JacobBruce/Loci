import fs from 'node:fs';
import path from 'node:path';

export const PLAN_CAP = 16;
export const NOTE_CAP = 32;

const TITLE_MAX = 120;
const PLAN_BODY_MAX = 64 * 1024;
const NOTE_BODY_MAX = 8 * 1024;

function BoardError(message) {
	return new Error(message);
}

function HouseDir(house) {
	const dir = String(house && house.path || '').trim();
	if (!dir) throw BoardError('House directory is missing.');
	return dir;
}

function YamlScalar(value) {
	return String(value || '').replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
}

function ItemSlug(title, fallback) {
	const slug = String(title || '')
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || fallback;
}

function UniqueName(dir, base) {
	const stem = String(base || 'item').replace(/\.md$/i, '');
	let name = stem + '.md';
	let n = 2;
	while (fs.existsSync(path.join(dir, name))) {
		name = stem + '-' + n + '.md';
		n += 1;
	}
	return name;
}

function ItemFileName(raw) {
	const name = path.basename(String(raw || ''));
	if (!name || name.startsWith('.') || name.includes('..') || !name.toLowerCase().endsWith('.md')) {
		throw BoardError('Unknown file.');
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

function LimitBody(raw, label, max) {
	const body = raw == null ? '' : String(raw);
	if (Buffer.byteLength(body, 'utf8') > max) {
		throw BoardError((label || 'Body') + ' is too large (max ' + max + ' bytes).');
	}
	return body;
}

function KindSpec(kind) {
	if (kind === 'note') {
		return {
			kind: 'note',
			folder: 'notes',
			cap: NOTE_CAP,
			label: 'Sticky note',
			plural: 'sticky notes',
			bodyMax: NOTE_BODY_MAX,
			fallback: 'note'
		};
	}
	return {
		kind: 'plan',
		folder: 'plans',
		cap: PLAN_CAP,
		label: 'Plan',
		plural: 'plans',
		bodyMax: PLAN_BODY_MAX,
		fallback: 'plan'
	};
}

function KindDir(houseDir, spec) {
	return path.join(houseDir, spec.folder);
}

export function EnsureBoardDirs(houseDir) {
	fs.mkdirSync(path.join(houseDir, 'plans'), { recursive: true });
	fs.mkdirSync(path.join(houseDir, 'notes'), { recursive: true });
}

function ListKindFiles(houseDir, spec) {
	const dir = KindDir(houseDir, spec);
	if (!fs.existsSync(dir)) return [];
	const names = [];
	for (const name of fs.readdirSync(dir)) {
		if (name.startsWith('.') || !name.toLowerCase().endsWith('.md')) continue;
		try {
			if (fs.statSync(path.join(dir, name)).isFile()) names.push(name);
		} catch {
			// skip
		}
	}
	return names.sort();
}

function TitleFrom(meta, body, filename) {
	const titled = String(meta && meta.title || '').trim();
	if (titled) return titled;
	const heading = String(body || '').match(/^\s*#\s+(.+)/m);
	if (heading) return heading[1].trim();
	return path.basename(filename, '.md').replace(/-/g, ' ');
}

function ReadItem(houseDir, spec, filename) {
	const name = ItemFileName(filename);
	const dest = path.join(KindDir(houseDir, spec), name);
	if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) {
		throw BoardError('Unknown ' + spec.label.toLowerCase() + ' file.');
	}
	const parsed = ParseFrontmatter(fs.readFileSync(dest, 'utf8'));
	return {
		file: name,
		title: TitleFrom(parsed.meta, parsed.body, name),
		at: String(parsed.meta.at || '').trim(),
		body: String(parsed.body || '').replace(/\r\n/g, '\n').replace(/\s+$/, ''),
		kind: spec.kind,
		path: spec.folder + '/' + name
	};
}

function WriteItem(houseDir, spec, item) {
	const dir = KindDir(houseDir, spec);
	fs.mkdirSync(dir, { recursive: true });
	let body = String(item.body || '').replace(/\r\n/g, '\n');
	if (body && !body.endsWith('\n')) body += '\n';
	const text = [
		'---',
		'title: ' + YamlScalar(item.title),
		'at: ' + YamlScalar(item.at),
		'---',
		'',
		body
	].join('\n');
	fs.writeFileSync(path.join(dir, item.file), text, 'utf8');
}

function SummarizeKind(houseDir, spec) {
	const rel = spec.folder + '/';
	if (!houseDir) return { path: rel, count: 0, cap: spec.cap, items: [] };
	EnsureBoardDirs(houseDir);
	const items = ListKindFiles(houseDir, spec).map((name) => {
		const row = ReadItem(houseDir, spec, name);
		return { file: row.path, title: row.title, at: row.at };
	});
	items.sort((a, b) => {
		const at = String(b.at).localeCompare(String(a.at));
		if (at) return at;
		return a.file.localeCompare(b.file);
	});
	return { path: rel, count: items.length, cap: spec.cap, items };
}

export function SummarizeWhiteboard(houseDir) {
	return {
		plans: SummarizeKind(houseDir, KindSpec('plan')),
		notes: SummarizeKind(houseDir, KindSpec('note'))
	};
}

const PREVIEW_MAX = 140;

function NotePreview(body) {
	const text = String(body || '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	if (text.length <= PREVIEW_MAX) return text;
	return text.slice(0, PREVIEW_MAX - 1) + '…';
}

export function WhiteboardBoard(houseDir) {
	const plans = SummarizeKind(houseDir, KindSpec('plan'));
	const spec = KindSpec('note');
	const notes = SummarizeKind(houseDir, spec);
	notes.items = notes.items.map((row) => {
		try {
			const item = ReadItem(houseDir, spec, path.basename(row.file));
			return { file: row.file, title: row.title, at: row.at, preview: NotePreview(item.body) };
		} catch {
			return { file: row.file, title: row.title, at: row.at, preview: '' };
		}
	});
	return { plans, notes };
}

function FindKind(house, kind, query) {
	const spec = KindSpec(kind);
	const houseDir = HouseDir(house);
	EnsureBoardDirs(houseDir);
	const raw = String(query || '').trim();
	if (!raw) throw BoardError('payload.' + spec.kind + ' is required (title or file name).');
	const names = ListKindFiles(houseDir, spec);
	const items = names.map((name) => ReadItem(houseDir, spec, name));
	const base = path.basename(raw);
	const withMd = base.toLowerCase().endsWith('.md') ? base : base + '.md';
	const byFile = items.filter((t) => t.file === base || t.file === withMd);
	if (byFile.length === 1) return { spec, houseDir, item: byFile[0] };
	const q = raw.toLowerCase();
	const byTitle = items.filter((t) => t.title.toLowerCase() === q);
	if (byTitle.length === 1) return { spec, houseDir, item: byTitle[0] };
	if (byFile.length > 1 || byTitle.length > 1) {
		throw BoardError('That name matches more than one ' + spec.label.toLowerCase() + '. Use the file name.');
	}
	throw BoardError('No ' + spec.label.toLowerCase() + ' named "' + raw + '".');
}

export function CreateBoardItem(house, kind, payload) {
	const spec = KindSpec(kind);
	const houseDir = HouseDir(house);
	EnsureBoardDirs(houseDir);
	if (ListKindFiles(houseDir, spec).length >= spec.cap) {
		throw BoardError('Whiteboard is full of ' + spec.plural + ' (' + spec.cap + '). Remove one before adding another.');
	}
	const title = YamlScalar(payload && payload.title);
	if (!title) throw BoardError('A title is required.');
	if (title.length > TITLE_MAX) {
		throw BoardError('Title is too long (max ' + TITLE_MAX + ' characters).');
	}
	const body = LimitBody(payload && payload.body, spec.label, spec.bodyMax).replace(/\r\n/g, '\n');
	if (spec.kind === 'plan' && !body.trim()) {
		throw BoardError('A plan body is required.');
	}
	const filename = UniqueName(KindDir(houseDir, spec), ItemSlug(title, spec.fallback));
	const item = {
		file: filename,
		title,
		at: new Date().toISOString(),
		body
	};
	WriteItem(houseDir, spec, item);
	return {
		kind: spec.kind,
		file: spec.folder + '/' + filename,
		title,
		board: SummarizeKind(houseDir, spec)
	};
}

export function RemoveBoardItem(house, kind, query) {
	const found = FindKind(house, kind, query);
	fs.unlinkSync(path.join(KindDir(found.houseDir, found.spec), found.item.file));
	return {
		kind: found.spec.kind,
		file: found.item.path,
		title: found.item.title,
		board: SummarizeKind(found.houseDir, found.spec)
	};
}
