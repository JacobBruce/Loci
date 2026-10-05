import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApplyTemplate as FillTemplate } from './apply-template.js';
import { AlarmsPath, EnsureAlarmsFile, ParseAlarmsFile, ReadAlarms } from './alarms.js';
import { ReadEvents } from './events.js';
import { EnsureEventsFile } from './events.js';
import { SeedHouseConfig } from './house-config.js';

const TEMPLATE_DIR = path.join(import.meta.dirname, 'templates');
const META_FILE = 'house.json';

const HOUSE_FILES = [
	'BOOT.md',
	'SYSTEM.md',
	'SOUL.md',
	'USER.md',
	'NOTES.md',
	'LOGOFF.md'
];

export const HOUSE_DIRS = [
	'diary',
	'calendar',
	'plans',
	'notes',
	'tasks',
	'contacts',
	'mail',
	'cabinet',
	'library',
	'artifacts',
	'stories',
	'archive',
	'rules',
	'skills'
];

const LOGOFF_HEADING = '## Logoff notes';
const LOGOFF_HEADING_RE = /^##[ \t]+Logoff[ \t]+notes[ \t]*$/im;

export function SplitLogoffMd(text) {
	const src = String(text || '').replace(/\r\n/g, '\n');
	const match = src.match(LOGOFF_HEADING_RE);
	if (match && match.index != null) {
		return {
			ritual: src.slice(0, match.index).replace(/\s+$/, ''),
			notes: src.slice(match.index + match[0].length).replace(/^\s+/, '').replace(/\s+$/, '')
		};
	}
	return { ritual: src.replace(/\s+$/, ''), notes: '' };
}

export function JoinLogoffMd(ritual, notes) {
	const head = String(ritual || '').replace(/\s+$/, '') || '# Logoff';
	const body = String(notes || '').replace(/^\s+/, '').replace(/\s+$/, '');
	let out = head + '\n\n' + LOGOFF_HEADING + '\n';
	if (body) out += '\n' + body + '\n';
	else out += '\n';
	return out;
}

function LogoffPath(houseDir) {
	return path.join(houseDir, 'LOGOFF.md');
}

function ReadLogoffParts(houseDir) {
	const p = LogoffPath(houseDir);
	if (!fs.existsSync(p)) return { ritual: '', notes: '' };
	return SplitLogoffMd(fs.readFileSync(p, 'utf8'));
}

function WriteLogoffParts(houseDir, ritual, notes) {
	fs.writeFileSync(LogoffPath(houseDir), JoinLogoffMd(ritual, notes), 'utf8');
}

function EnsureLogoffMd(houseDir) {
	const parts = ReadLogoffParts(houseDir);
	WriteLogoffParts(houseDir, parts.ritual, parts.notes);
}

export function DefaultHousesRoot() {
	return path.join(os.homedir(), '.loci', 'houses');
}

/** @returns {string} */
export function Slugify(name) {
	const slug = String(name || '')
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'house';
}

function ReadTemplate(name) {
	return fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
}

/**
 * @param {string} text
 * @param {{ name?: string, group?: string }} vars
 */
export function ApplyTemplate(text, vars) {
	return FillTemplate(text, {
		name: vars && vars.name,
		group: vars && vars.group,
		teamAlone: ReadTemplate('team-solitary.md'),
		teamGroup: ReadTemplate('team-group.md')
	});
}

export function DefaultHouseMeta() {
	return {
		name: '',
		description: '',
		group: '',
		enabled: true,
		agent_alarms: true,
		agent_events: true,
		agent_web: true,
		project_manager: false,
		max_turns: 0,
		run_command: false,
		workspaces: [],
		provider: '',
		model: ''
	};
}

function NormalizeMeta(raw, slug) {
	const d = DefaultHouseMeta();
	const src = (raw && typeof raw === 'object') ? raw : {};
	d.name = String(src.name || slug || '').trim() || slug;
	d.description = String(src.description || '').trim();
	d.group = String(src.group || '').trim();
	d.enabled = src.enabled !== false;
	d.agent_alarms = src.agent_alarms !== false;
	d.agent_events = src.agent_events !== false;
	d.agent_web = src.agent_web !== false;
	d.project_manager = src.project_manager === true;
	const maxTurns = Number(src.max_turns != null ? src.max_turns : src.max_beats);
	d.max_turns = Number.isFinite(maxTurns) && maxTurns > 0 ? Math.floor(maxTurns) : 0;
	d.run_command = !!src.run_command;
	const ws = Array.isArray(src.workspaces) ? src.workspaces : [];
	d.workspaces = ws.map((p) => String(p || '').trim()).filter(Boolean);
	const provider = String(src.provider || '').trim().toLowerCase();
	d.provider = (provider === 'openai' || provider === 'anthropic' || provider === 'openrouter')
		? provider
		: '';
	d.model = String(src.model || '').trim();
	return d;
}

function HousePath(root, slug) {
	return path.resolve(root, slug);
}

function MetaPath(root, slug) {
	return path.join(HousePath(root, slug), META_FILE);
}

function ReadMetaFile(root, slug) {
	const p = MetaPath(root, slug);
	if (!fs.existsSync(p)) return NormalizeMeta({}, slug);
	try {
		return NormalizeMeta(JSON.parse(fs.readFileSync(p, 'utf8')), slug);
	} catch (err) {
		return NormalizeMeta({}, slug);
	}
}

function WriteMetaFile(root, slug, meta) {
	const next = NormalizeMeta(meta, slug);
	fs.writeFileSync(MetaPath(root, slug), JSON.stringify(next, null, '\t') + '\n', 'utf8');
	return next;
}

function IsHouseDir(dir) {
	return fs.existsSync(path.join(dir, 'SOUL.md')) || fs.existsSync(path.join(dir, META_FILE));
}

function SeedDirs(houseDir) {
	fs.mkdirSync(houseDir, { recursive: true });
	for (const dir of HOUSE_DIRS) {
		fs.mkdirSync(path.join(houseDir, dir), { recursive: true });
	}
	for (const name of ['inbox', 'read', 'sent']) {
		fs.mkdirSync(path.join(houseDir, 'mail', name), { recursive: true });
	}
}

function WriteAlarmsText(houseDir, text) {
	const raw = String(text || '');
	const parsed = ParseAlarmsFile(raw);
	if (parsed.errors.length) {
		const first = parsed.errors[0];
		throw new Error('ALARMS line ' + first.line + ': ' + first.error);
	}
	if (parsed.alarms.length > 16) throw new Error('At most 16 alarms.');
	fs.writeFileSync(AlarmsPath(houseDir), raw.replace(/\r\n/g, '\n'), 'utf8');
}

function WriteIdentity(houseDir, files) {
	for (const name of HOUSE_FILES) {
		if (!Object.prototype.hasOwnProperty.call(files, name)) continue;
		fs.writeFileSync(path.join(houseDir, name), files[name], 'utf8');
	}
}

function SeedMissingFiles(houseDir, vars) {
	for (const name of HOUSE_FILES) {
		const dest = path.join(houseDir, name);
		if (fs.existsSync(dest)) continue;
		fs.writeFileSync(dest, ApplyTemplate(ReadTemplate(name), vars), 'utf8');
	}
}

/**
 * @param {string} root
 * @returns {object[]}
 */
export function ListHouses(root) {
	const housesRoot = path.resolve(root || DefaultHousesRoot());
	if (!fs.existsSync(housesRoot)) return [];
	const out = [];
	for (const name of fs.readdirSync(housesRoot)) {
		const dir = path.join(housesRoot, name);
		let st;
		try {
			st = fs.statSync(dir);
		} catch (err) {
			continue;
		}
		if (!st.isDirectory() || !IsHouseDir(dir)) continue;
		const meta = ReadMetaFile(housesRoot, name);
		out.push({
			slug: name,
			path: dir,
			...meta,
			alarm_count: ReadAlarms(dir).alarms.length,
			event_count: ReadEvents(dir).events.length
		});
	}
	out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
	return out;
}

export function LoadTemplates() {
	return {
		'BOOT.md': ReadTemplate('BOOT.md'),
		'SYSTEM.md': ReadTemplate('SYSTEM.md'),
		'SOUL.md': ReadTemplate('SOUL.md'),
		'USER.md': ReadTemplate('USER.md'),
		'LOGOFF.md': ReadTemplate('LOGOFF.md'),
		'team-solitary.md': ReadTemplate('team-solitary.md'),
		'team-group.md': ReadTemplate('team-group.md')
	};
}

function IdentityFromPayload(payload, name) {
	const vars = { name, group: payload && payload.group };
	const templates = LoadTemplates();
	const pick = (key, fallback) => {
		if (payload && payload[key] != null && String(payload[key]).length) {
			return ApplyTemplate(String(payload[key]), vars);
		}
		return ApplyTemplate(fallback, vars);
	};
	return {
		'BOOT.md': pick('boot', templates['BOOT.md']),
		'SYSTEM.md': pick('system', templates['SYSTEM.md']),
		'SOUL.md': pick('soul', templates['SOUL.md']),
		'USER.md': pick('user', templates['USER.md']),
		'LOGOFF.md': pick('logoff', templates['LOGOFF.md'])
	};
}

/**
 * @param {string} root
 * @param {object} payload
 */
export function CreateHouse(root, payload) {
	const housesRoot = path.resolve(root || DefaultHousesRoot());
	const name = String(payload && payload.name || '').trim();
	if (!name) throw new Error('House name is required');
	const slug = Slugify(payload.slug || name);
	const dest = HousePath(housesRoot, slug);
	if (fs.existsSync(dest)) throw new Error('A house named "' + slug + '" already exists');
	fs.mkdirSync(housesRoot, { recursive: true });
	SeedDirs(dest);
	const meta = WriteMetaFile(housesRoot, slug, { ...payload, name });
	WriteIdentity(dest, IdentityFromPayload(payload, name));
	SeedMissingFiles(dest, { name, group: payload.group });
	EnsureLogoffMd(dest);
	WriteAlarmsText(dest, payload && payload.alarms != null ? payload.alarms : '');
	EnsureEventsFile(dest);
	SeedHouseConfig(housesRoot, slug);
	return { slug, path: dest, ...meta };
}

/**
 * @param {string} root
 * @param {string} slug
 * @param {object} payload
 */
export function UpdateHouse(root, slug, payload) {
	const housesRoot = path.resolve(root || DefaultHousesRoot());
	const dest = HousePath(housesRoot, slug);
	if (!IsHouseDir(dest)) throw new Error('House not found: ' + slug);
	const prev = ReadMetaFile(housesRoot, slug);
	const name = String(payload && payload.name || prev.name).trim() || slug;
	const meta = WriteMetaFile(housesRoot, slug, { ...prev, ...payload, name });
	const files = {};
	if (payload && payload.boot != null) files['BOOT.md'] = String(payload.boot);
	if (payload && payload.system != null) files['SYSTEM.md'] = String(payload.system);
	if (payload && payload.soul != null) files['SOUL.md'] = String(payload.soul);
	if (payload && payload.user != null) files['USER.md'] = String(payload.user);
	if (payload && payload.logoff != null) {
		const form = SplitLogoffMd(String(payload.logoff));
		const disk = ReadLogoffParts(dest);
		files['LOGOFF.md'] = JoinLogoffMd(form.ritual, disk.notes);
	}
	WriteIdentity(dest, files);
	if (payload && payload.alarms != null) WriteAlarmsText(dest, payload.alarms);
	return { slug, path: dest, ...meta };
}

/**
 * @param {string} root
 * @param {string} slug
 */
export function ReadHouse(root, slug) {
	const housesRoot = path.resolve(root || DefaultHousesRoot());
	const dest = HousePath(housesRoot, slug);
	if (!IsHouseDir(dest)) throw new Error('House not found: ' + slug);
	const meta = ReadMetaFile(housesRoot, slug);
	SeedDirs(dest);
	SeedMissingFiles(dest, { name: meta.name, group: meta.group });
	EnsureLogoffMd(dest);
	EnsureAlarmsFile(dest, '');
	EnsureEventsFile(dest);
	SeedHouseConfig(housesRoot, slug);
	const read = (name) => {
		const p = path.join(dest, name);
		return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
	};
	return {
		slug,
		path: dest,
		...meta,
		boot: read('BOOT.md'),
		system: read('SYSTEM.md'),
		soul: read('SOUL.md'),
		user: read('USER.md'),
		logoff: SplitLogoffMd(read('LOGOFF.md')).ritual,
		alarms: read('ALARMS')
	};
}

const UNREADABLE_FILES = new Set(['house.json', 'session.jsonl', 'index.db', 'world.json']);
const MARKDOWN_MAX = 256 * 1024;

function IsInsideHouse(abs, root) {
	const a = path.resolve(abs);
	const r = path.resolve(root);
	const rel = path.relative(r, a);
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function HouseRelAbs(houseDir, relRaw) {
	const root = path.resolve(houseDir);
	const raw = String(relRaw || '').trim();
	if (!raw || raw.includes('\0') || path.isAbsolute(raw)) return null;
	const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
	if (!rel || rel === '..' || rel.startsWith('../') || rel.split('/').includes('..')) return null;
	if (/^[a-zA-Z]:/.test(rel)) return null;
	const abs = path.resolve(root, rel);
	if (!IsInsideHouse(abs, root)) return null;
	return { root, rel, abs };
}

/**
 * Resolve a house-relative path for Show in folder.
 * Missing files walk up to the nearest existing ancestor still in the house.
 * @param {string} houseDir
 * @param {string} relRaw
 * @returns {string | null}
 */
export function RevealHousePath(houseDir, relRaw) {
	const found = HouseRelAbs(houseDir, relRaw);
	if (!found) return null;
	let abs = found.abs;
	while (!fs.existsSync(abs)) {
		const parent = path.dirname(abs);
		if (parent === abs || !IsInsideHouse(parent, found.root)) return found.root;
		abs = parent;
	}
	return abs;
}

export function IsMarkdownRel(rel) {
	return /\.md$/i.test(String(rel || '').trim());
}

export function ReadHouseMarkdown(houseDir, relRaw) {
	if (!IsMarkdownRel(relRaw)) throw new Error('That path is not a markdown file.');
	const found = HouseRelAbs(houseDir, relRaw);
	if (!found) throw new Error('That path is not in this house.');
	if (UNREADABLE_FILES.has(path.basename(found.rel))) {
		throw new Error('That file cannot be opened.');
	}
	if (!fs.existsSync(found.abs) || !fs.statSync(found.abs).isFile()) {
		throw new Error('That file was not found.');
	}
	if (fs.statSync(found.abs).size > MARKDOWN_MAX) {
		throw new Error('That file is too large to open here.');
	}
	return {
		file: found.rel,
		text: fs.readFileSync(found.abs, 'utf8')
	};
}

export function DiaryBoard(houseDir) {
	const rel = 'diary/';
	if (!houseDir) return { path: rel, count: 0, items: [] };
	const dir = path.join(houseDir, 'diary');
	if (!fs.existsSync(dir)) return { path: rel, count: 0, items: [] };
	const names = [];
	for (const name of fs.readdirSync(dir)) {
		if (name.startsWith('.') || !name.toLowerCase().endsWith('.md')) continue;
		try {
			if (fs.statSync(path.join(dir, name)).isFile()) names.push(name);
		} catch {
			// skip
		}
	}
	names.sort().reverse();
	return {
		path: rel,
		count: names.length,
		items: names.map((name) => ({
			file: rel + name,
			date: name.replace(/\.md$/i, '')
		}))
	};
}

function ArchiveRoot(housesRoot) {
	return path.join(path.dirname(path.resolve(housesRoot)), 'archive');
}

/**
 * Move a house out of the roster to `~/.loci/archive/<slug>/`.
 * @param {string} root
 * @param {string} slug
 * @returns {string} Archive path.
 */
export function ArchiveHouse(root, slug) {
	const housesRoot = path.resolve(root || DefaultHousesRoot());
	const src = HousePath(housesRoot, slug);
	if (!IsHouseDir(src)) throw new Error('House not found: ' + slug);
	const archiveRoot = ArchiveRoot(housesRoot);
	fs.mkdirSync(archiveRoot, { recursive: true });
	let dest = path.join(archiveRoot, slug);
	let n = 2;
	while (fs.existsSync(dest)) {
		dest = path.join(archiveRoot, slug + '-' + n);
		n++;
	}
	fs.renameSync(src, dest);
	return dest;
}
