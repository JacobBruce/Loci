import fs from 'node:fs';
import path from 'node:path';

export const TASK_CAP = 16;
export const TASK_STATUSES = ['in-progress', 'awaiting-approval', 'completed'];

const TITLE_MAX = 120;
const BODY_MAX = 64 * 1024;
const WORK_HEADING_RE = /^##[ \t]+Work[ \t]+done[ \t]*\([^)]+\)[ \t]*$/im;
const WORK_ENTRY_RE = /^##[ \t]+Work[ \t]+done[ \t]*\(([^)]+)\)[ \t]*$/gm;
const STATUS_ALIASES = {
	'in-progress': 'in-progress',
	progress: 'in-progress',
	open: 'in-progress',
	'awaiting-approval': 'awaiting-approval',
	awaiting: 'awaiting-approval',
	approval: 'awaiting-approval',
	completed: 'completed',
	complete: 'completed',
	done: 'completed'
};
const STAMP_ALIASES = {
	good: 'good',
	accept: 'good',
	ok: 'good',
	change: 'change',
	changes: 'change',
	revise: 'change',
	drop: 'drop',
	reject: 'drop'
};

function TaskError(message) {
	return new Error(message);
}

function HouseDir(house) {
	const dir = String(house && house.path || '').trim();
	if (!dir) throw TaskError('House directory is missing.');
	return dir;
}

export function HouseAddress(slug, group) {
	const s = String(slug || '').trim();
	const g = String(group || '').trim();
	if (!s) return '';
	return g ? s + '@' + g : s;
}

export function AssignLabel(name, slug) {
	const who = String(name || slug || '').trim();
	return who ? 'Assign task to ' + who : 'Assign task';
}

export function TasksDir(houseDir) {
	return path.join(houseDir, 'tasks');
}

export function EnsureTasksDir(houseDir) {
	fs.mkdirSync(TasksDir(houseDir), { recursive: true });
}

function YamlScalar(value) {
	return String(value || '').replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
}

function TaskSlug(title) {
	const slug = String(title || '')
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'task';
}

function UniqueName(dir, base) {
	const stem = String(base || 'task').replace(/\.md$/i, '');
	let name = stem + '.md';
	let n = 2;
	while (fs.existsSync(path.join(dir, name))) {
		name = stem + '-' + n + '.md';
		n += 1;
	}
	return name;
}

function TaskFileName(raw) {
	const name = path.basename(String(raw || ''));
	if (!name || name.startsWith('.') || name.includes('..') || !name.toLowerCase().endsWith('.md')) {
		throw TaskError('Unknown task file.');
	}
	return name;
}

export function NormalizeStatus(raw) {
	const key = String(raw || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
	return STATUS_ALIASES[key] || '';
}

function NormalizeStamp(raw) {
	const key = String(raw || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
	return STAMP_ALIASES[key] || '';
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

function WorkHeading(at) {
	return '## Work done (' + at + ')';
}

function SplitWork(body) {
	const src = String(body || '').replace(/\r\n/g, '\n');
	const match = src.match(WORK_HEADING_RE);
	if (!match || match.index == null) return { notes: src, work: '' };
	return {
		notes: src.slice(0, match.index).replace(/\s+$/, ''),
		work: src.slice(match.index).replace(/\s+$/, '')
	};
}

function JoinWork(notes, work) {
	let head = String(notes || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
	const done = String(work || '').replace(/\r\n/g, '\n').replace(/^\s+/, '').replace(/\s+$/, '');
	if (done) head = (head ? head + '\n\n' : '') + done;
	if (head && !head.endsWith('\n')) head += '\n';
	return head;
}

function AppendWork(existing, next, at) {
	const entry = WorkHeading(at) + '\n\n' + String(next || '').replace(/\r\n/g, '\n').trim();
	const prev = String(existing || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
	return prev ? prev + '\n\n' + entry : entry;
}

function ParseWorkLog(work) {
	const src = String(work || '').replace(/\r\n/g, '\n');
	const found = [];
	const re = new RegExp(WORK_ENTRY_RE.source, 'gm');
	let match;
	while ((match = re.exec(src))) found.push(match);
	return found.map((row, i) => {
		const start = row.index + row[0].length;
		const end = i + 1 < found.length ? found[i + 1].index : src.length;
		return {
			at: row[1].trim(),
			text: src.slice(start, end).replace(/^\s+/, '').replace(/\s+$/, '')
		};
	});
}

function TaskMarkdown(meta, body) {
	const lines = [
		'---',
		'status: ' + YamlScalar(meta.status),
		'title: ' + YamlScalar(meta.title),
		'assigned: ' + YamlScalar(meta.assigned),
		'at: ' + YamlScalar(meta.at)
	];
	if (meta.submitted_at) lines.push('submitted_at: ' + YamlScalar(meta.submitted_at));
	if (meta.stamp) lines.push('stamp: ' + YamlScalar(meta.stamp));
	if (meta.stamped_at) lines.push('stamped_at: ' + YamlScalar(meta.stamped_at));
	if (meta.dossier) lines.push('dossier: ' + YamlScalar(meta.dossier));
	lines.push('---', '');
	return lines.join('\n') + JoinWork(body, meta.work);
}

function TitleFrom(meta, body, filename) {
	const titled = String(meta && meta.title || '').trim();
	if (titled) return titled;
	const heading = String(body || '').match(/^\s*#\s+(.+)/m);
	if (heading) return heading[1].trim();
	return path.basename(filename, '.md').replace(/-/g, ' ');
}

function LimitBody(raw, label) {
	const body = raw == null ? '' : String(raw);
	if (Buffer.byteLength(body, 'utf8') > BODY_MAX) {
		throw TaskError((label || 'Notes') + ' are too large (max 64KiB).');
	}
	return body;
}

function ListTaskFiles(houseDir) {
	const dir = TasksDir(houseDir);
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

function ItemFromParsed(filename, parsed, address) {
	const status = NormalizeStatus(parsed.meta.status) || 'in-progress';
	const title = TitleFrom(parsed.meta, parsed.body, filename);
	const split = SplitWork(parsed.body);
	return {
		file: filename,
		title,
		status,
		assigned: String(parsed.meta.assigned || address || '').trim(),
		at: String(parsed.meta.at || '').trim(),
		work: split.work,
		work_log: ParseWorkLog(split.work),
		submitted_at: String(parsed.meta.submitted_at || '').trim(),
		stamp: String(parsed.meta.stamp || '').trim(),
		stamped_at: String(parsed.meta.stamped_at || '').trim(),
		dossier: String(parsed.meta.dossier || '').trim(),
		body: split.notes,
		markdown: String(parsed.body || '').replace(/\r\n/g, '\n').replace(/\s+$/, '')
	};
}

function ReadTaskItem(houseDir, filename, address) {
	const text = fs.readFileSync(path.join(TasksDir(houseDir), filename), 'utf8');
	return ItemFromParsed(filename, ParseFrontmatter(text), address);
}

function WriteTaskFile(houseDir, item) {
	const dest = path.join(TasksDir(houseDir), item.file);
	fs.writeFileSync(dest, TaskMarkdown(item, item.body), 'utf8');
}

export function CountTasks(houseDir) {
	return ListTaskFiles(houseDir).length;
}

function CountStatus(items, status) {
	let n = 0;
	for (const row of items) {
		if (row.status === status) n += 1;
	}
	return n;
}

function BoardPayload(house, items) {
	const name = String(house.name || house.slug || '').trim();
	return {
		name,
		slug: house.slug || '',
		group: String(house.group || '').trim(),
		address: HouseAddress(house.slug, house.group),
		assign_to: AssignLabel(name, house.slug),
		cap: TASK_CAP,
		count: items.length,
		in_progress: CountStatus(items, 'in-progress'),
		awaiting: CountStatus(items, 'awaiting-approval'),
		completed: CountStatus(items, 'completed'),
		items
	};
}

export function ListTasks(house) {
	const houseDir = HouseDir(house);
	EnsureTasksDir(houseDir);
	const address = HouseAddress(house.slug, house.group);
	const items = ListTaskFiles(houseDir).map((name) => ReadTaskItem(houseDir, name, address));
	const rank = { 'in-progress': 0, 'awaiting-approval': 1, 'completed': 2 };
	items.sort((a, b) => {
		const d = (rank[a.status] || 0) - (rank[b.status] || 0);
		if (d) return d;
		const at = String(b.at).localeCompare(String(a.at));
		if (at) return at;
		return a.file.localeCompare(b.file);
	});
	return BoardPayload(house, items);
}

export function CreateTask(house, payload) {
	const houseDir = HouseDir(house);
	EnsureTasksDir(houseDir);
	if (CountTasks(houseDir) >= TASK_CAP) {
		throw TaskError('Task Board is full (' + TASK_CAP + '). Finish or remove a note before assigning another.');
	}
	const title = YamlScalar(payload && payload.title);
	if (!title) throw TaskError('A title is required.');
	if (title.length > TITLE_MAX) {
		throw TaskError('Title is too long (max ' + TITLE_MAX + ' characters).');
	}
	const body = LimitBody(payload && payload.body, 'Notes');
	const dir = TasksDir(houseDir);
	const filename = UniqueName(dir, TaskSlug(title));
	WriteTaskFile(houseDir, {
		file: filename,
		status: 'in-progress',
		title,
		assigned: HouseAddress(house.slug, house.group),
		at: new Date().toISOString(),
		body
	});
	return ListTasks(house);
}

export function UpdateTaskNotes(house, filename, body) {
	const houseDir = HouseDir(house);
	EnsureTasksDir(houseDir);
	const name = TaskFileName(filename);
	const dest = path.join(TasksDir(houseDir), name);
	if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) {
		throw TaskError('Unknown task file.');
	}
	const address = HouseAddress(house.slug, house.group);
	const item = ReadTaskItem(houseDir, name, address);
	if (item.status !== 'in-progress') {
		throw TaskError('Only in-progress notes can be edited here.');
	}
	item.body = LimitBody(body, 'Notes');
	WriteTaskFile(houseDir, item);
	return ListTasks(house);
}

export function RemoveTask(house, filename) {
	const houseDir = HouseDir(house);
	EnsureTasksDir(houseDir);
	const name = TaskFileName(filename);
	const dest = path.join(TasksDir(houseDir), name);
	if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) {
		throw TaskError('Unknown task file.');
	}
	fs.unlinkSync(dest);
	return ListTasks(house);
}

export function FindTask(house, query) {
	const raw = String(query || '').trim();
	if (!raw) throw TaskError('payload.task is required (title or file name).');
	const items = ListTasks(house).items;
	const base = path.basename(raw);
	const withMd = base.toLowerCase().endsWith('.md') ? base : base + '.md';
	const byFile = items.filter((t) => t.file === base || t.file === withMd);
	if (byFile.length === 1) return byFile[0];
	const q = raw.toLowerCase();
	const byTitle = items.filter((t) => t.title.toLowerCase() === q);
	if (byTitle.length === 1) return byTitle[0];
	if (byFile.length > 1 || byTitle.length > 1) {
		throw TaskError('That task name matches more than one note. Use the file name.');
	}
	throw TaskError('No task named "' + raw + '".');
}

export function SubmitTask(house, payload) {
	const query = payload && payload.task != null ? payload.task : payload;
	const item = FindTask(house, typeof query === 'object' ? query && query.task : query);
	if (item.status === 'completed') {
		throw TaskError('"' + item.title + '" is already completed.');
	}
	if (item.status !== 'in-progress' && item.status !== 'awaiting-approval') {
		throw TaskError('Submit an in-progress task to the Approval Tray.');
	}
	const work = LimitBody(payload && payload.work, 'Work').replace(/\r\n/g, '\n').trim();
	if (!work) throw TaskError('payload.work is required (what you did).');
	const houseDir = HouseDir(house);
	const at = new Date().toISOString();
	item.status = 'awaiting-approval';
	item.work = LimitBody(AppendWork(item.work, work, at), 'Work');
	item.submitted_at = at;
	item.stamp = '';
	item.stamped_at = '';
	WriteTaskFile(houseDir, item);
	const board = ListTasks(house);
	return {
		task: item,
		paused: board.in_progress === 0,
		board
	};
}

function DayStamp(iso) {
	const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/);
	return m ? m[1] : new Date().toISOString().slice(0, 10);
}

function CabinetDir(houseDir) {
	return path.join(houseDir, 'cabinet');
}

function WriteDossier(houseDir, item, note) {
	const at = new Date().toISOString();
	const slug = TaskSlug(item.title);
	const dir = CabinetDir(houseDir);
	fs.mkdirSync(dir, { recursive: true });
	const name = UniqueName(dir, DayStamp(item.stamped_at || at) + '-' + slug);
	const lines = [
		'---',
		'title: ' + YamlScalar(item.title),
		'task: tasks/' + item.file,
		'stamp: good',
		'at: ' + at,
		'---',
		''
	];
	let body = JoinWork(item.body, item.work);
	const extra = String(note || '').replace(/\r\n/g, '\n').trim();
	if (extra) {
		body = body.replace(/\s+$/, '') + '\n\n## Filing note\n\n' + extra + '\n';
	} else if (body && !body.endsWith('\n')) {
		body += '\n';
	}
	fs.writeFileSync(path.join(dir, name), lines.join('\n') + body, 'utf8');
	return 'cabinet/' + name;
}

function ArchiveDropped(houseDir, item, feedback, at) {
	const dir = path.join(houseDir, 'archive', 'tasks');
	fs.mkdirSync(dir, { recursive: true });
	const name = UniqueName(dir, item.file);
	item.status = 'dropped';
	item.stamp = 'drop';
	item.stamped_at = at;
	let body = item.body;
	const note = String(feedback || '').replace(/\r\n/g, '\n').trim();
	if (note) {
		const head = String(body || '').replace(/\s+$/, '');
		body = (head ? head + '\n\n' : '') + '## Dropped\n\n' + note + '\n';
	}
	fs.writeFileSync(path.join(dir, name), TaskMarkdown(item, body), 'utf8');
	fs.unlinkSync(path.join(TasksDir(houseDir), item.file));
	return 'archive/tasks/' + name;
}

export function StampTask(house, filename, verdict, feedback) {
	const houseDir = HouseDir(house);
	EnsureTasksDir(houseDir);
	const item = FindTask(house, filename);
	if (item.status !== 'awaiting-approval') {
		throw TaskError('Stamp a task that is awaiting approval.');
	}
	const stamp = NormalizeStamp(verdict);
	if (!stamp) throw TaskError('Stamp is good, change, or drop.');
	const at = new Date().toISOString();
	if (stamp === 'good') {
		item.status = 'completed';
		item.stamp = 'good';
		item.stamped_at = at;
		WriteTaskFile(houseDir, item);
		return { verdict: stamp, task: item, board: ListTasks(house) };
	}
	if (stamp === 'change') {
		item.status = 'in-progress';
		item.stamp = 'change';
		item.stamped_at = at;
		WriteTaskFile(houseDir, item);
		return { verdict: stamp, task: item, board: ListTasks(house) };
	}
	const archived = ArchiveDropped(houseDir, item, feedback, at);
	return { verdict: stamp, task: item, archived, board: ListTasks(house) };
}

export function FileTask(house, payload) {
	const query = payload && payload.task != null ? payload.task : payload;
	const item = FindTask(house, typeof query === 'object' ? query && query.task : query);
	if (item.status !== 'completed') {
		throw TaskError('File a completed task. "' + item.title + '" is ' + item.status + '.');
	}
	const note = LimitBody(payload && payload.note, 'Note').replace(/\r\n/g, '\n').trim();
	const houseDir = HouseDir(house);
	const dossier = WriteDossier(houseDir, item, note);
	fs.unlinkSync(path.join(TasksDir(houseDir), item.file));
	return {
		task: item.file,
		title: item.title,
		dossier,
		board: ListTasks(house)
	};
}

export function FormatStampWake(result) {
	const title = result && result.task && result.task.title ? result.task.title : 'a task';
	let text = 'The user dropped "' + title + '".';
	if (result.verdict === 'good') {
		text = 'The user stamped Approve on "' + title + '". It is completed. File it in the Filing Cabinet.';
	} else if (result.verdict === 'change') {
		text = 'The user asked for changes on "' + title + '". It is in progress again.';
	}
	return 'System message: ' + text;
}

function DossierDate(name) {
	const m = String(name || '').match(/^(\d{4}-\d{2}-\d{2})-/);
	return m ? m[1] : '';
}

export function CabinetBoard(houseDir) {
	const rel = 'cabinet/';
	if (!houseDir) return { path: rel, count: 0, items: [] };
	const dir = CabinetDir(houseDir);
	if (!fs.existsSync(dir)) return { path: rel, count: 0, items: [] };
	const names = [];
	for (const name of fs.readdirSync(dir)) {
		if (name.startsWith('.') || name === 'RECORDS.md' || !name.toLowerCase().endsWith('.md')) continue;
		try {
			if (fs.statSync(path.join(dir, name)).isFile()) names.push(name);
		} catch {
			// skip
		}
	}
	names.sort().reverse();
	const items = names.map((name) => {
		let title = '';
		try {
			const parsed = ParseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'));
			title = String(parsed.meta.title || '').trim();
		} catch {
			// skip
		}
		return {
			file: rel + name,
			title: title || name.replace(/\.md$/i, ''),
			date: DossierDate(name)
		};
	});
	return { path: rel, count: items.length, items };
}

export function SummarizeCabinet(houseDir) {
	const board = CabinetBoard(houseDir);
	return {
		path: board.path,
		count: board.count,
		items: board.items.slice(0, 8).map((row) => ({ file: row.file, title: row.title }))
	};
}

export function SummarizeTasks(houseDir) {
	if (!houseDir) return { path: 'tasks/', count: 0, cap: TASK_CAP, items: [] };
	EnsureTasksDir(houseDir);
	const items = ListTaskFiles(houseDir).map((name) => {
		const row = ReadTaskItem(houseDir, name, '');
		return { file: row.file, title: row.title, status: row.status };
	});
	return { path: 'tasks/', count: items.length, cap: TASK_CAP, items };
}
