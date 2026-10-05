import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOUSE_DIRS } from './house.js';
import { AgpiSpecs, CallAgpi, IsAgpiTool } from './agpi.js';
import { SetFocusFromHousePath } from './world.js';
import { MarkInboxRead } from './mail.js';
import { IsDatedCalendarRel, TrimCalendarFiles } from './events.js';
import { SyncBookFile, TouchBookAccess } from './books.js';
import { ChatHistory } from './compact.js';
import { LoadSession } from './session.js';
import { CallMcpTool } from './mcp-client.js';
import { RealPath } from './mcp-store.js';
import { LociRoot } from './playbook.js';

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_SEARCH = 200;
const MAX_GREP_FILE = 1024 * 1024;
// Per stream. Errors usually come last, so most of the budget keeps the end. Both
// streams together stay under the default max_tool_result (80 KiB).
const CMD_OUTPUT_HEAD = 8 * 1024;
const CMD_OUTPUT_TAIL = 24 * 1024;
// Seconds, used when the runtime config does not set command_timeout / command_timeout_max.
const DEFAULT_CMD_TIMEOUT_SEC = 600;
const MAX_CMD_TIMEOUT_SEC = 1800;
const CMD_PIPE_GRACE_MS = 1000;

const JUNK_DIRS = new Set([
	'node_modules', '.git', '.svn', '.hg', '__pycache__',
	'.venv', 'venv', 'dist', 'build', 'target', '.mypy_cache'
]);

const LOCKED_ROOT = new Set([
	'BOOT.md', 'SYSTEM.md', 'LOGOFF.md', 'ALARMS', 'EVENTS',
	'house.json', 'session.jsonl', 'index.db', 'world.json'
]);

const UNREADABLE_ROOT = new Set(['house.json', 'session.jsonl', 'index.db', 'world.json']);

const WRITABLE_ROOT = new Set(['NOTES.md', 'SOUL.md', 'USER.md']);
const READ_ONLY_DIRS = new Set(['mail', 'archive']);
const NO_CREATE_DIRS = new Set(['plans', 'notes', 'tasks', 'library', 'cabinet', 'contacts']);
const CREATE_DIRS = new Set(['diary', 'calendar', 'artifacts']);

const HOUSE_TOP = new Set([
	...HOUSE_DIRS,
	...LOCKED_ROOT,
	...WRITABLE_ROOT
]);

const BINARY_EXT = new Set([
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
	'.zip', '.gz', '.bz2', '.xz', '.7z', '.wasm', '.exe', '.dll', '.so',
	'.dylib', '.bin', '.dat', '.mp3', '.mp4', '.woff', '.woff2', '.ttf',
	'.class', '.jar', '.pyc', '.db'
]);

const CREATE_HINTS = {
	plans: 'Create plans with send_action action "create_plan" target "whiteboard".',
	notes: 'Create sticky notes with send_action action "create_note" target "whiteboard".',
	tasks: 'Create task notes with the Task Board.',
	library: 'Create books with send_action action "create_book" target "book_shelf".',
	cabinet: 'File completed tasks with send_action action "file" target "cabinet".',
	contacts: 'Create contacts with send_action action "create_contact" target "address_book".'
};

function ToolError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

function PosixRel(from, to) {
	return path.relative(from, to).split(path.sep).join('/');
}

function IsInside(abs, root) {
	const a = path.resolve(abs);
	const r = path.resolve(root);
	const rel = path.relative(r, a);
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function WorkspaceRoots(ctx) {
	const house = RealPath(ctx.houseDir);
	const list = Array.isArray(ctx.workspaces) ? ctx.workspaces : [];
	const out = [];
	for (const item of list) {
		const ws = RealPath(String(item || '').trim());
		if (!ws) continue;
		if (IsInside(ws, house) || IsInside(house, ws)) continue;
		out.push(ws);
	}
	return out;
}

function IsHouseRel(rel) {
	const top = String(rel || '').split('/').filter(Boolean)[0];
	return HOUSE_TOP.has(top);
}

/**
 * Resolve a tool path to an absolute file under the house or a workspace.
 * @param {{ houseDir: string, workspaces?: string[] }} ctx
 * @param {string} rawPath
 */
export function ResolvePath(ctx, rawPath) {
	const raw = String(rawPath || '').trim();
	if (!raw) throw ToolError('Path is required');
	if (raw.includes('\0')) throw ToolError('Invalid path');

	const houseRoot = path.resolve(ctx.houseDir);
	const workspaces = WorkspaceRoots(ctx);

	if (path.isAbsolute(raw)) {
		const abs = path.resolve(raw);
		if (IsInside(abs, houseRoot)) {
			return { abs, root: houseRoot, kind: 'house', rel: PosixRel(houseRoot, abs) };
		}
		for (const ws of workspaces) {
			if (IsInside(abs, ws)) {
				return { abs, root: ws, kind: 'workspace', rel: PosixRel(ws, abs) };
			}
		}
		throw ToolError('Path is outside the house and its workspaces');
	}

	const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '');
	if (!rel || rel === '..' || rel.startsWith('../') || rel.split('/').includes('..')) {
		throw ToolError('Path must stay inside the house or a workspace');
	}

	const library = LociLibraryPrefix(rel);
	if (library) return ResolveLociLibrary(ctx, rel, library);

	if (IsHouseRel(rel)) {
		const abs = path.resolve(houseRoot, rel);
		if (!IsInside(abs, houseRoot)) throw ToolError('Path must stay inside the house');
		return { abs, root: houseRoot, kind: 'house', rel: PosixRel(houseRoot, abs) };
	}

	const hits = [];
	for (const ws of workspaces) {
		const abs = path.resolve(ws, rel);
		if (!IsInside(abs, ws)) continue;
		hits.push({ abs, root: ws, kind: 'workspace', rel: PosixRel(ws, abs) });
	}
	if (hits.length === 1) return hits[0];
	if (hits.length > 1) {
		const existing = hits.filter((h) => fs.existsSync(h.abs));
		if (existing.length === 1) return existing[0];
		throw ToolError('Path is ambiguous across workspaces; use an absolute path');
	}
	if (!workspaces.length) {
		throw ToolError('That path is not in the house. Add a workspace folder to edit project files.');
	}
	throw ToolError('Could not resolve path');
}

function HouseWriteError(rel, creating) {
	const parts = String(rel || '').split('/').filter(Boolean);
	const top = parts[0];
	if (!top) return 'Cannot write that house path.';
	if (LOCKED_ROOT.has(top) && parts.length === 1) {
		if (top === 'LOGOFF.md') {
			return 'LOGOFF.md is read-only for file tools. Write notes with send_action action "logoff" target "pc". The user edits the ritual from Manage House.';
		}
		if (top === 'ALARMS') {
			return 'ALARMS is read-only for file tools. Change the schedule with send_action action "set_alarm" or "stop_alarm" target "alarm_clock". The user edits the file from Manage House.';
		}
		if (top === 'EVENTS') {
			return 'EVENTS is read-only for file tools. Change one-shot wakes with send_action action "set_event" or "stop_event" target "calendar". The user edits them from the calendar.';
		}
		return 'File is read-only for tools. The user edits this from Manage House.';
	}
	if (top === 'stories') {
		if (parts.length < 2) return 'Write a markdown file under stories/<campaign>/, not the folder itself.';
		if (parts.some((part) => part.startsWith('.'))) return 'Cannot write that house path.';
		const leaf = parts[parts.length - 1];
		if (!leaf.toLowerCase().endsWith('.md')) return 'stories/ only holds markdown files (.md).';
		return '';
	}
	if (READ_ONLY_DIRS.has(top)) {
		if (top === 'archive') return 'archive/ is read-only. Dropped tasks land here; trash on the Task Board deletes a note for good.';
		return 'mail/ is read-only. Send mail from the PC Mail app.';
	}
	if (top === 'rules') {
		if (parts.length === 2 && parts[1].toLowerCase().endsWith('.md') && !parts[1].startsWith('.')) return '';
		return 'A rule is a single rules/<name>.md file.';
	}
	if (top === 'skills') {
		if (parts.some((part) => part.startsWith('.'))) return 'Cannot write that house path.';
		if (parts.length === 2 && parts[1].toLowerCase().endsWith('.md')) return '';
		if (parts.length === 3 && parts[1] && parts[2]) return '';
		return 'A skill is skills/<name>.md or skills/<name>/SKILL.md (and files beside it).';
	}
	if (NO_CREATE_DIRS.has(top)) {
		if (creating) {
			return 'Cannot create files in ' + top + '/. ' + (CREATE_HINTS[top] || '') +
				' You may edit an existing file.';
		}
		return '';
	}
	if (CREATE_DIRS.has(top)) return '';
	if (parts.length === 1 && WRITABLE_ROOT.has(top)) return '';
	return 'Cannot write that house path.';
}

function HouseReadError(rel) {
	const parts = String(rel || '').split('/').filter(Boolean);
	const top = parts[0];
	// Case-insensitive: on macOS and Windows "House.json" opens house.json.
	if (top && parts.length === 1 && UNREADABLE_ROOT.has(top.toLowerCase())) {
		return top + ' is not readable by tools.';
	}
	return '';
}

function AssertCanRead(target) {
	if (target.kind !== 'house') return;
	const msg = HouseReadError(target.rel);
	if (msg) throw ToolError(msg);
}

function IsUnreadableHouseFile(ctx, abs) {
	const house = path.resolve(ctx.houseDir);
	if (!IsInside(abs, house)) return false;
	return Boolean(HouseReadError(PosixRel(house, abs)));
}

function AssertCanWrite(target, creating) {
	if (target.kind === 'loci-library') {
		throw ToolError('Shared rules and skills are read-only. Create and edit them in this house under rules/ or skills/.');
	}
	if (target.kind !== 'house') return;
	const msg = HouseWriteError(target.rel, creating);
	if (msg) throw ToolError(msg.trim());
}

function ReadTextFile(abs) {
	let st;
	try {
		st = fs.lstatSync(abs);
	} catch {
		throw ToolError('File not found: ' + abs);
	}
	if (st.isSymbolicLink()) throw ToolError('Refusing to read a symlink');
	if (st.isDirectory()) throw ToolError('Path is a directory; use search_files with mode glob');
	if (!st.isFile()) throw ToolError('Not a regular file');
	if (st.size > MAX_READ_BYTES * 4) throw ToolError('File is too large to read');
	const ext = path.extname(abs).toLowerCase();
	if (BINARY_EXT.has(ext)) throw ToolError('Refusing to read a binary file');
	const buf = fs.readFileSync(abs);
	if (buf.includes(0)) throw ToolError('Refusing to read a binary file');
	return buf.toString('utf8');
}

function NumberedSlice(text, offset, limit) {
	const lines = String(text).split('\n');
	if (lines.length && lines[lines.length - 1] === '') lines.pop();
	const total = lines.length;
	let start;
	let end;
	if (limit != null && Number(limit) < 0) {
		const n = Math.abs(Math.floor(Number(limit)));
		start = Math.max(1, total - n + 1);
		end = total;
	} else {
		start = Math.max(1, Math.floor(Number(offset) || 1));
		const cap = limit == null || limit === '' ? total : Math.max(0, Math.floor(Number(limit)));
		end = Math.min(total, start + cap - (cap === 0 ? 0 : 1));
		if (cap === 0) end = start - 1;
	}
	const slice = [];
	for (let n = start; n <= end; n++) {
		slice.push(String(n).padStart(6, ' ') + '|' + (lines[n - 1] ?? ''));
	}
	let body = slice.join('\n');
	let truncated = false;
	if (Buffer.byteLength(body, 'utf8') > MAX_READ_BYTES) {
		body = body.slice(0, MAX_READ_BYTES);
		truncated = true;
	}
	return {
		text: body,
		start_line: start,
		end_line: end,
		total_lines: total,
		has_more: end < total,
		truncated
	};
}

function NoteHouseFocus(ctx, target) {
	if (!ctx || !ctx.houseDir || !target || target.kind !== 'house') return;
	SetFocusFromHousePath(ctx.houseDir, target.rel);
}

function ReadFile(ctx, args) {
	const target = ResolvePath(ctx, args.path);
	AssertCanRead(target);
	const slice = NumberedSlice(ReadTextFile(target.abs), args.offset, args.limit);
	NoteHouseFocus(ctx, target);
	const extra = {};
	if (target.kind === 'house') {
		const moved = MarkInboxRead(ctx.houseDir, target.rel);
		if (moved) {
			extra.moved = true;
			extra.previous_path = moved.from;
			extra.note = 'Moved to ' + moved.to + ' (marked read).';
			return { path: moved.to, root: target.kind, ...slice, ...extra };
		}
		TouchBookAccess(ctx.houseDir, target.rel);
	}
	return { path: target.rel, root: target.kind, ...slice };
}

function WriteFile(ctx, args) {
	const target = ResolvePath(ctx, args.path);
	const mode = String(args.mode || 'replace').trim() || 'replace';
	if (mode !== 'replace' && mode !== 'append') {
		throw ToolError('mode must be replace or append');
	}
	let text = args.text == null ? '' : String(args.text);
	if (args.newline !== false && text.length && !text.endsWith('\n')) text += '\n';
	if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) {
		throw ToolError('Write is too large');
	}
	const exists = fs.existsSync(target.abs);
	if (mode === 'append' && !exists) {
		throw ToolError('append requires an existing file');
	}
	AssertCanWrite(target, !exists);
	if (exists) {
		const st = fs.lstatSync(target.abs);
		if (st.isSymbolicLink()) throw ToolError('Refusing to write a symlink');
		if (st.isDirectory()) throw ToolError('Path is a directory');
	} else if (target.kind === 'workspace') {
		fs.mkdirSync(path.dirname(target.abs), { recursive: true });
	} else {
		const parent = path.dirname(target.abs);
		if (!fs.existsSync(parent)) {
			fs.mkdirSync(parent, { recursive: true });
		}
	}
	if (mode === 'append') fs.appendFileSync(target.abs, text, 'utf8');
	else fs.writeFileSync(target.abs, text, 'utf8');
	if (target.kind === 'house' && IsDatedCalendarRel(target.rel)) TrimCalendarFiles(ctx.houseDir);
	if (target.kind === 'house') SyncBookFile(ctx.houseDir, target.rel);
	NoteHouseFocus(ctx, target);
	return { path: target.rel, root: target.kind, bytes: Buffer.byteLength(text, 'utf8'), mode };
}

function EditFile(ctx, args) {
	const target = ResolvePath(ctx, args.path);
	if (!fs.existsSync(target.abs)) throw ToolError('File not found');
	AssertCanWrite(target, false);
	const old = String(args.old_string ?? '');
	const next = String(args.new_string ?? '');
	if (!old) throw ToolError('old_string is required');
	if (old === next) throw ToolError('old_string and new_string are the same');
	const text = ReadTextFile(target.abs);
	const parts = text.split(old);
	if (parts.length === 1) throw ToolError('old_string was not found');
	if (parts.length > 2) throw ToolError('old_string matched more than once; make it unique');
	const out = parts.join(next);
	fs.writeFileSync(target.abs, out, 'utf8');
	if (target.kind === 'house' && IsDatedCalendarRel(target.rel)) TrimCalendarFiles(ctx.houseDir);
	if (target.kind === 'house') SyncBookFile(ctx.houseDir, target.rel);
	NoteHouseFocus(ctx, target);
	return { path: target.rel, root: target.kind, replaced: 1 };
}

function GlobToRegExp(pattern) {
	const src = String(pattern || '').replace(/\\/g, '/');
	if (!src) throw ToolError('pattern is required');
	return new RegExp('^' + GlobSource(src) + '$');
}

/** Index of the "}" that closes the "{" at `open`, or -1. */
function ClosingBrace(src, open) {
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		if (src[i] === '{') depth += 1;
		else if (src[i] === '}' && --depth === 0) return i;
	}
	return -1;
}

/** Split a brace body on its top-level commas: "a,{b,c}" is ["a", "{b,c}"]. */
function BraceAlternatives(body) {
	const out = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < body.length; i++) {
		if (body[i] === '{') depth += 1;
		else if (body[i] === '}') depth -= 1;
		else if (body[i] === ',' && depth === 0) {
			out.push(body.slice(from, i));
			from = i + 1;
		}
	}
	out.push(body.slice(from));
	return out;
}

/** Glob to regex source: **, *, ?, and {a,b} alternatives (nestable). Everything else is literal. */
function GlobSource(src) {
	let i = 0;
	let out = '';
	while (i < src.length) {
		if (src.startsWith('**/', i)) {
			out += '(?:.*/)?';
			i += 3;
			continue;
		}
		if (src[i] === '*' && src[i + 1] === '*') {
			out += '.*';
			i += 2;
			continue;
		}
		if (src[i] === '*') {
			out += '[^/]*';
			i += 1;
			continue;
		}
		if (src[i] === '?') {
			out += '[^/]';
			i += 1;
			continue;
		}
		if (src[i] === '{') {
			const close = ClosingBrace(src, i);
			const alts = close > 0 ? BraceAlternatives(src.slice(i + 1, close)) : [];
			// Like the shell, "{a}" and an unclosed "{" stay literal.
			if (alts.length > 1) {
				out += '(?:' + alts.map(GlobSource).join('|') + ')';
				i = close + 1;
				continue;
			}
		}
		if ('\\^$+{}[]().|'.includes(src[i])) out += '\\';
		out += src[i];
		i += 1;
	}
	return out;
}

function WalkFiles(root, visit, skipDir) {
	const stack = [root];
	while (stack.length) {
		const dir = stack.pop();
		let ents;
		try {
			ents = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const ent of ents) {
			if (ent.name === '.' || ent.name === '..') continue;
			if (ent.isSymbolicLink()) continue;
			const abs = path.join(dir, ent.name);
			if (ent.isDirectory()) {
				if (ent.name.startsWith('.') || JUNK_DIRS.has(ent.name)) continue;
				if (skipDir && skipDir(abs)) continue;
				stack.push(abs);
			} else if (ent.isFile()) {
				if (visit(abs) === false) return;
			}
		}
	}
}

function SkipHouseArchive(ctx, searchRoot) {
	const house = path.resolve(ctx.houseDir);
	const archiveRoot = path.join(house, 'archive');
	const root = path.resolve(searchRoot);
	if (root === archiveRoot || IsInside(root, archiveRoot)) return null;
	return (abs) => abs === archiveRoot;
}

function SearchRoots(ctx, rawPath) {
	if (rawPath == null || String(rawPath).trim() === '' || String(rawPath).trim() === '.') {
		return [{ root: path.resolve(ctx.houseDir), kind: 'house' }];
	}
	const target = ResolvePath(ctx, rawPath);
	let st;
	try {
		st = fs.lstatSync(target.abs);
	} catch {
		throw ToolError('Search path not found');
	}
	if (st.isSymbolicLink()) throw ToolError('Refusing to search a symlink');
	if (target.kind === 'loci-library') {
		const file = st.isFile();
		if (!file && !st.isDirectory()) throw ToolError('Search path is not a file or directory');
		return [{
			root: target.abs,
			kind: 'loci-library',
			file,
			relRoot: target.root,
			prefix: target.prefix
		}];
	}
	if (st.isFile()) return [{ root: target.abs, kind: target.kind, file: true, relRoot: target.root }];
	if (!st.isDirectory()) throw ToolError('Search path is not a file or directory');
	return [{ root: target.abs, kind: target.kind, relRoot: target.root }];
}

const LOCI_LIBRARIES = {
	'loci-rules': 'rules',
	'loci-skills': 'skills'
};

function LociLibraryPrefix(rel) {
	for (const prefix of Object.keys(LOCI_LIBRARIES)) {
		if (rel === prefix || rel.startsWith(prefix + '/')) return prefix;
	}
	return '';
}

function ResolveLociLibrary(ctx, rel, prefix) {
	const inner = rel === prefix ? '' : rel.slice(prefix.length + 1);
	const parts = inner ? inner.split('/') : [];
	if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
		throw ToolError('Path must stay inside ' + prefix);
	}
	const libRoot = path.join(LociRoot(ctx), LOCI_LIBRARIES[prefix]);
	const abs = path.resolve(libRoot, ...parts);
	const realRoot = RealPath(libRoot);
	const realAbs = RealPath(abs);
	if (!IsInside(realAbs, realRoot)) throw ToolError('Path must stay inside ' + prefix);
	const shown = parts.length ? prefix + '/' + parts.join('/') : prefix;
	return { abs: realAbs, root: realRoot, kind: 'loci-library', prefix, rel: shown };
}

function RelFor(abs, search, ctx) {
	if (search.prefix) {
		const inner = PosixRel(search.relRoot, abs);
		return inner ? search.prefix + '/' + inner : search.prefix;
	}
	if (search.file) return PosixRel(search.relRoot, abs);
	if (search.relRoot) return PosixRel(search.relRoot, abs);
	const house = path.resolve(ctx.houseDir);
	if (IsInside(abs, house)) return PosixRel(house, abs);
	for (const ws of WorkspaceRoots(ctx)) {
		if (IsInside(abs, ws)) return PosixRel(ws, abs);
	}
	return abs;
}

function IsProbablyBinary(abs) {
	if (BINARY_EXT.has(path.extname(abs).toLowerCase())) return true;
	try {
		const fd = fs.openSync(abs, 'r');
		const buf = Buffer.alloc(8000);
		const n = fs.readSync(fd, buf, 0, 8000, 0);
		fs.closeSync(fd);
		return buf.subarray(0, n).includes(0);
	} catch {
		return true;
	}
}

function SearchFiles(ctx, args) {
	const mode = String(args.mode || '').trim();
	if (mode !== 'glob' && mode !== 'grep') {
		throw ToolError('mode must be glob or grep');
	}
	const pattern = String(args.pattern || '');
	if (!pattern) throw ToolError('pattern is required');
	const cap = Math.min(MAX_SEARCH, Math.max(1, Math.floor(Number(args.max_results) || MAX_SEARCH)));
	const roots = SearchRoots(ctx, args.path);
	for (const search of roots) {
		if (search.file && IsUnreadableHouseFile(ctx, search.root)) {
			throw ToolError(path.basename(search.root) + ' is not readable by tools.');
		}
	}
	const matches = [];

	if (mode === 'glob') {
		const re = GlobToRegExp(pattern);
		for (const search of roots) {
			if (matches.length >= cap) break;
			const visit = (abs) => {
				if (IsUnreadableHouseFile(ctx, abs)) return;
				const rel = RelFor(abs, search, ctx);
				const matchRel = search.file ? path.basename(abs) : PosixRel(search.root, abs);
				if (!re.test(matchRel)) return;
				matches.push({ path: rel, root: search.kind });
				if (matches.length >= cap) return false;
			};
			if (search.file) visit(search.root);
			else WalkFiles(search.root, visit, SkipHouseArchive(ctx, search.root));
		}
		return { mode, matches, truncated: matches.length >= cap };
	}

	let re;
	try {
		re = new RegExp(pattern, args.case_insensitive ? 'i' : '');
	} catch (err) {
		throw ToolError('Invalid regex: ' + (err && err.message ? err.message : err));
	}
	for (const search of roots) {
		if (matches.length >= cap) break;
		const visit = (abs) => {
			if (IsUnreadableHouseFile(ctx, abs)) return;
			if (IsProbablyBinary(abs)) return;
			let st;
			try {
				st = fs.lstatSync(abs);
			} catch {
				return;
			}
			if (st.size > MAX_GREP_FILE) return;
			let text;
			try {
				text = fs.readFileSync(abs, 'utf8');
			} catch {
				return;
			}
			const lines = text.split('\n');
			const rel = RelFor(abs, search, ctx);
			for (let i = 0; i < lines.length; i++) {
				re.lastIndex = 0;
				if (!re.test(lines[i])) continue;
				matches.push({ path: rel, root: search.kind, line: i + 1, text: lines[i].slice(0, 500) });
				if (matches.length >= cap) return false;
			}
		};
		if (search.file) visit(search.root);
		else WalkFiles(search.root, visit, SkipHouseArchive(ctx, search.root));
	}
	return { mode, matches, truncated: matches.length >= cap };
}

function ReadChatHistory(ctx, args) {
	return ChatHistory(LoadSession(ctx.houseDir), args || {});
}

/** Default and ceiling for run_command, in seconds, from the house runtime config. */
function CommandTimeouts(ctx) {
	const max = Number(ctx && ctx.command_timeout_max) > 0 ? Math.floor(ctx.command_timeout_max) : MAX_CMD_TIMEOUT_SEC;
	const def = Number(ctx && ctx.command_timeout) > 0 ? Math.floor(ctx.command_timeout) : DEFAULT_CMD_TIMEOUT_SEC;
	return { def: Math.min(def, max), max };
}

function FormatSeconds(sec) {
	if (sec % 3600 === 0) return (sec / 3600) + ' h';
	if (sec % 60 === 0) return (sec / 60) + ' min';
	return sec + ' s';
}

function RunCommand(ctx, args) {
	if (!ctx.run_command) {
		throw ToolError('run_command is off for this house.');
	}
	const workspaces = WorkspaceRoots(ctx);
	if (!workspaces.length) {
		throw ToolError('run_command needs a workspace folder.');
	}
	const command = String(args.command || '').trim();
	if (!command) throw ToolError('command is required');
	let cwd;
	if (args.cwd == null || String(args.cwd).trim() === '') {
		cwd = workspaces[0];
	} else if (path.isAbsolute(String(args.cwd))) {
		cwd = path.resolve(args.cwd);
	} else {
		cwd = path.resolve(workspaces[0], String(args.cwd));
	}
	if (!workspaces.some((ws) => IsInside(cwd, ws))) {
		throw ToolError('cwd must be inside a workspace folder, not the house palace.');
	}
	if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
		throw ToolError('cwd is not a directory');
	}
	const limits = CommandTimeouts(ctx);
	let timeout = Number(args.timeout_ms);
	if (!Number.isFinite(timeout) || timeout <= 0) timeout = limits.def * 1000;
	timeout = Math.min(limits.max * 1000, Math.floor(timeout));
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;

	return RunShell(command, { cwd, env, timeout, signal: ctx.signal });
}

/** Keeps the first CMD_OUTPUT_HEAD and last CMD_OUTPUT_TAIL characters of a stream. */
function OutputCollector() {
	let head = '';
	let tail = '';
	let dropped = 0;
	return {
		Add(chunk) {
			let text = String(chunk);
			if (head.length < CMD_OUTPUT_HEAD) {
				const room = CMD_OUTPUT_HEAD - head.length;
				head += text.slice(0, room);
				text = text.slice(room);
			}
			if (!text) return;
			tail += text;
			if (tail.length > CMD_OUTPUT_TAIL) {
				dropped += tail.length - CMD_OUTPUT_TAIL;
				tail = tail.slice(-CMD_OUTPUT_TAIL);
			}
		},
		Cut: () => dropped,
		Text: () => dropped ? head + '\n…[' + dropped + ' characters cut]…\n' + tail : head + tail
	};
}

/**
 * Run a shell command and collect capped output. A timeout or Stop (signal) kills the
 * whole process tree, not just the shell. A background job that keeps the output pipes
 * open does not hold the tool once the shell has exited.
 */
function RunShell(command, opts) {
	const { cwd, env, timeout, signal } = opts;
	const windows = process.platform === 'win32';
	return new Promise((resolve, reject) => {
		// detached puts the shell in its own process group so the group can be killed.
		const child = spawn(command, { cwd, shell: true, env, detached: !windows, windowsHide: true });
		const stdout = OutputCollector();
		const stderr = OutputCollector();
		let ended = '';
		let settled = false;
		let graceTimer = null;
		const KillTree = (why) => {
			if (ended || child.exitCode !== null || child.signalCode !== null) return;
			ended = why;
			try {
				if (windows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
				else process.kill(-child.pid, 'SIGKILL');
			} catch {
				child.kill('SIGKILL');
			}
		};
		const onAbort = () => KillTree('stopped');
		const timer = setTimeout(() => KillTree('timeout'), timeout);
		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener('abort', onAbort, { once: true });
		}
		const Finish = (code, sig) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(graceTimer);
			if (signal) signal.removeEventListener('abort', onAbort);
			const out = {
				cwd,
				exit_code: code,
				signal: sig || '',
				stdout: stdout.Text(),
				stderr: stderr.Text(),
				truncated: stdout.Cut() > 0 || stderr.Cut() > 0
			};
			if (ended === 'timeout') out.timed_out = true;
			if (ended === 'stopped') out.stopped = true;
			resolve(out);
		};
		// setEncoding decodes across chunk edges, so a character split between reads survives.
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', stdout.Add);
		child.stderr.on('data', stderr.Add);
		child.on('error', (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (signal) signal.removeEventListener('abort', onAbort);
			reject(ToolError(err.message || String(err)));
		});
		child.on('close', Finish);
		child.on('exit', (code, sig) => {
			// 'close' waits for the pipes. Give it a moment, then stop waiting on any
			// background process that inherited them.
			graceTimer = setTimeout(() => {
				child.stdout.destroy();
				child.stderr.destroy();
				Finish(code, sig);
			}, CMD_PIPE_GRACE_MS);
		});
	});
}

const HANDLERS = {
	read_file: ReadFile,
	write_file: WriteFile,
	edit_file: EditFile,
	search_files: SearchFiles,
	chat_history: ReadChatHistory,
	run_command: RunCommand
};

/**
 * OpenAI-style tool definitions for the agent loop.
 * @param {{ run_command?: boolean }} [ctx]
 */
export function ToolSpecs(ctx) {
	const specs = [
		{
			type: 'function',
			function: {
				name: 'read_file',
				description: 'Read a text file in the house or a workspace. Optional 1-based offset and limit (negative limit = tail). Reading mail/inbox/ moves that letter to mail/read/.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'House-relative, workspace-relative, or absolute path inside those roots' },
						offset: { type: 'integer', description: 'First line (1-based, default 1)' },
						limit: { type: 'integer', description: 'Max lines from offset; negative = last N lines' }
					},
					required: ['path']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'write_file',
				description: 'Write a text file. Creates a new file if it does not exist. Workspaces allow create. mode=append requires an existing file.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string' },
						text: { type: 'string' },
						mode: { type: 'string', enum: ['replace', 'append'] },
						newline: { type: 'boolean', description: 'Ensure a trailing newline (default true)' }
					},
					required: ['path', 'text']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'edit_file',
				description: 'Replace old_string with new_string in an existing file. Will return an error if old_string occurs more than once.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string' },
						old_string: { type: 'string' },
						new_string: { type: 'string' }
					},
					required: ['path', 'old_string', 'new_string']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'search_files',
				description: 'Find files (glob) or search contents (grep, JavaScript regex). Defaults to the house folder. Pass path to search a workspace or a subdirectory. Skips node_modules and .git.',
				parameters: {
					type: 'object',
					properties: {
						mode: { type: 'string', enum: ['glob', 'grep'] },
						pattern: { type: 'string', description: 'Glob (e.g. **/*.md, src/**/*.{js,ts}) or regex' },
						path: { type: 'string', description: 'Optional file or directory. Omit to search the house. Use the absolute workspace path to search a project.' },
						max_results: { type: 'integer' },
						case_insensitive: { type: 'boolean' }
					},
					required: ['mode', 'pattern']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'chat_history',
				description: 'Read stored chat turns that compaction folded off the live context. Prefer this over reading session.jsonl. Indices are negative only: -1 is the newest hidden message. Omit start to get hidden / index_range. start and end are inclusive (end defaults to start). catalog=true returns role/time/chars without bodies. query is an optional case-insensitive substring (string or list; OR). Long-term facts belong in house files.',
				parameters: {
					type: 'object',
					properties: {
						start: { type: 'integer', description: 'Inclusive start index (negative; -1 = newest hidden). Omit to inspect index_range.' },
						end: { type: 'integer', description: 'Inclusive end index (negative). Defaults to start.' },
						catalog: { type: 'boolean', description: 'If true, return metadata only (no message bodies).' },
						query: { type: 'string', description: 'Optional case-insensitive substring filter on message text.' }
					}
				}
			}
		}
	];
	if (ctx && ctx.run_command) {
		const limits = CommandTimeouts(ctx);
		specs.push({
			type: 'function',
			function: {
				name: 'run_command',
				description: 'Run a shell command. cwd must be a workspace folder (defaults to the first workspace), not the house palace. ' +
					'The command and everything it starts are killed at the timeout or when the user presses Stop; the result then has timed_out or stopped. ' +
					'Output is capped per stream, keeping the start and the end.',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string' },
						cwd: { type: 'string' },
						timeout_ms: {
							type: 'integer',
							description: 'Optional. Default ' + FormatSeconds(limits.def) + ', max ' + FormatSeconds(limits.max) + '.'
						}
					},
					required: ['command']
				}
			}
		});
	}
	let all = specs.concat(AgpiSpecs());
	if (ctx && ctx.tool_packs) {
		all = all.filter((s) => PackToolOn(ctx, PackIdForNative(s.function.name), s.function.name));
	}
	return all;
}

function PackToolOn(ctx, packId, name) {
	if (!ctx || !ctx.tool_packs) return true;
	const row = ctx.tool_packs[packId];
	if (!row || !row.enabled) return false;
	return !(row.disabled || []).includes(name);
}

function PackIdForNative(name) {
	return Object.prototype.hasOwnProperty.call(HANDLERS, name) ? 'loci' : 'agpi';
}

function WalkStrings(val, out) {
	if (typeof val === 'string') out.push(val);
	else if (Array.isArray(val)) for (const x of val) WalkStrings(x, out);
	else if (val && typeof val === 'object') for (const x of Object.values(val)) WalkStrings(x, out);
}

function IsArtifactsRel(rel) {
	const posix = String(rel || '').replace(/\\/g, '/');
	return posix === 'artifacts' || posix.startsWith('artifacts/');
}

function IsStoriesRel(rel) {
	const posix = String(rel || '').replace(/\\/g, '/');
	return posix === 'stories' || posix.startsWith('stories/');
}

function McpMayTouch(rel) {
	return IsArtifactsRel(rel) || IsStoriesRel(rel);
}

function CoerceFsPath(raw) {
	const s = String(raw || '').trim();
	if (!s) return '';
	if (!/^file:/i.test(s)) return s;
	try {
		return fileURLToPath(s);
	} catch {
		try {
			let rest = decodeURI(s.replace(/^file:\/\//i, ''));
			if (rest.startsWith('/') && /^[A-Za-z]:/.test(rest.slice(1))) rest = rest.slice(1);
			return rest;
		} catch {
			return s;
		}
	}
}

function LooksLikeFsPath(s) {
	if (!s) return false;
	if (/^file:/i.test(s)) return true;
	if (path.isAbsolute(s)) return true;
	if (s === '.' || s === '..') return true;
	return s.includes('/') || s.includes('\\');
}

function PalaceHit(ctx, abs) {
	const house = RealPath(ctx.houseDir);
	const resolved = RealPath(abs);
	if (IsInside(resolved, house)) {
		const rel = PosixRel(house, resolved);
		if (!rel) return '.';
		if (McpMayTouch(rel)) return '';
		return rel;
	}
	const root = ctx.housesRoot ? RealPath(ctx.housesRoot) : '';
	if (root && IsInside(resolved, root) && !IsInside(resolved, house)) {
		const workspaces = WorkspaceRoots(ctx);
		if (workspaces.some((ws) => IsInside(resolved, ws))) return '';
		return PosixRel(root, resolved) || '.';
	}
	return '';
}

/**
 * MCP tools may only touch workspaces, house artifacts/, and house stories/.
 * Applies to every MCP call, including tools that advertise readOnlyHint.
 * @param {{ houseDir: string, workspaces?: string[], housesRoot?: string }} ctx
 * @param {object} args
 */
export function McpPalaceBlocked(ctx, args) {
	const strings = [];
	WalkStrings(args, strings);
	for (const s of strings) {
		if (!s) continue;
		const raw = CoerceFsPath(s) || s;
		try {
			const t = ResolvePath(ctx, raw);
			if (t.kind === 'house' && !McpMayTouch(t.rel)) return t.rel || '.';
		} catch {
			if (!LooksLikeFsPath(s) && !LooksLikeFsPath(raw)) continue;
			const abs = path.isAbsolute(raw) ? raw : path.resolve(ctx.houseDir, raw);
			const hit = PalaceHit(ctx, abs);
			if (hit) return hit;
		}
	}
	return '';
}

/**
 * @param {{ houseDir: string, workspaces?: string[], run_command?: boolean, name?: string, slug?: string, tool_packs?: object }} ctx
 * @param {string} name
 * @param {object} [args]
 */
export async function CallTool(ctx, name, args) {
	const payload = args || {};
	if (IsAgpiTool(name)) {
		if (ctx && ctx.tool_packs && !PackToolOn(ctx, 'agpi', name)) {
			return { ok: false, error: name + ' is disabled for this house.' };
		}
		return CallAgpi(ctx, name, payload);
	}
	const fn = HANDLERS[name];
	if (fn) {
		if (ctx && ctx.tool_packs && !PackToolOn(ctx, 'loci', name)) {
			return { ok: false, error: name + ' is disabled for this house.' };
		}
		try {
			const result = await fn(ctx, payload);
			return { ok: true, ...result };
		} catch (err) {
			return { ok: false, error: err && err.message ? String(err.message) : String(err) };
		}
	}
	const blocked = McpPalaceBlocked(ctx, payload);
	if (blocked) {
		return { ok: false, error: 'MCP tools may not read or write palace files except artifacts/ and stories/. Blocked: ' + blocked };
	}
	return CallMcpTool(ctx, name, payload);
}
