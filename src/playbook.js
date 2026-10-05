import fs from 'node:fs';
import path from 'node:path';
import { LoadHouseConfig, PatchHouseConfig } from './house-config.js';
import { LociHome, RealPath } from './mcp-store.js';

export const PLAYBOOK_ENABLE_CAP = 64;
export const PLAYBOOK_HUGE_BYTES = 32 * 1024;
const MAX_BODY = 256 * 1024;

/**
 * @param {{ lociHome?: string }} [ctx]
 */
export function LociRoot(ctx) {
	const raw = ctx && ctx.lociHome ? String(ctx.lociHome).trim() : '';
	if (raw) return path.resolve(raw);
	return LociHome();
}

function IsInside(abs, root) {
	const rel = path.relative(path.resolve(root), path.resolve(abs));
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function ParseFrontmatter(text) {
	const src = String(text || '').replace(/\r\n/g, '\n');
	if (!src.startsWith('---\n')) return { meta: {}, body: src, hasFrontmatter: false };
	const rest = src.slice(4);
	const end = rest.indexOf('\n---');
	if (end < 0) return { meta: {}, body: src, hasFrontmatter: false };
	const raw = rest.slice(0, end);
	let body = rest.slice(end + 4);
	if (body.startsWith('\n')) body = body.slice(1);
	const meta = {};
	for (const line of raw.split('\n')) {
		const i = line.indexOf(':');
		if (i < 0) continue;
		const key = line.slice(0, i).trim().toLowerCase();
		let value = line.slice(i + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key) meta[key] = value;
	}
	return { meta, body, hasFrontmatter: true };
}

function FileTitle(filename) {
	const stem = String(filename || '').replace(/\.md$/i, '');
	const title = stem.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
	return title || stem;
}

function OneLine(raw, max) {
	return String(raw || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max || 240);
}

function YamlScalar(value) {
	const s = String(value || '');
	if (!s) return '""';
	if (/[:#\n"'&*!|>%@`]/.test(s) || /^\s|\s$/.test(s)) {
		return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
	}
	return s;
}

function SlugName(name) {
	const slug = String(name || '').trim().toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	if (!slug) throw new Error('Name is required');
	return slug;
}

function PlaybookMap(ctx) {
	if (!ctx || !ctx.housesRoot || !ctx.slug) return {};
	const cfg = LoadHouseConfig(ctx.housesRoot, ctx.slug);
	return cfg.playbook && typeof cfg.playbook === 'object' ? cfg.playbook : {};
}

function WritePlaybookMap(ctx, map) {
	if (!ctx || !ctx.housesRoot || !ctx.slug) throw new Error('House config is missing');
	PatchHouseConfig(ctx.housesRoot, ctx.slug, { playbook: map });
}

function Enabled(map, item) {
	if (Object.prototype.hasOwnProperty.call(map, item.path)) return map[item.path] === true;
	if (item.path.startsWith('loci-rules/')) {
		const legacy = 'global-rules/' + item.path.slice('loci-rules/'.length);
		if (Object.prototype.hasOwnProperty.call(map, legacy)) return map[legacy] === true;
	}
	return false;
}

function ReadText(abs) {
	let st;
	try {
		st = fs.lstatSync(abs);
	} catch {
		return null;
	}
	if (!st.isFile() || st.isSymbolicLink()) return null;
	let text = '';
	try {
		text = fs.readFileSync(abs, 'utf8');
	} catch {
		return null;
	}
	if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY);
	return text;
}

function EntryFromFile(abs, relFile) {
	let st;
	try {
		st = fs.lstatSync(abs);
	} catch {
		return null;
	}
	if (!st.isFile() || st.isSymbolicLink()) return null;
	const text = ReadText(abs);
	if (text == null) return null;
	const parsed = ParseFrontmatter(text);
	const fallback = relFile.endsWith('/SKILL.md')
		? path.posix.basename(path.posix.dirname(relFile))
		: relFile.replace(/\.md$/i, '');
	return {
		name: OneLine(parsed.meta.name, 80) || fallback,
		description: OneLine(parsed.meta.description, 240),
		body: parsed.body,
		text,
		size: st.size,
		mtime: st.mtimeMs,
		hasFrontmatter: parsed.hasFrontmatter === true
	};
}

function ListFlatRules(dir, scope, prefix) {
	if (!fs.existsSync(dir)) return [];
	const out = [];
	let names = [];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return [];
	}
	for (const name of names) {
		if (name.startsWith('.') || !name.toLowerCase().endsWith('.md')) continue;
		const abs = path.join(dir, name);
		const entry = EntryFromFile(abs, name);
		if (!entry) continue;
		out.push({
			kind: 'rule',
			scope,
			path: prefix + '/' + name,
			name: entry.hasFrontmatter ? entry.name : FileTitle(name),
			description: entry.description,
			body: entry.body,
			text: entry.text,
			size: entry.size,
			mtime: entry.mtime,
			abs
		});
	}
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

function ListSkills(dir, scope, prefix) {
	if (!fs.existsSync(dir)) return [];
	const out = [];
	let ents = [];
	try {
		ents = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	for (const ent of ents) {
		if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue;
		const abs = path.join(dir, ent.name);
		if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
			const entry = EntryFromFile(abs, ent.name);
			if (!entry) continue;
			out.push({
				kind: 'skill',
				scope,
				path: prefix + '/' + ent.name,
				name: entry.name,
				description: entry.description,
				body: entry.body,
				text: entry.text,
				size: entry.size,
				mtime: entry.mtime,
				abs
			});
			continue;
		}
		if (!ent.isDirectory()) continue;
		const skill = path.join(abs, 'SKILL.md');
		const entry = EntryFromFile(skill, ent.name + '/SKILL.md');
		if (!entry) continue;
		out.push({
			kind: 'skill',
			scope,
			path: prefix + '/' + ent.name + '/SKILL.md',
			name: entry.name,
			description: entry.description,
			body: entry.body,
			text: entry.text,
			size: entry.size,
			mtime: entry.mtime,
			abs: skill
		});
	}
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

const LIBRARY_TEMPLATE = path.join(import.meta.dirname, 'templates');
const LIBRARY_READ_MAX = 256 * 1024;

function SeedLibraryDir(dest, templateDir) {
	if (fs.existsSync(dest)) return;
	fs.mkdirSync(dest, { recursive: true });
	if (!fs.existsSync(templateDir)) return;
	for (const name of fs.readdirSync(templateDir)) {
		if (name.startsWith('.') || !name.toLowerCase().endsWith('.md')) continue;
		const from = path.join(templateDir, name);
		let st;
		try {
			st = fs.lstatSync(from);
		} catch {
			continue;
		}
		if (!st.isFile() || st.isSymbolicLink()) continue;
		fs.copyFileSync(from, path.join(dest, name));
	}
}

/**
 * Copy bundled rules and skills the first time each user-library folder is created.
 * A folder that already exists is left alone, including after the user deletes a file.
 * @param {object} [ctx]
 */
export function EnsureUserLibrary(ctx) {
	const loci = LociRoot(ctx);
	SeedLibraryDir(path.join(loci, 'rules'), path.join(LIBRARY_TEMPLATE, 'rules'));
	SeedLibraryDir(path.join(loci, 'skills'), path.join(LIBRARY_TEMPLATE, 'skills'));
}

function Scan(ctx) {
	EnsureUserLibrary(ctx);
	const house = ctx && ctx.houseDir ? path.resolve(ctx.houseDir) : '';
	const loci = LociRoot(ctx);
	const map = PlaybookMap(ctx);
	const rules = [
		...ListFlatRules(path.join(loci, 'rules'), 'global', 'loci-rules'),
		...(house ? ListFlatRules(path.join(house, 'rules'), 'house', 'rules') : [])
	];
	const skills = [
		...ListSkills(path.join(loci, 'skills'), 'global', 'loci-skills'),
		...(house ? ListSkills(path.join(house, 'skills'), 'house', 'skills') : [])
	];
	for (const item of [...rules, ...skills]) item.enabled = Enabled(map, item);
	return { rules, skills };
}

function Slim(item) {
	return {
		kind: item.kind,
		scope: item.scope,
		path: item.path,
		name: item.name,
		description: item.description,
		enabled: item.enabled
	};
}

/**
 * @param {object} ctx
 */
function FileStamp(scanned) {
	return [...scanned.rules, ...scanned.skills]
		.map((item) => item.path + '\0' + item.mtime + '\0' + item.size)
		.join('\n');
}

export function ListPlaybook(ctx) {
	const scanned = Scan(ctx);
	return {
		rules: scanned.rules.map(Slim),
		skills: scanned.skills.map(Slim),
		stamp: FileStamp(scanned)
	};
}

function FindItem(ctx, toolPath) {
	const key = String(toolPath || '').trim();
	const scanned = Scan(ctx);
	return [...scanned.rules, ...scanned.skills].find((item) => item.path === key) || null;
}

/**
 * @param {object} ctx
 * @param {string} toolPath
 * @param {boolean} enabled
 */
export function SetPlaybookEnabled(ctx, toolPath, enabled) {
	const item = FindItem(ctx, toolPath);
	if (!item) throw new Error('That rule or skill is not in the book.');
	const turningOn = !!enabled;
	if (turningOn) {
		const list = item.kind === 'rule' ? Scan(ctx).rules : Scan(ctx).skills;
		const already = list.filter((row) => row.enabled && row.path !== item.path).length;
		if (already >= PLAYBOOK_ENABLE_CAP) {
			const label = item.kind === 'rule' ? 'rules' : 'skills';
			throw new Error('At most ' + PLAYBOOK_ENABLE_CAP + ' ' + label + ' can be enabled.');
		}
	}
	const map = { ...PlaybookMap(ctx) };
	map[item.path] = turningOn;
	if (item.path.startsWith('loci-rules/')) delete map['global-rules/' + item.path.slice('loci-rules/'.length)];
	WritePlaybookMap(ctx, map);
	const out = { ...Slim(item), enabled: turningOn };
	if (turningOn && item.size > PLAYBOOK_HUGE_BYTES) {
		const kb = Math.max(1, Math.round(item.size / 1024));
		out.warning = item.name + ' is ' + kb + ' KB. That is a lot to keep in context.';
	}
	return out;
}

function ComposeFile(name, description, body) {
	const text = String(body || '').replace(/\r\n/g, '\n').trim();
	if (Buffer.byteLength(text, 'utf8') > MAX_BODY) throw new Error('Body is too long.');
	return '---\nname: ' + YamlScalar(OneLine(name, 80)) +
		'\ndescription: ' + YamlScalar(OneLine(description, 240)) +
		'\n---\n\n' + text + (text ? '\n' : '');
}

/**
 * @param {object} ctx
 * @param {{ kind?: string, scope?: string, name?: string, description?: string, body?: string }} input
 */
export function AddPlaybookItem(ctx, input) {
	const src = input || {};
	const kind = src.kind === 'skill' ? 'skill' : 'rule';
	const scope = src.scope === 'global' ? 'global' : 'house';
	const name = OneLine(src.name, 80);
	const slug = SlugName(name);
	const file = slug + '.md';
	const house = ctx && ctx.houseDir ? path.resolve(ctx.houseDir) : '';
	if (scope === 'house' && !house) throw new Error('House directory is missing');
	EnsureUserLibrary(ctx);
	const root = scope === 'global'
		? path.join(LociRoot(ctx), kind === 'rule' ? 'rules' : 'skills')
		: path.join(house, kind === 'rule' ? 'rules' : 'skills');
	const abs = path.join(root, file);
	if (fs.existsSync(abs)) throw new Error('A ' + kind + ' with that name already exists.');
	const prefix = kind === 'rule'
		? (scope === 'global' ? 'loci-rules' : 'rules')
		: (scope === 'global' ? 'loci-skills' : 'skills');
	fs.mkdirSync(root, { recursive: true });
	fs.writeFileSync(abs, ComposeFile(name, src.description, src.body), 'utf8');
	const map = { ...PlaybookMap(ctx) };
	map[prefix + '/' + file] = true;
	WritePlaybookMap(ctx, map);
	const item = FindItem(ctx, prefix + '/' + file);
	if (!item) throw new Error('Could not read the new file.');
	return Slim(item);
}

/**
 * @param {object} ctx
 * @param {string} toolPath
 */
export function RemovePlaybookItem(ctx, toolPath) {
	const item = FindItem(ctx, toolPath);
	if (!item) throw new Error('That rule or skill is not in the book.');
	const parts = item.path.split('/').slice(1);
	const store = item.scope === 'global'
		? path.join(LociRoot(ctx), item.kind === 'rule' ? 'rules' : 'skills')
		: path.join(path.resolve(ctx.houseDir), item.kind === 'rule' ? 'rules' : 'skills');
	const realStore = RealPath(store);
	const realAbs = RealPath(item.abs);
	if (!IsInside(realAbs, realStore) || realAbs === realStore) {
		throw new Error('Refusing to delete outside the library.');
	}
	if (item.kind === 'skill' && parts.length === 2 && parts[1] === 'SKILL.md') {
		const dir = path.dirname(realAbs);
		if (!IsInside(dir, realStore) || dir === realStore) {
			throw new Error('Refusing to delete outside the library.');
		}
		fs.rmSync(dir, { recursive: true });
	} else {
		fs.unlinkSync(realAbs);
	}
	const map = { ...PlaybookMap(ctx) };
	delete map[item.path];
	WritePlaybookMap(ctx, map);
	return Slim(item);
}

/**
 * @param {object} ctx
 * @param {string} toolPath
 */
export function ReadPlaybookFile(ctx, toolPath) {
	const item = FindItem(ctx, toolPath);
	if (!item) throw new Error('That rule or skill is not in the book.');
	let st;
	try {
		st = fs.statSync(item.abs);
	} catch {
		throw new Error('That file was not found.');
	}
	if (!st.isFile()) throw new Error('That file was not found.');
	if (st.size > LIBRARY_READ_MAX) throw new Error('That file is too large to open here.');
	return { file: item.path, text: fs.readFileSync(item.abs, 'utf8') };
}

/**
 * @param {object} ctx
 * @param {string} toolPath
 */
export function RevealPlaybookPath(ctx, toolPath) {
	const item = FindItem(ctx, toolPath);
	if (!item) throw new Error('That rule or skill is not in the book.');
	return item.abs;
}

function CatalogLine(item) {
	const desc = item.description ? ': ' + item.description : '';
	return '- **' + item.name + '** (`' + item.path + '`)' + desc;
}

/**
 * Standing rules (body only, no frontmatter) and the skills catalog.
 * @param {object} ctx
 */
export function PromptPlaybook(ctx) {
	const scanned = Scan(ctx);
	const rules = scanned.rules.filter((item) => item.enabled);
	const skills = scanned.skills.filter((item) => item.enabled);
	const chunks = [];
	if (rules.length) {
		const blocks = [];
		for (const rule of rules) {
			const body = String(rule.body || '').trim();
			if (body) blocks.push({ rule, body });
		}
		if (blocks.length) {
			const lines = ['# Rules', ''];
			for (const block of blocks) lines.push(CatalogLine(block.rule));
			for (const block of blocks) lines.push('', '---', '', block.body);
			chunks.push(lines.join('\n').trimEnd());
		}
	}
	if (skills.length) {
		const lines = [
			'# Skills',
			'',
			'Use a skill when needed by reading its file with `read_file` (loaded on demand). Folder skills may reference related files beside `SKILL.md` — read those the same way. House files are `rules/…` and `skills/…`. Shared files are `loci-rules/…` and `loci-skills/…`.',
			''
		];
		for (const skill of skills) lines.push(CatalogLine(skill));
		chunks.push(lines.join('\n'));
	}
	return chunks.join('\n\n');
}
