import { ApplyTemplate } from '../apply-template.js';
import { ThemeName } from '../themes.js';
import { CHAT_LOG_FIRST, CHAT_LOG_MORE, OlderChatRange } from '../chat-log.js';
import { AdvanceDeg, ClockDigital, ClockHands, ClockParts, ClockZone, FormatElapsed } from '../clock.js';

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const overlay = document.getElementById('settings_overlay');
const modelsOverlay = document.getElementById('models_overlay');
const settingsForm = document.getElementById('settings_form');
const settingsMsg = document.getElementById('settings_msg');
const modelsMsg = document.getElementById('models_msg');
const formMsg = document.getElementById('form_msg');
const housesBtn = document.getElementById('houses_btn');
const newHouseBtn = document.getElementById('new_house_btn');
const waitingWrap = document.getElementById('waiting_wrap');
const waitingBtn = document.getElementById('waiting_btn');
const waitingMenu = document.getElementById('waiting_menu');
const workingWrap = document.getElementById('working_wrap');
const workingBtn = document.getElementById('working_btn');
const workingMenu = document.getElementById('working_menu');
const notifyOverlay = document.getElementById('notify_overlay');
const tasksOverlay = document.getElementById('tasks_overlay');
const approvalOverlay = document.getElementById('approval_overlay');
const stampOverlay = document.getElementById('stamp_overlay');
const inspectOverlay = document.getElementById('inspect_overlay');
const calendarOverlay = document.getElementById('calendar_overlay');
const calendarDayOverlay = document.getElementById('calendar_day_overlay');
const calendarListOverlay = document.getElementById('calendar_list_overlay');
const calendarEventOverlay = document.getElementById('calendar_event_overlay');
const contactsOverlay = document.getElementById('contacts_overlay');
const contactsFormOverlay = document.getElementById('contacts_form_overlay');
const booksOverlay = document.getElementById('books_overlay');
const booksFormOverlay = document.getElementById('books_form_overlay');
const diaryOverlay = document.getElementById('diary_overlay');
const cabinetOverlay = document.getElementById('cabinet_overlay');
const chestOverlay = document.getElementById('chest_overlay');
const storyOverlay = document.getElementById('story_overlay');
const pcOverlay = document.getElementById('pc_overlay');
const pcFormOverlay = document.getElementById('pc_form_overlay');
const clockOverlay = document.getElementById('clock_overlay');
const alarmOverlay = document.getElementById('alarm_overlay');
const alarmFormOverlay = document.getElementById('alarm_form_overlay');
const whiteboardOverlay = document.getElementById('whiteboard_overlay');
const planFormOverlay = document.getElementById('plan_form_overlay');
const noteFormOverlay = document.getElementById('note_form_overlay');
const mdOverlay = document.getElementById('md_overlay');
const devOverlay = document.getElementById('dev_overlay');
const packsOverlay = document.getElementById('packs_overlay');
const packToolsOverlay = document.getElementById('pack_tools_overlay');
const packSetOverlay = document.getElementById('pack_set_overlay');
const mcpJsonOverlay = document.getElementById('mcp_json_overlay');

const TASK_COLUMNS = [
	{ status: 'in-progress', listId: 'task_col_progress_list' },
	{ status: 'awaiting-approval', listId: 'task_col_awaiting_list' },
	{ status: 'completed', listId: 'task_col_done_list' }
];

const VIEWS = ['view_welcome', 'view_list', 'view_form', 'view_house'];
const UNGROUPED = '__ungrouped__';

let templates = {
	'BOOT.md': '',
	'SYSTEM.md': '',
	'SOUL.md': '',
	'USER.md': '',
	'LOGOFF.md': '',
	'team-solitary.md': '',
	'team-group.md': ''
};
let editingSlug = null;
let manageFromHouse = false;
let soulTouched = false;
let systemTouched = false;
let lastHouse = '';
let currentSlug = '';
let currentName = '';
let currentWorking = false;
let appLabel = '';
let poseTimer = 0;
let lastPose = null;
let taskBoard = { address: '', items: [], cap: 16, count: 0 };
let editingTaskFile = '';
let approvalTask = null;
let approvalFill = 0;
let pendingStamp = '';
const POSE_ACTIVITY_MS = 4000;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];
let workspaces = [];
let allHouses = [];
let groupFilter = '';
let houseShow = '';
let houseSort = 'recent';
let houseViews = {};
let palaceCache = {
	rooms: [
		{ id: 'bedroom', name: 'Bedroom' },
		{ id: 'office', name: 'Office' },
		{ id: 'library', name: 'Library' },
		{ id: 'living', name: 'Living room' }
	],
	objects: [
		{ id: 'diary', room: 'bedroom', name: 'Diary' },
		{ id: 'calendar', room: 'bedroom', name: 'Calendar' },
		{ id: 'clock', room: 'office', name: 'Clock' },
		{ id: 'alarm_clock', room: 'bedroom', name: 'Alarm Clock' },
		{ id: 'bed', room: 'bedroom', name: 'Bed' },
		{ id: 'soul_frame', room: 'bedroom', name: 'Framed Constitution' },
		{ id: 'user_portrait', room: 'bedroom', name: 'User Portrait' },
		{ id: 'pc', room: 'office', name: 'PC' },
		{ id: 'notes', room: 'office', name: 'Notebook' },
		{ id: 'whiteboard', room: 'office', name: 'Whiteboard' },
		{ id: 'task_board', room: 'office', name: 'Task Board' },
		{ id: 'approval_tray', room: 'office', name: 'Approval Tray' },
		{ id: 'book_shelf', room: 'library', name: 'Book Shelf' },
		{ id: 'cabinet', room: 'library', name: 'Filing Cabinet' },
		{ id: 'chest', room: 'library', name: 'Chest' },
		{ id: 'story_book', room: 'library', name: 'Story Book', ui: 'stories' },
		{ id: 'address_book', room: 'living', name: 'Address Book' },
		{ id: 'rule_book', room: 'living', name: 'Rule Book' },
		{ id: 'game_console', room: 'living', name: 'Game Console', ui: 'game' }
	]
};
let settingsCache = {
	provider: 'openai',
	model: '',
	openai_models: [],
	anthropic_models: [],
	openrouter_models: []
};
let draftAnthropic = [];
let draftOpenAI = [];
let draftOpenRouter = [];

function FillHouseTemplate(text, name, group) {
	return ApplyTemplate(text, {
		name,
		group,
		teamAlone: templates['team-solitary.md'],
		teamGroup: templates['team-group.md']
	});
}

function ShowView(id) {
	for (const vid of VIEWS) {
		document.getElementById(vid).classList.toggle('hidden', vid !== id);
	}
	const onRoster = id === 'view_list' || id === 'view_welcome';
	housesBtn.classList.toggle('hidden', onRoster);
	newHouseBtn.classList.toggle('hidden', !onRoster);
	if (id !== 'view_house') {
		ShowTasks(false);
		ShowApproval(false);
		ShowInspect(false);
		ShowCalendar(false);
		ShowContacts(false);
		ShowBooks(false);
		ShowDiary(false);
		ShowCabinet(false);
		ShowChest(false);
		ShowStories(false);
		ShowPc(false);
		ShowClock(false);
		ShowAlarmClock(false);
		ShowWhiteboard(false);
		ShowMarkdown(false);
		ShowDevTools(false);
		ShowGame(false);
	}
}

let chatLog = [];
let chatShown = 0;
let chatRestoring = false;
let chatStick = true;

const NOTE_LABELS = { game: 'game', alarm: 'alarm', dm: 'dm', stamp: 'approval', task: 'task', poll: 'poll' };

function NoteLabel(from) {
	return NOTE_LABELS[from] || String(from || 'note');
}

function MakeChatLine(who, text, note, images) {
	const row = document.createElement('div');
	row.className = note ? 'line note' : 'line';
	if (who === 'you' && !note) row.dataset.role = 'user';
	const name = document.createElement('span');
	name.className = 'who';
	name.textContent = who;
	const body = document.createElement('div');
	body.className = 'md';
	const src = text == null ? '' : String(text);
	body.textContent = src;
	row.append(name, body);
	const pics = (images || []).filter((img) => img && img.data && img.media_type);
	if (pics.length) {
		const strip = document.createElement('div');
		strip.className = 'chat_images';
		for (const img of pics) {
			const pic = document.createElement('img');
			pic.className = 'chat_image';
			pic.alt = img.name || 'Attached image';
			pic.src = 'data:' + img.media_type + ';base64,' + img.data;
			strip.append(pic);
		}
		row.append(strip);
	}
	return row;
}

function PinChatBottom() {
	chatRestoring = true;
	logEl.scrollTop = logEl.scrollHeight;
	chatRestoring = false;
}

function PaintChatLine(row) {
	const body = row.querySelector('.md');
	const src = body.textContent;
	if (!src.trim() || !window.lociAPI) return;
	const follow = chatStick;
	const plainHeight = body.offsetHeight;
	PaintMarkdown(body, src).then(() => {
		if (!body.isConnected) return;
		const growth = body.offsetHeight - plainHeight;
		if (!follow && growth > 0 && row.getBoundingClientRect().top < logEl.getBoundingClientRect().top) {
			chatRestoring = true;
			logEl.scrollTop += growth;
			chatRestoring = false;
			return;
		}
		if (follow) PinChatBottom();
	});
}

function AppendLine(who, text, note, images) {
	const src = text == null ? '' : String(text);
	chatLog.push({ who, text: src, note: !!note, images: images || [] });
	chatShown += 1;
	const row = MakeChatLine(who, src, note, images);
	logEl.append(row);
	chatStick = true;
	PaintChatLine(row);
	PinChatBottom();
	SyncChatButtons();
}

function FillLog(lines) {
	chatLog = (lines || []).map((line) => ({
		who: line.from ? NoteLabel(line.from) : (line.role === 'user' ? 'you' : (currentName || 'house')),
		text: line.text == null ? '' : String(line.text),
		note: !!line.from,
		images: Array.isArray(line.images) ? line.images : []
	}));
	const page = OlderChatRange(chatLog.length, 0, CHAT_LOG_FIRST);
	chatShown = page.count;
	logEl.replaceChildren();
	const rows = [];
	for (const line of chatLog.slice(page.start, page.start + page.count)) {
		const row = MakeChatLine(line.who, line.text, line.note, line.images);
		logEl.append(row);
		rows.push(row);
	}
	chatStick = true;
	for (const row of rows) PaintChatLine(row);
	PinChatBottom();
	requestAnimationFrame(PinChatBottom);
	SyncChatButtons();
}

function PrependOlderChat() {
	const page = OlderChatRange(chatLog.length, chatShown, CHAT_LOG_MORE);
	if (!page.count || chatRestoring) return;
	chatRestoring = true;
	const prevHeight = logEl.scrollHeight;
	const prevTop = logEl.scrollTop;
	const rows = [];
	const frag = document.createDocumentFragment();
	for (const line of chatLog.slice(page.start, page.start + page.count)) {
		const row = MakeChatLine(line.who, line.text, line.note, line.images);
		frag.append(row);
		rows.push(row);
	}
	logEl.prepend(frag);
	chatShown += page.count;
	for (const row of rows) PaintChatLine(row);
	logEl.scrollTop = logEl.scrollHeight - prevHeight + prevTop;
	chatRestoring = false;
}

logEl.addEventListener('scroll', () => {
	if (chatRestoring) return;
	const gap = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight;
	chatStick = gap < 48;
	if (chatStick) return;
	if (chatShown >= chatLog.length) return;
	if (logEl.scrollTop > 8) return;
	if (logEl.scrollHeight <= logEl.clientHeight + 1) return;
	PrependOlderChat();
});

function IpcErrorText(err, fallback) {
	let msg = err && err.message ? String(err.message) : '';
	msg = msg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
	return msg || fallback || 'Something went wrong.';
}

function FormErrorText(err, fallback) {
	const msg = IpcErrorText(err, fallback);
	return /^error:/i.test(msg) ? msg : 'Error: ' + msg;
}

// Native confirm for a destructive action. Removals that need house data the
// renderer does not hold (tasks, archiving) prompt from the main process instead.
async function ConfirmAction(opts) {
	try {
		return await window.lociAPI.confirmAction(opts);
	} catch {
		return false;
	}
}

function ShowChatMenu(open) {
	const menu = document.getElementById('chat_menu');
	const more = document.getElementById('chat_more');
	menu.classList.toggle('hidden', !open);
	more.setAttribute('aria-expanded', open ? 'true' : 'false');
	if (open) ShowAttachMenu(false);
}

let pendingImages = [];

function PaintPending() {
	const n = pendingImages.length;
	const box = document.getElementById('chat_pending');
	box.classList.toggle('hidden', n === 0);
	document.getElementById('chat_pending_label').textContent = n === 1
		? '1 image attached'
		: n + ' images attached';
}

function ClearPending() {
	pendingImages = [];
	PaintPending();
}

function ShowAttachMenu(open) {
	const menu = document.getElementById('chat_attach_menu');
	const btn = document.getElementById('chat_attach');
	menu.classList.toggle('hidden', !open);
	btn.setAttribute('aria-expanded', open ? 'true' : 'false');
	if (open) ShowChatMenu(false);
}

function SyncHouseActions() {
	const busy = !!currentWorking;
	const gaming = !!gameSlug;
	document.getElementById('manage_house_btn').disabled = busy;
	document.getElementById('tool_packs_btn').disabled = busy;
	document.getElementById('dev_tools_btn').disabled = busy;
	document.getElementById('assign_task_btn').disabled = busy || gaming;
	for (const id of ['approval_good', 'approval_change', 'approval_drop']) {
		document.getElementById(id).disabled = gaming;
	}
	if (gaming && !tasksOverlay.classList.contains('hidden')) ShowTasks(false);
}

function SyncChatButtons() {
	const empty = !chatLog.length;
	const hasUser = chatLog.some((line) => line.who === 'you');
	const redo = document.getElementById('chat_redo');
	const clear = document.getElementById('chat_clear');
	const send = document.getElementById('chat_send');
	const more = document.getElementById('chat_more');
	send.textContent = currentWorking ? 'Stop' : 'Send';
	document.getElementById('chat_input').disabled = !!currentWorking;
	document.getElementById('chat_attach').disabled = !!currentWorking;
	more.disabled = !!currentWorking;
	if (currentWorking) ShowChatMenu(false);
	redo.disabled = empty || currentWorking || !hasUser || !currentSlug;
	clear.disabled = empty || currentWorking || !currentSlug;
	SyncHouseActions();
	redo.title = redo.disabled
		? (currentWorking ? 'Wait until this turn finishes' : 'Nothing to redo')
		: 'Retry the last message';
	clear.title = clear.disabled
		? (currentWorking ? 'Wait until this turn finishes' : 'Log is empty')
		: 'Clear the log and session';
}

async function CloseSettings() {
	if (overlay.classList.contains('hidden') || overlay.dataset.saving === '1') return;
	overlay.dataset.saving = '1';
	overlay.classList.add('hidden');
	try {
		const saved = await window.lociAPI.saveSettings(ReadSettingsForm());
		FillSettings(saved);
	} catch {
		overlay.classList.remove('hidden');
		settingsMsg.textContent = 'Could not save settings.';
	} finally {
		delete overlay.dataset.saving;
	}
}

function ShowSettings(open) {
	if (open) {
		ShowModels(false);
		overlay.classList.remove('hidden');
		return;
	}
	CloseSettings();
}

function ShowModels(open) {
	modelsOverlay.classList.toggle('hidden', !open);
	if (open) ShowSettings(false);
}

function ModelKey(provider, model) {
	return String(provider || '') + '\t' + String(model || '');
}

function ParseModelKey(value) {
	const raw = String(value || '');
	const i = raw.indexOf('\t');
	if (i < 0) return { provider: '', model: '' };
	return { provider: raw.slice(0, i), model: raw.slice(i + 1) };
}

function CatalogHasModels(cfg) {
	const c = cfg || settingsCache;
	return !!(
		(c.anthropic_models || []).length
		|| (c.openai_models || []).length
		|| (c.openrouter_models || []).length
	);
}

function FillHouseModelSelect(provider, model) {
	const sel = document.getElementById('hf_model');
	const anth = settingsCache.anthropic_models || [];
	const oai = settingsCache.openai_models || [];
	const or = settingsCache.openrouter_models || [];
	sel.replaceChildren();
	const addGroup = (label, prov, ids) => {
		if (!ids.length) return;
		const og = document.createElement('optgroup');
		og.label = label;
		for (const id of ids) {
			const opt = document.createElement('option');
			opt.value = ModelKey(prov, id);
			opt.textContent = id;
			og.append(opt);
		}
		sel.append(og);
	};
	addGroup('Anthropic', 'anthropic', anth);
	addGroup('OpenAI', 'openai', oai);
	addGroup('OpenRouter', 'openrouter', or);
	const chosen = String(model || '').trim();
	if (chosen) {
		const key = ModelKey(provider, chosen);
		if (![...sel.querySelectorAll('option')].some((o) => o.value === key)) {
			const opt = document.createElement('option');
			opt.value = key;
			opt.textContent = chosen + ' (not in lists)';
			sel.append(opt);
		}
		sel.value = key;
	}
}

function RenderModelList(ulId, items, onRemove) {
	const ul = document.getElementById(ulId);
	ul.replaceChildren();
	for (const id of items) {
		const li = document.createElement('li');
		const label = document.createElement('span');
		label.textContent = id;
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'mdl_drop';
		rm.setAttribute('aria-label', 'Remove ' + id);
		rm.title = 'Remove';
		rm.append(ArchiveIcon());
		rm.addEventListener('click', () => onRemove(id));
		li.append(label, rm);
		ul.append(li);
	}
}

async function PersistModels() {
	try {
		const saved = await window.lociAPI.saveSettings({
			anthropic_models: draftAnthropic,
			openai_models: draftOpenAI,
			openrouter_models: draftOpenRouter,
			models_seeded: true
		});
		settingsCache = saved;
		const pick = ParseModelKey(document.getElementById('hf_model').value);
		FillHouseModelSelect(pick.provider, pick.model);
		modelsMsg.textContent = '';
	} catch {
		modelsMsg.textContent = 'Could not save models.';
	}
}

function RenderModelDrafts() {
	RenderModelList('mdl_anthropic', draftAnthropic, (id) => {
		draftAnthropic = draftAnthropic.filter((x) => x !== id);
		RenderModelDrafts();
		PersistModels();
	});
	RenderModelList('mdl_openai', draftOpenAI, (id) => {
		draftOpenAI = draftOpenAI.filter((x) => x !== id);
		RenderModelDrafts();
		PersistModels();
	});
	RenderModelList('mdl_openrouter', draftOpenRouter, (id) => {
		draftOpenRouter = draftOpenRouter.filter((x) => x !== id);
		RenderModelDrafts();
		PersistModels();
	});
}

function FillModelsForm(cfg) {
	settingsCache = cfg;
	draftAnthropic = (cfg.anthropic_models || []).slice();
	draftOpenAI = (cfg.openai_models || []).slice();
	draftOpenRouter = (cfg.openrouter_models || []).slice();
	document.getElementById('mdl_anthropic_input').value = '';
	document.getElementById('mdl_openai_input').value = '';
	document.getElementById('mdl_openrouter_input').value = '';
	modelsMsg.textContent = '';
	RenderModelDrafts();
}

function DraftList(provider) {
	if (provider === 'anthropic') return draftAnthropic;
	if (provider === 'openrouter') return draftOpenRouter;
	return draftOpenAI;
}

function DraftInputId(provider) {
	if (provider === 'anthropic') return 'mdl_anthropic_input';
	if (provider === 'openrouter') return 'mdl_openrouter_input';
	return 'mdl_openai_input';
}

function AddDraftModel(provider) {
	const input = document.getElementById(DraftInputId(provider));
	const id = input.value.trim();
	if (!id) return;
	const list = DraftList(provider);
	if (list.includes(id)) {
		modelsMsg.textContent = 'Already in the list.';
		return;
	}
	list.push(id);
	input.value = '';
	modelsMsg.textContent = '';
	RenderModelDrafts();
	PersistModels();
}

function ApplyTheme(name) {
	const theme = ThemeName(name);
	const link = document.getElementById('theme_css');
	const href = './theme-' + theme + '.css';
	if (link && !link.href.endsWith('/theme-' + theme + '.css') && link.getAttribute('href') !== href) {
		link.href = href;
	}
	document.documentElement.dataset.theme = theme;
}

function FillSettings(cfg) {
	settingsCache = cfg;
	ApplyTheme(cfg && cfg.theme);
	document.getElementById('cfg_openai_key').value = cfg.openai_api_key || '';
	document.getElementById('cfg_openai_base').value = cfg.openai_base_url || '';
	document.getElementById('cfg_anthropic_key').value = cfg.anthropic_api_key || '';
	document.getElementById('cfg_anthropic_base').value = cfg.anthropic_base_url || '';
	document.getElementById('cfg_openrouter_key').value = cfg.openrouter_api_key || '';
	document.getElementById('cfg_firecrawl_key').value = cfg.firecrawl_api_key || '';
	document.getElementById('cfg_houses_root').value = cfg.houses_root || '';
	document.getElementById('cfg_theme').value = ThemeName(cfg.theme);
	document.getElementById('cfg_dev_mode').checked = !!cfg.dev_mode;
	settingsMsg.textContent = '';
	SyncDevChrome();
}

function ReadSettingsForm() {
	return {
		openai_api_key: document.getElementById('cfg_openai_key').value,
		openai_base_url: document.getElementById('cfg_openai_base').value,
		anthropic_api_key: document.getElementById('cfg_anthropic_key').value,
		anthropic_base_url: document.getElementById('cfg_anthropic_base').value,
		openrouter_api_key: document.getElementById('cfg_openrouter_key').value,
		firecrawl_api_key: document.getElementById('cfg_firecrawl_key').value,
		houses_root: document.getElementById('cfg_houses_root').value,
		theme: ThemeName(document.getElementById('cfg_theme').value),
		dev_mode: document.getElementById('cfg_dev_mode').checked
	};
}

function DismissIcon() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	const a = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	a.setAttribute('x1', '6');
	a.setAttribute('y1', '6');
	a.setAttribute('x2', '18');
	a.setAttribute('y2', '18');
	const b = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	b.setAttribute('x1', '18');
	b.setAttribute('y1', '6');
	b.setAttribute('x2', '6');
	b.setAttribute('y2', '18');
	svg.append(a, b);
	return svg;
}

function WindowIcon() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('aria-hidden', 'true');
	const frame = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
	frame.setAttribute('x', '2');
	frame.setAttribute('y', '3');
	frame.setAttribute('width', '12');
	frame.setAttribute('height', '10');
	frame.setAttribute('rx', '1');
	const bar = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	bar.setAttribute('x1', '2');
	bar.setAttribute('y1', '6');
	bar.setAttribute('x2', '14');
	bar.setAttribute('y2', '6');
	svg.append(frame, bar);
	return svg;
}

function EyeIcon() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('aria-hidden', 'true');
	const lid = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	lid.setAttribute('d', 'M1.5 8C3.2 5.2 5.4 3.8 8 3.8s4.8 1.4 6.5 4.2c-1.7 2.8-3.9 4.2-6.5 4.2S3.2 10.8 1.5 8z');
	const pupil = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	pupil.setAttribute('cx', '8');
	pupil.setAttribute('cy', '8');
	pupil.setAttribute('r', '1.7');
	svg.append(lid, pupil);
	return svg;
}

function InfoIcon() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('aria-hidden', 'true');
	const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	ring.setAttribute('cx', '8');
	ring.setAttribute('cy', '8');
	ring.setAttribute('r', '6');
	const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	dot.setAttribute('class', 'mark');
	dot.setAttribute('cx', '8');
	dot.setAttribute('cy', '5.1');
	dot.setAttribute('r', '0.8');
	const stem = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	stem.setAttribute('x1', '8');
	stem.setAttribute('y1', '8');
	stem.setAttribute('x2', '8');
	stem.setAttribute('y2', '11.2');
	svg.append(ring, dot, stem);
	return svg;
}

function FillDismissButtons() {
	for (const btn of document.querySelectorAll('.dlg_dismiss')) {
		btn.replaceChildren(DismissIcon());
	}
}

function ArchiveIcon() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	const parts = [
		['polyline', { points: '3 6 5 6 21 6' }],
		['path', { d: 'M8 6V4h8v2' }],
		['path', { d: 'M19 6l-1 14H6L5 6' }],
		['line', { x1: '10', y1: '11', x2: '10', y2: '17' }],
		['line', { x1: '14', y1: '11', x2: '14', y2: '17' }]
	];
	for (const [tag, attrs] of parts) {
		const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		svg.append(el);
	}
	return svg;
}

function HouseTags(h) {
	const tags = [];
	if (h.enabled === false) tags.push({ kind: 'disabled', label: 'Disabled' });
	else tags.push({ kind: 'enabled', label: 'Enabled' });
	if (h.working) tags.push({ kind: 'working', label: 'Working' });
	if (h.gaming) tags.push({ kind: 'gaming', label: 'Gaming' });
	if (h.enabled !== false) {
		if (h.waiting && h.waiting.kind === 'approval') tags.push({ kind: 'approval', label: 'Approval' });
		else if (h.waiting && h.waiting.kind === 'notify') tags.push({ kind: 'notify', label: 'Notify' });
	}
	if (h.slug === lastHouse) tags.push({ kind: 'viewed', label: 'Viewed' });
	return tags;
}

function WaitingHouses() {
	return allHouses.filter((h) => h.enabled !== false && h.waiting && h.waiting.kind);
}

function UpsertHouseRow(row) {
	if (!row || !row.slug) return;
	const i = allHouses.findIndex((x) => x.slug === row.slug);
	if (i >= 0) {
		allHouses[i] = { ...allHouses[i], ...row };
		return;
	}
	allHouses.push({ name: row.name || row.slug, ...row });
}

function ShowWaitingMenu(on) {
	waitingMenu.classList.toggle('hidden', !on);
	waitingBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
}

function ShowWorkingMenu(on) {
	workingMenu.classList.toggle('hidden', !on);
	workingBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
}

function WorkingHouses() {
	return allHouses.filter((h) => h.working).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function RenderWorkingWidget() {
	const list = WorkingHouses();
	workingWrap.classList.toggle('hidden', list.length === 0);
	if (!list.length) {
		ShowWorkingMenu(false);
		workingBtn.title = '';
		workingBtn.setAttribute('aria-label', 'Working');
		return;
	}
	const label = list.length === 1
		? list[0].name + ' is working'
		: list.length + ' houses are working';
	workingBtn.title = label;
	workingBtn.setAttribute('aria-label', label);
	workingMenu.replaceChildren();
	for (const h of list) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'waiting_item';
		btn.setAttribute('role', 'menuitem');
		const name = document.createElement('span');
		name.className = 'waiting_item_name';
		name.textContent = h.name || h.slug;
		btn.append(name);
		btn.addEventListener('click', () => {
			ShowWorkingMenu(false);
			OpenHouse(h.slug);
		});
		workingMenu.append(btn);
	}
}

function RenderWaitingWidget() {
	RenderWorkingWidget();
	const list = WaitingHouses();
	waitingWrap.classList.toggle('hidden', list.length === 0);
	if (!list.length) {
		ShowWaitingMenu(false);
		return;
	}
	waitingBtn.textContent = list.length > 9 ? '9+' : String(list.length);
	if (list.length === 1) {
		const kind = list[0].waiting.kind === 'approval' ? 'approval' : 'notify';
		waitingBtn.title = list[0].name + ' · ' + kind;
		waitingBtn.setAttribute('aria-label', list[0].name + ' needs you');
	} else {
		waitingBtn.title = list.length + ' houses need you';
		waitingBtn.setAttribute('aria-label', list.length + ' houses need you');
	}
	waitingMenu.replaceChildren();
	for (const h of list) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'waiting_item';
		btn.setAttribute('role', 'menuitem');
		const name = document.createElement('span');
		name.className = 'waiting_item_name';
		name.textContent = h.name;
		const text = document.createElement('span');
		text.className = 'waiting_item_text';
		const kind = h.waiting.kind === 'approval' ? 'Approval' : 'Notify';
		text.textContent = h.waiting.text ? kind + ' · ' + h.waiting.text : kind;
		btn.append(name, text);
		btn.addEventListener('click', () => {
			ShowWaitingMenu(false);
			OpenHouse(h.slug);
		});
		waitingMenu.append(btn);
	}
}

function ShowNotifyDialog(house) {
	const wait = house && house.waiting;
	if (!wait || wait.kind !== 'notify') return;
	document.getElementById('notify_title').textContent = (house.name || 'Agent') + ' requested you';
	document.getElementById('notify_text').textContent = wait.text || '';
	notifyOverlay.classList.remove('hidden');
}

function HideNotifyDialog() {
	notifyOverlay.classList.add('hidden');
}

function ShowNotifyIfWaiting(house) {
	if (!house || !house.waiting) return;
	if (house.waiting.kind === 'notify') ShowNotifyDialog(house);
	if (house.waiting.kind === 'approval') ShowApprovalIfWaiting(house);
}

function ShowTasks(open) {
	tasksOverlay.classList.toggle('hidden', !open);
	if (!open) ResetTaskForm();
}

function ShowApproval(open) {
	approvalOverlay.classList.toggle('hidden', !open);
	if (!open) {
		approvalTask = null;
		ShowStamp(false);
		document.getElementById('approval_dialog').removeAttribute('data-readonly');
	}
}

function ShowStamp(open) {
	stampOverlay.classList.toggle('hidden', !open);
	if (!open) {
		pendingStamp = '';
		document.getElementById('stamp_feedback').value = '';
	}
}

function ShowInspect(open) {
	inspectOverlay.classList.toggle('hidden', !open);
}

let calendarState = { days: {}, events: [], year: 0, month: 0 };
let calendarDay = '';
let contactsState = { path: 'contacts/', count: 0, items: [] };
let contactsLetter = '';
const CONTACT_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
let booksState = { path: 'library/', count: 0, items: [] };
let booksSearchTimer = 0;
let remindersState = { reminders: [], cap: 16 };
let pcTick = 0;
let turnStartedAt = 0;
let clockTimer = 0;
let clockDeg = { hour: 0, minute: 0, second: 0 };
let alarmState = { alarms: [], next: null };
let alarmTimer = 0;
let whiteboardState = { plans: { items: [] }, notes: { items: [] } };
let mdFile = '';
let mdFromPlaybook = false;

function Pad2(n) {
	return String(n).padStart(2, '0');
}

function TodayParts() {
	const d = new Date();
	return {
		year: d.getFullYear(),
		month: d.getMonth() + 1,
		date: d.getFullYear() + '-' + Pad2(d.getMonth() + 1) + '-' + Pad2(d.getDate()),
		time: Pad2(d.getHours()) + ':' + Pad2(d.getMinutes())
	};
}

function ShowCalendar(open) {
	calendarOverlay.classList.toggle('hidden', !open);
	if (!open) {
		ShowCalendarDay(false);
		ShowCalendarList(false);
		ShowCalendarEvent(false);
	}
}

function ShowCalendarDay(open) {
	calendarDayOverlay.classList.toggle('hidden', !open);
	if (!open) calendarDay = '';
}

function ShowCalendarList(open) {
	calendarListOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('calendar_list_msg').textContent = '';
}

function ShowCalendarEvent(open) {
	calendarEventOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('calendar_event_msg').textContent = '';
}

async function OpenCalendar() {
	if (!currentSlug) return;
	document.getElementById('calendar_msg').textContent = '';
	try {
		calendarState = await window.lociAPI.calendarState(currentSlug);
		PaintCalendar();
		ShowCalendar(true);
	} catch (err) {
		document.getElementById('calendar_msg').textContent = IpcErrorText(err, 'Could not open the calendar.');
		ShowCalendar(true);
	}
}

function MonthCells(year, month) {
	const first = new Date(year, month - 1, 1);
	const start = new Date(year, month - 1, 1 - first.getDay());
	const today = TodayParts().date;
	const cells = [];
	for (let i = 0; i < 42; i++) {
		const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
		const ymd = d.getFullYear() + '-' + Pad2(d.getMonth() + 1) + '-' + Pad2(d.getDate());
		cells.push({
			ymd,
			day: d.getDate(),
			outside: d.getMonth() !== month - 1,
			today: ymd === today
		});
	}
	return cells;
}

function PaintCalendar() {
	const now = TodayParts();
	const year = calendarState.year || now.year;
	const month = calendarState.month || now.month;
	document.getElementById('calendar_title').textContent = MONTH_NAMES[month - 1] + ' ' + year;
	const weekdays = document.getElementById('calendar_weekdays');
	weekdays.replaceChildren();
	for (const letter of WEEKDAYS) {
		const el = document.createElement('span');
		el.textContent = letter;
		weekdays.append(el);
	}
	const grid = document.getElementById('calendar_grid');
	grid.replaceChildren();
	const days = calendarState.days || {};
	for (const cell of MonthCells(year, month)) {
		const box = document.createElement('div');
		box.className = 'cal_day';
		box.id = 'cal_day_' + cell.ymd;
		if (cell.outside) box.classList.add('outside_month');
		if (cell.today) box.classList.add('cal_today');
		const info = days[cell.ymd];
		if (info && info.events && info.events.length) box.classList.add('has_event');
		const num = document.createElement('button');
		num.type = 'button';
		num.className = 'cal_day_num';
		num.id = 'cal_day_' + cell.ymd + '_open';
		num.textContent = String(cell.day);
		num.addEventListener('click', () => OpenCalendarDay(cell.ymd));
		box.append(num);
		if (info && info.file) {
			const note = document.createElement('button');
			note.type = 'button';
			note.className = 'cal_day_note';
			note.id = 'cal_day_' + cell.ymd + '_note';
			note.setAttribute('aria-label', 'Open ' + cell.ymd);
			note.title = 'Open note';
			note.append(WindowIcon());
			note.addEventListener('click', (e) => {
				e.stopPropagation();
				OpenHouseFile('calendar/' + cell.ymd + '.md', document.getElementById('calendar_msg'));
			});
			box.append(note);
		}
		grid.append(box);
	}
}

function FormatEventStamp(at, timeOnly) {
	const raw = String(at || '').trim();
	const ymd = raw.slice(0, 10);
	const hm = raw.slice(11, 16);
	if (timeOnly) return hm;
	const y = Number(ymd.slice(0, 4));
	const mo = Number(ymd.slice(5, 7));
	const d = Number(ymd.slice(8, 10));
	const hh = Number(hm.slice(0, 2));
	const mm = Number(hm.slice(3, 5));
	const dt = new Date(y, mo - 1, d, hh, mm);
	if (!Number.isFinite(dt.getTime())) return raw;
	return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function FillCalEventList(list, rows, timeOnly, emptyText) {
	list.replaceChildren();
	if (!rows.length) {
		const empty = document.createElement('li');
		empty.className = 'cal_event_empty';
		empty.textContent = emptyText;
		list.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('li');
		item.className = 'cal_event_item';
		const body = document.createElement('div');
		body.className = 'cal_event_body';
		const at = document.createElement('time');
		at.className = 'cal_event_at';
		at.dateTime = row.at || '';
		at.textContent = FormatEventStamp(row.at, timeOnly);
		const text = document.createElement('p');
		text.className = 'cal_event_text';
		text.textContent = row.text || '';
		body.append(at, text);
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'mdl_drop';
		rm.setAttribute('aria-label', 'Remove ' + (row.text || row.at || 'event'));
		rm.title = 'Remove';
		rm.append(ArchiveIcon());
		rm.addEventListener('click', () => RemoveCalendarEvent(row));
		item.append(body, rm);
		list.append(item);
	}
}

function OpenCalendarDay(ymd) {
	ShowCalendarList(false);
	calendarDay = ymd;
	const info = (calendarState.days && calendarState.days[ymd]) || { events: [], file: false };
	const dt = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
	document.getElementById('calendar_day_title').textContent =
		dt.getDate() + ' ' + MONTH_NAMES[dt.getMonth()] + ' ' + dt.getFullYear();
	FillCalEventList(
		document.getElementById('calendar_day_events'),
		Array.isArray(info.events) ? info.events : [],
		true,
		'No events on this day.'
	);
	document.getElementById('calendar_day_msg').textContent = '';
	ShowCalendarDay(true);
}

function PaintEventList() {
	FillCalEventList(
		document.getElementById('calendar_list'),
		Array.isArray(calendarState.events) ? calendarState.events : [],
		false,
		'No events.'
	);
}

function OpenEventList() {
	ShowCalendarDay(false);
	document.getElementById('calendar_list_msg').textContent = '';
	PaintEventList();
	ShowCalendarList(true);
}

function OpenAddEvent(ymd) {
	const now = TodayParts();
	document.getElementById('calendar_event_date').value = ymd || now.date;
	document.getElementById('calendar_event_time').value = (ymd && ymd !== now.date) ? '09:00' : now.time;
	document.getElementById('calendar_event_text').value = '';
	document.getElementById('calendar_event_msg').textContent = '';
	ShowCalendarEvent(true);
	document.getElementById('calendar_event_text').focus();
}

async function SubmitCalendarEvent(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const date = document.getElementById('calendar_event_date').value;
	const time = document.getElementById('calendar_event_time').value;
	const text = document.getElementById('calendar_event_text').value.trim();
	if (!date || !time || !text) {
		document.getElementById('calendar_event_msg').textContent = 'Date, time, and text are required.';
		return;
	}
	const day = calendarDay;
	const listOpen = !calendarListOverlay.classList.contains('hidden');
	try {
		calendarState = await window.lociAPI.addEvent(currentSlug, { date, time, text });
		ShowCalendarEvent(false);
		PaintCalendar();
		if (day) OpenCalendarDay(day);
		if (listOpen) PaintEventList();
	} catch (err) {
		document.getElementById('calendar_event_msg').textContent = IpcErrorText(err, 'Could not add that event.');
	}
}

async function RemoveCalendarEvent(row) {
	if (!currentSlug || !row) return;
	const ok = await ConfirmAction({
		title: 'Remove event',
		message: 'Remove ' + (row.text || row.at || 'this event') + '?',
		detail: 'The entry is deleted from the EVENTS file. This cannot be undone.'
	});
	if (!ok) return;
	const day = calendarDay;
	const listOpen = !calendarListOverlay.classList.contains('hidden');
	try {
		calendarState = await window.lociAPI.removeEvent(currentSlug, { at: row.at, text: row.text });
		PaintCalendar();
		if (day) OpenCalendarDay(day);
		if (listOpen) PaintEventList();
	} catch (err) {
		const msg = listOpen
			? document.getElementById('calendar_list_msg')
			: document.getElementById('calendar_day_msg');
		msg.textContent = IpcErrorText(err, 'Could not remove that event.');
	}
}

function ShowContacts(open) {
	contactsOverlay.classList.toggle('hidden', !open);
	if (!open) ShowContactsForm(false);
}

function ShowContactsForm(open) {
	contactsFormOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('contacts_form_msg').textContent = '';
}

function VisibleContacts() {
	const items = Array.isArray(contactsState.items) ? contactsState.items : [];
	if (!contactsLetter) return items;
	return items.filter((row) => row.letter === contactsLetter);
}

function PaintContactsLetters() {
	const nav = document.getElementById('contacts_letters');
	nav.replaceChildren();
	const used = new Set((contactsState.items || []).map((row) => row.letter));
	const keys = [{ id: 'all', letter: '', label: 'All' }];
	for (const ch of CONTACT_LETTERS) keys.push({ id: ch, letter: ch, label: ch.toUpperCase() });
	keys.push({ id: 'hash', letter: '#', label: '#' });
	for (const key of keys) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.id = 'contacts_letter_' + key.id;
		btn.textContent = key.label;
		if (contactsLetter === key.letter) btn.classList.add('is-on');
		if (key.letter && !used.has(key.letter)) btn.classList.add('is-empty');
		btn.addEventListener('click', () => {
			contactsLetter = key.letter;
			PaintContacts();
		});
		nav.append(btn);
	}
}

function PaintContactsList() {
	const list = document.getElementById('contacts_list');
	list.replaceChildren();
	const rows = VisibleContacts();
	if (!rows.length) {
		const empty = document.createElement('li');
		empty.className = 'contacts_empty';
		empty.textContent = 'No contacts.';
		list.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('li');
		item.className = 'contacts_item';
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'contacts_item_open';
		open.setAttribute('aria-label', 'Show ' + row.name);
		const name = document.createElement('span');
		name.className = 'contacts_item_name';
		name.textContent = row.name || row.file;
		open.append(name);
		if (row.relation) {
			const relation = document.createElement('span');
			relation.className = 'contacts_item_relation';
			relation.textContent = row.relation;
			open.append(relation);
		}
		open.addEventListener('click', () => OpenHouseFile(row.file, document.getElementById('contacts_msg'), row.name));
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'mdl_drop';
		rm.setAttribute('aria-label', 'Remove ' + (row.name || row.file));
		rm.title = 'Remove';
		rm.append(ArchiveIcon());
		rm.addEventListener('click', () => RemoveAddressContact(row));
		item.append(open, rm);
		list.append(item);
	}
}

function PaintContacts() {
	PaintContactsLetters();
	PaintContactsList();
}

async function OpenContacts() {
	if (!currentSlug) return;
	document.getElementById('contacts_msg').textContent = '';
	contactsLetter = '';
	try {
		contactsState = await window.lociAPI.listContacts(currentSlug);
		PaintContacts();
		ShowContacts(true);
	} catch (err) {
		document.getElementById('contacts_msg').textContent = IpcErrorText(err, 'Could not open the address book.');
		ShowContacts(true);
	}
}

function OpenAddContact() {
	document.getElementById('contacts_name').value = '';
	document.getElementById('contacts_relation').value = '';
	document.getElementById('contacts_body').value = '';
	document.getElementById('contacts_form_msg').textContent = '';
	ShowContactsForm(true);
	document.getElementById('contacts_name').focus();
}

async function SubmitContact(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const name = document.getElementById('contacts_name').value.trim();
	const relation = document.getElementById('contacts_relation').value.trim();
	const body = document.getElementById('contacts_body').value;
	if (!name) {
		document.getElementById('contacts_form_msg').textContent = 'A name is required.';
		return;
	}
	try {
		const out = await window.lociAPI.createContact(currentSlug, { name, relation, body });
		contactsState = { path: out.path, count: out.count, items: out.items };
		contactsLetter = out.letter || '';
		ShowContactsForm(false);
		document.getElementById('contacts_msg').textContent = '';
		PaintContacts();
	} catch (err) {
		document.getElementById('contacts_form_msg').textContent = IpcErrorText(err, 'Could not add that contact.');
	}
}

async function RemoveAddressContact(row) {
	if (!currentSlug || !row) return;
	const ok = await ConfirmAction({
		title: 'Remove contact',
		message: 'Remove ' + (row.name || row.file) + '?',
		detail: 'The contact note is deleted from the address book. This cannot be undone.'
	});
	if (!ok) return;
	try {
		contactsState = await window.lociAPI.removeContact(currentSlug, row.file);
		document.getElementById('contacts_msg').textContent = '';
		PaintContacts();
	} catch (err) {
		document.getElementById('contacts_msg').textContent = IpcErrorText(err, 'Could not remove that contact.');
	}
}

function ShowBooks(open) {
	booksOverlay.classList.toggle('hidden', !open);
	if (!open) {
		ShowBooksForm(false);
		if (booksSearchTimer) {
			clearTimeout(booksSearchTimer);
			booksSearchTimer = 0;
		}
	}
}

function ShowBooksForm(open) {
	booksFormOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('books_form_msg').textContent = '';
}

function BooksFilters() {
	return {
		query: document.getElementById('books_query').value.trim(),
		order: document.getElementById('books_mode').value
	};
}

function BookMeta(row) {
	if (row.description) return row.description;
	if (Array.isArray(row.tags) && row.tags.length) return row.tags.join(', ');
	return row.source || '';
}

function PaintBookRow(list, row) {
	const item = document.createElement('li');
	item.className = 'books_item';
	const open = document.createElement('button');
	open.type = 'button';
	open.className = 'books_item_open';
	open.setAttribute('aria-label', 'Show ' + (row.title || row.file));
	const name = document.createElement('span');
	name.className = 'books_item_name';
	name.textContent = row.title || row.file;
	open.append(name);
	const meta = BookMeta(row);
	if (meta) {
		const extra = document.createElement('span');
		extra.className = 'books_item_meta';
		extra.textContent = meta;
		open.append(extra);
	}
	open.addEventListener('click', () => OpenHouseFile(row.file, document.getElementById('books_msg'), row.title));
	const rm = document.createElement('button');
	rm.type = 'button';
	rm.className = 'mdl_drop';
	rm.setAttribute('aria-label', 'Remove ' + (row.title || row.file));
	rm.title = 'Remove';
	rm.append(ArchiveIcon());
	rm.addEventListener('click', () => RemoveShelfBook(row));
	item.append(open, rm);
	list.append(item);
}

function PaintBooks() {
	const body = document.getElementById('books_body');
	body.replaceChildren();
	const list = document.createElement('ul');
	list.id = 'books_results';
	const rows = Array.isArray(booksState.items) ? booksState.items : [];
	if (!rows.length) {
		const empty = document.createElement('li');
		empty.className = 'books_empty';
		const filters = BooksFilters();
		empty.textContent = filters.query || filters.order === 'relevant' ? 'No matching books.' : 'No books.';
		list.append(empty);
	} else {
		for (const row of rows) PaintBookRow(list, row);
	}
	body.append(list);
}

async function RefreshBooks() {
	if (!currentSlug) return;
	try {
		booksState = await window.lociAPI.searchBooks(currentSlug, BooksFilters());
		document.getElementById('books_msg').textContent = '';
		PaintBooks();
	} catch (err) {
		document.getElementById('books_msg').textContent = IpcErrorText(err, 'Could not search the shelf.');
	}
}

function ScheduleBooksSearch() {
	if (booksSearchTimer) clearTimeout(booksSearchTimer);
	booksSearchTimer = setTimeout(() => {
		booksSearchTimer = 0;
		RefreshBooks();
	}, 180);
}

async function OpenBooks() {
	if (!currentSlug) return;
	document.getElementById('books_query').value = '';
	document.getElementById('books_mode').value = 'created';
	document.getElementById('books_msg').textContent = '';
	try {
		booksState = await window.lociAPI.searchBooks(currentSlug, BooksFilters());
		PaintBooks();
		ShowBooks(true);
		document.getElementById('books_query').focus();
	} catch (err) {
		document.getElementById('books_msg').textContent = IpcErrorText(err, 'Could not open the book shelf.');
		ShowBooks(true);
	}
}

function OpenAddBook() {
	document.getElementById('books_form_name').value = '';
	document.getElementById('books_form_tags').value = '';
	document.getElementById('books_form_description').value = '';
	document.getElementById('books_form_body').value = '';
	document.getElementById('books_form_msg').textContent = '';
	ShowBooksForm(true);
	document.getElementById('books_form_name').focus();
}

async function SubmitBook(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const title = document.getElementById('books_form_name').value.trim();
	const tags = document.getElementById('books_form_tags').value.trim();
	const description = document.getElementById('books_form_description').value.trim();
	const body = document.getElementById('books_form_body').value;
	if (!title) {
		document.getElementById('books_form_msg').textContent = 'A title is required.';
		return;
	}
	if (!body.trim()) {
		document.getElementById('books_form_msg').textContent = 'A body is required.';
		return;
	}
	try {
		await window.lociAPI.createBook(currentSlug, { title, tags, description, body });
		ShowBooksForm(false);
		await RefreshBooks();
	} catch (err) {
		document.getElementById('books_form_msg').textContent = IpcErrorText(err, 'Could not add that book.');
	}
}

async function RemoveShelfBook(row) {
	if (!currentSlug || !row) return;
	const ok = await ConfirmAction({
		title: 'Remove book',
		message: 'Remove ' + (row.title || row.file) + '?',
		detail: 'The book note is deleted from the library. This cannot be undone.'
	});
	if (!ok) return;
	try {
		await window.lociAPI.removeBook(currentSlug, row.file);
		await RefreshBooks();
	} catch (err) {
		document.getElementById('books_msg').textContent = IpcErrorText(err, 'Could not remove that book.');
	}
}

function ShowDiary(open) {
	diaryOverlay.classList.toggle('hidden', !open);
}

function ShowCabinet(open) {
	cabinetOverlay.classList.toggle('hidden', !open);
}

function ShowChest(open) {
	chestOverlay.classList.toggle('hidden', !open);
}

let storyRel = '';
let storyParent = null;

function ShowStories(open) {
	storyOverlay.classList.toggle('hidden', !open);
}

function PaintStories(board) {
	const list = document.getElementById('story_list');
	const where = document.getElementById('story_where');
	const actions = document.getElementById('story_actions');
	list.replaceChildren();
	storyRel = board && board.rel ? board.rel : '';
	storyParent = board && board.atRoot ? null : (board && board.parent != null ? board.parent : '');
	where.textContent = board && !board.atRoot ? board.path : '';
	actions.classList.toggle('hidden', !board || board.atRoot);
	const items = board && Array.isArray(board.items) ? board.items : [];
	if (!items.length) {
		const empty = document.createElement('li');
		empty.className = 'file_empty';
		empty.textContent = board && board.atRoot ? 'The story book is empty.' : 'Nothing in this folder yet.';
		list.append(empty);
		return;
	}
	for (const row of items) {
		const item = document.createElement('li');
		item.className = 'file_item';
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'file_item_open';
		open.setAttribute('aria-label', (row.kind === 'dir' ? 'Open ' : 'Show ') + row.name);
		const name = document.createElement('span');
		name.className = 'file_item_name';
		name.textContent = row.name;
		open.append(name);
		if (row.kind === 'dir') {
			const meta = document.createElement('span');
			meta.className = 'file_item_meta';
			meta.textContent = 'Folder';
			open.append(meta);
			open.addEventListener('click', () => LoadStories(row.rel));
		} else {
			open.addEventListener('click', () => OpenHouseFile(row.file, document.getElementById('story_msg'), row.name));
		}
		item.append(open);
		list.append(item);
	}
}

async function LoadStories(rel) {
	if (!currentSlug) return;
	document.getElementById('story_msg').textContent = '';
	try {
		const board = await window.lociAPI.listStories(currentSlug, rel || '');
		PaintStories(board);
		ShowStories(true);
	} catch (err) {
		document.getElementById('story_msg').textContent = IpcErrorText(err, 'Could not open the story book.');
		ShowStories(true);
	}
}

function OpenStories() {
	return LoadStories('');
}

function PaintFileList(list, items, emptyText, msgEl, onRemove) {
	list.replaceChildren();
	if (!items.length) {
		const empty = document.createElement('li');
		empty.className = 'file_empty';
		empty.textContent = emptyText;
		list.append(empty);
		return;
	}
	for (const row of items) {
		const item = document.createElement('li');
		item.className = 'file_item';
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'file_item_open';
		const label = row.title || row.name || row.date || row.file;
		open.setAttribute('aria-label', 'Show ' + label);
		const name = document.createElement('span');
		name.className = 'file_item_name';
		name.textContent = label;
		open.append(name);
		if (row.date && label !== row.date) {
			const meta = document.createElement('span');
			meta.className = 'file_item_meta';
			meta.textContent = row.date;
			open.append(meta);
		}
		open.addEventListener('click', () => OpenHouseFile(row.file, msgEl, row.title));
		item.append(open);
		if (onRemove) {
			const rm = document.createElement('button');
			rm.type = 'button';
			rm.className = 'mdl_drop';
			rm.setAttribute('aria-label', 'Remove ' + label);
			rm.title = 'Remove';
			rm.append(ArchiveIcon());
			rm.addEventListener('click', () => onRemove(row));
			item.append(rm);
		}
		list.append(item);
	}
}

async function OpenDiary() {
	if (!currentSlug) return;
	document.getElementById('diary_msg').textContent = '';
	try {
		const board = await window.lociAPI.listDiary(currentSlug);
		PaintFileList(
			document.getElementById('diary_list'),
			Array.isArray(board.items) ? board.items : [],
			'The diary is empty.',
			document.getElementById('diary_msg')
		);
		ShowDiary(true);
	} catch (err) {
		document.getElementById('diary_msg').textContent = IpcErrorText(err, 'Could not open the diary.');
		ShowDiary(true);
	}
}

async function OpenCabinet() {
	if (!currentSlug) return;
	document.getElementById('cabinet_msg').textContent = '';
	try {
		const board = await window.lociAPI.listCabinet(currentSlug);
		PaintFileList(
			document.getElementById('cabinet_list'),
			Array.isArray(board.items) ? board.items : [],
			'The filing cabinet is empty.',
			document.getElementById('cabinet_msg')
		);
		ShowCabinet(true);
	} catch (err) {
		document.getElementById('cabinet_msg').textContent = IpcErrorText(err, 'Could not open the filing cabinet.');
		ShowCabinet(true);
	}
}

async function RemoveChestRow(row) {
	if (!currentSlug || !row) return;
	const ok = await ConfirmAction({
		title: 'Remove file',
		message: 'Remove ' + (row.name || row.file) + '?',
		detail: 'The file is deleted from the chest. This cannot be undone.'
	});
	if (!ok) return;
	try {
		const out = await window.lociAPI.removeChestFile(currentSlug, row.file);
		document.getElementById('chest_msg').textContent = '';
		const items = out && out.board && Array.isArray(out.board.items) ? out.board.items : [];
		PaintFileList(
			document.getElementById('chest_list'),
			items,
			'The chest is empty.',
			document.getElementById('chest_msg'),
			RemoveChestRow
		);
	} catch (err) {
		document.getElementById('chest_msg').textContent = IpcErrorText(err, 'Could not remove that file.');
	}
}

async function OpenChest() {
	if (!currentSlug) return;
	document.getElementById('chest_msg').textContent = '';
	try {
		const board = await window.lociAPI.listChest(currentSlug);
		PaintFileList(
			document.getElementById('chest_list'),
			Array.isArray(board.items) ? board.items : [],
			'The chest is empty.',
			document.getElementById('chest_msg'),
			RemoveChestRow
		);
		ShowChest(true);
	} catch (err) {
		document.getElementById('chest_msg').textContent = IpcErrorText(err, 'Could not open the chest.');
		ShowChest(true);
	}
}

function RemainingLabel(due) {
	const dueMs = Date.parse(due);
	const n = Number.isFinite(dueMs) ? Math.max(0, Math.floor((dueMs - Date.now()) / 1000)) : 0;
	if (n <= 0) return 'due';
	if (n < 60) return n + 's';
	if (n < 3600) {
		const m = Math.floor(n / 60);
		const s = n % 60;
		return s ? m + 'm ' + s + 's' : m + 'm';
	}
	if (n < 86400) {
		const h = Math.floor(n / 3600);
		const m = Math.floor((n % 3600) / 60);
		return m ? h + 'h ' + m + 'm' : h + 'h';
	}
	const d = Math.floor(n / 86400);
	const h = Math.floor((n % 86400) / 3600);
	return h ? d + 'd ' + h + 'h' : d + 'd';
}

function StopPcTick() {
	if (pcTick) {
		clearInterval(pcTick);
		pcTick = 0;
	}
}

function ShowPc(open) {
	pcOverlay.classList.toggle('hidden', !open);
	if (!open) {
		ShowPcForm(false);
		StopPcTick();
	}
}

function ShowPcForm(open) {
	pcFormOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('pc_form_msg').textContent = '';
}

function PaintReminders() {
	const list = document.getElementById('pc_list');
	list.replaceChildren();
	const rows = Array.isArray(remindersState.reminders) ? remindersState.reminders : [];
	if (!rows.length) {
		const empty = document.createElement('li');
		empty.className = 'file_empty';
		empty.textContent = 'No reminders.';
		list.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('li');
		item.className = 'file_item';
		const body = document.createElement('div');
		body.className = 'file_item_open';
		const name = document.createElement('span');
		name.className = 'file_item_name';
		name.textContent = row.text || '';
		const meta = document.createElement('span');
		meta.className = 'file_item_meta';
		meta.textContent = RemainingLabel(row.due);
		body.append(name, meta);
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'mdl_drop';
		rm.setAttribute('aria-label', 'Cancel ' + (row.text || 'reminder'));
		rm.title = 'Cancel';
		rm.append(ArchiveIcon());
		rm.addEventListener('click', () => CancelHouseReminder(row));
		item.append(body, rm);
		list.append(item);
	}
}

function StartPcTick() {
	StopPcTick();
	pcTick = setInterval(PaintReminders, 1000);
}

async function OpenPc() {
	if (!currentSlug) return;
	document.getElementById('pc_msg').textContent = '';
	try {
		remindersState = await window.lociAPI.listReminders(currentSlug);
		PaintReminders();
		ShowPc(true);
		StartPcTick();
	} catch (err) {
		document.getElementById('pc_msg').textContent = IpcErrorText(err, 'Could not open reminders.');
		ShowPc(true);
	}
}

function OpenAddReminder() {
	document.getElementById('pc_form_text').value = '';
	document.getElementById('pc_form_in').value = '';
	document.getElementById('pc_form_msg').textContent = '';
	ShowPcForm(true);
	document.getElementById('pc_form_text').focus();
}

async function SubmitReminder(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const text = document.getElementById('pc_form_text').value.trim();
	const inn = document.getElementById('pc_form_in').value.trim();
	if (!text) {
		document.getElementById('pc_form_msg').textContent = 'Text is required.';
		return;
	}
	if (!inn) {
		document.getElementById('pc_form_msg').textContent = 'A duration is required (15m, 2h, 1d).';
		return;
	}
	try {
		remindersState = await window.lociAPI.addReminder(currentSlug, { text, in: inn });
		ShowPcForm(false);
		document.getElementById('pc_msg').textContent = '';
		PaintReminders();
	} catch (err) {
		document.getElementById('pc_form_msg').textContent = IpcErrorText(err, 'Could not add that reminder.');
	}
}

async function CancelHouseReminder(row) {
	if (!currentSlug || !row) return;
	const ok = await ConfirmAction({
		title: 'Cancel reminder',
		message: 'Cancel the reminder ' + (row.text || row.id) + '?',
		detail: 'The reminder is dropped and the agent will not be nudged.',
		ok: 'Cancel reminder',
		cancel: 'Keep'
	});
	if (!ok) return;
	try {
		remindersState = await window.lociAPI.cancelReminder(currentSlug, row.id);
		document.getElementById('pc_msg').textContent = '';
		PaintReminders();
	} catch (err) {
		document.getElementById('pc_msg').textContent = IpcErrorText(err, 'Could not cancel that reminder.');
	}
}

function EnsureClockTicks() {
	const g = document.getElementById('clock_ticks');
	if (g.childElementCount) return;
	const ns = 'http://www.w3.org/2000/svg';
	for (let i = 0; i < 60; i++) {
		const major = i % 5 === 0;
		const tick = document.createElementNS(ns, 'line');
		tick.setAttribute('x1', '50');
		tick.setAttribute('y1', '8');
		tick.setAttribute('x2', '50');
		tick.setAttribute('y2', major ? '15' : '11');
		tick.setAttribute('transform', 'rotate(' + (i * 6) + ' 50 50)');
		tick.setAttribute('class', major ? 'clock_tick_major' : 'clock_tick_minor');
		g.append(tick);
	}
}

function StopClockTick() {
	if (clockTimer) {
		clearTimeout(clockTimer);
		clockTimer = 0;
	}
	document.getElementById('clock_face').classList.remove('is-ticking');
}

function ShowClock(open) {
	clockOverlay.classList.toggle('hidden', !open);
	if (!open) StopClockTick();
}

function PaintClock() {
	const now = new Date();
	const hands = ClockHands(now);
	clockDeg = {
		hour: AdvanceDeg(clockDeg.hour, hands.hour),
		minute: AdvanceDeg(clockDeg.minute, hands.minute),
		second: AdvanceDeg(clockDeg.second, hands.second)
	};
	document.getElementById('clock_hour').style.transform = 'rotate(' + clockDeg.hour + 'deg)';
	document.getElementById('clock_minute').style.transform = 'rotate(' + clockDeg.minute + 'deg)';
	document.getElementById('clock_second').style.transform = 'rotate(' + clockDeg.second + 'deg)';
	document.getElementById('clock_digital').textContent = ClockDigital(now);
	const zone = ClockZone(now);
	document.getElementById('clock_zone').textContent = zone.timezone + ' · UTC' + zone.utc_offset;
	const elapsed = document.getElementById('clock_elapsed');
	const running = currentWorking && turnStartedAt > 0;
	elapsed.classList.toggle('hidden', !running);
	if (running) {
		elapsed.textContent = 'This turn: ' + FormatElapsed((Date.now() - turnStartedAt) / 1000);
	}
}

function StartClockTick() {
	StopClockTick();
	clockDeg = { hour: 0, minute: 0, second: 0 };
	PaintClock();
	document.getElementById('clock_face').classList.add('is-ticking');
	const step = () => {
		if (clockOverlay.classList.contains('hidden')) {
			clockTimer = 0;
			return;
		}
		PaintClock();
		clockTimer = setTimeout(step, 1000 - (Date.now() % 1000));
	};
	clockTimer = setTimeout(step, 1000 - (Date.now() % 1000));
}

async function OpenClock() {
	document.getElementById('clock_msg').textContent = '';
	EnsureClockTicks();
	turnStartedAt = 0;
	if (currentSlug) {
		try {
			const state = await window.lociAPI.clockState(currentSlug);
			currentWorking = !!state.working;
			turnStartedAt = state.working ? Number(state.turn_started_at) || 0 : 0;
			SyncChatButtons();
		} catch (err) {
			document.getElementById('clock_msg').textContent = IpcErrorText(err, 'Could not read the clock.');
		}
	}
	if (currentWorking && !turnStartedAt) turnStartedAt = Date.now();
	ShowClock(true);
	StartClockTick();
}

function AlarmNextLabel(key) {
	const raw = String(key || '');
	if (!raw) return '';
	const parts = raw.split('T');
	const day = parts[0] || '';
	const hm = parts[1] || '';
	const now = new Date();
	const today = now.getFullYear() + '-' + Pad2(now.getMonth() + 1) + '-' + Pad2(now.getDate());
	return day === today ? hm : raw.replace('T', ' ');
}

function StopAlarmTick() {
	if (alarmTimer) {
		clearTimeout(alarmTimer);
		alarmTimer = 0;
	}
}

function ShowAlarmClock(open) {
	alarmOverlay.classList.toggle('hidden', !open);
	if (!open) {
		ShowAlarmForm(false);
		StopAlarmTick();
	}
}

function ShowAlarmForm(open) {
	alarmFormOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('alarm_form_msg').textContent = '';
}

function SyncAlarmFormPreset() {
	const custom = document.getElementById('alarm_form_preset').value === 'custom';
	document.getElementById('alarm_form_text_label').classList.toggle('hidden', custom);
	document.getElementById('alarm_form_line_label').classList.toggle('hidden', !custom);
	if (custom) document.getElementById('alarm_form_line').focus();
	else document.getElementById('alarm_form_text').focus();
}

function AlarmPresetExpr(preset) {
	const line = NormalizeAlarmsText(ALARM_PRESETS[preset] || '');
	if (!line) return '';
	return line.split(/\s+/).slice(0, 5).join(' ');
}

function AlarmFormLine(expr, text) {
	const e = String(expr || '').trim();
	const t = String(text || '').trim();
	if (!e) return '';
	return t ? e + ' ' + JSON.stringify(t) : e;
}

function PaintAlarmTime() {
	const now = new Date();
	const parts = ClockParts(now);
	document.getElementById('alarm_hours').textContent = parts.hh;
	document.getElementById('alarm_minutes').textContent = parts.mm;
	document.getElementById('alarm_seconds').textContent = parts.ss;
	const zone = ClockZone(now);
	document.getElementById('alarm_zone').textContent = zone.timezone + ' · UTC' + zone.utc_offset;
}

function PaintAlarmList() {
	const list = document.getElementById('alarm_list');
	list.replaceChildren();
	const rows = Array.isArray(alarmState.alarms) ? alarmState.alarms : [];
	if (!rows.length) {
		const empty = document.createElement('li');
		empty.className = 'file_empty';
		empty.textContent = 'No alarms.';
		list.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('li');
		item.className = 'file_item';
		const body = document.createElement('div');
		body.className = 'file_item_open';
		const name = document.createElement('span');
		name.className = 'file_item_name';
		name.textContent = row.text || row.expr;
		body.append(name);
		const next = AlarmNextLabel(row.next);
		if (next) {
			const meta = document.createElement('span');
			meta.className = 'file_item_meta';
			meta.textContent = row.text ? row.expr + ' · next ' + next : 'next ' + next;
			body.append(meta);
		} else if (row.expr && row.text) {
			const meta = document.createElement('span');
			meta.className = 'file_item_meta';
			meta.textContent = row.expr;
			body.append(meta);
		}
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'mdl_drop';
		rm.setAttribute('aria-label', 'Remove ' + (row.text || row.expr));
		rm.title = 'Remove';
		rm.append(ArchiveIcon());
		rm.addEventListener('click', () => RemoveHouseAlarm(row));
		item.append(body, rm);
		list.append(item);
	}
}

function StartAlarmTick() {
	StopAlarmTick();
	PaintAlarmTime();
	const step = () => {
		if (alarmOverlay.classList.contains('hidden')) {
			alarmTimer = 0;
			return;
		}
		PaintAlarmTime();
		alarmTimer = setTimeout(step, 1000 - (Date.now() % 1000));
	};
	alarmTimer = setTimeout(step, 1000 - (Date.now() % 1000));
}

async function OpenAlarmClock() {
	if (!currentSlug) return;
	document.getElementById('alarm_msg').textContent = '';
	try {
		alarmState = await window.lociAPI.listAlarms(currentSlug);
		PaintAlarmList();
	} catch (err) {
		alarmState = { alarms: [], next: null };
		PaintAlarmList();
		document.getElementById('alarm_msg').textContent = IpcErrorText(err, 'Could not open the alarm clock.');
	}
	ShowAlarmClock(true);
	StartAlarmTick();
}

function OpenAddAlarm() {
	document.getElementById('alarm_form_preset').value = 'hourly';
	document.getElementById('alarm_form_text').value = '';
	document.getElementById('alarm_form_line').value = '';
	document.getElementById('alarm_form_msg').textContent = '';
	SyncAlarmFormPreset();
	ShowAlarmForm(true);
}

async function SubmitAlarm(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const preset = document.getElementById('alarm_form_preset').value;
	const line = preset === 'custom'
		? document.getElementById('alarm_form_line').value.trim()
		: AlarmFormLine(AlarmPresetExpr(preset), document.getElementById('alarm_form_text').value);
	if (!line) {
		document.getElementById('alarm_form_msg').textContent = preset === 'custom'
			? 'A crontab line is required.'
			: 'A schedule is required.';
		return;
	}
	try {
		alarmState = await window.lociAPI.addAlarm(currentSlug, line);
		ShowAlarmForm(false);
		document.getElementById('alarm_msg').textContent = '';
		PaintAlarmList();
	} catch (err) {
		document.getElementById('alarm_form_msg').textContent = IpcErrorText(err, 'Could not add that alarm.');
	}
}

async function RemoveHouseAlarm(row) {
	if (!currentSlug || !row || !row.expr) return;
	const ok = await ConfirmAction({
		title: 'Remove alarm',
		message: 'Remove ' + (row.text || row.expr) + '?',
		detail: 'The line is deleted from the ALARMS file and stops firing. This cannot be undone.'
	});
	if (!ok) return;
	try {
		alarmState = await window.lociAPI.removeAlarm(currentSlug, row.expr);
		document.getElementById('alarm_msg').textContent = '';
		PaintAlarmList();
	} catch (err) {
		document.getElementById('alarm_msg').textContent = IpcErrorText(err, 'Could not remove that alarm.');
	}
}

function ShowWhiteboard(open) {
	whiteboardOverlay.classList.toggle('hidden', !open);
	if (!open) {
		ShowPlanForm(false);
		ShowNoteForm(false);
	}
}

function ShowPlanForm(open) {
	planFormOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('plan_form_msg').textContent = '';
}

function ShowNoteForm(open) {
	noteFormOverlay.classList.toggle('hidden', !open);
	if (!open) document.getElementById('note_form_msg').textContent = '';
}

function PaintWhiteboardPlans() {
	const list = document.getElementById('whiteboard_plans_list');
	list.replaceChildren();
	const rows = Array.isArray(whiteboardState.plans && whiteboardState.plans.items)
		? whiteboardState.plans.items
		: [];
	if (!rows.length) {
		const empty = document.createElement('li');
		empty.className = 'file_empty';
		empty.textContent = 'No plans.';
		list.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('li');
		item.className = 'file_item';
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'file_item_open';
		open.setAttribute('aria-label', 'Show ' + (row.title || row.file));
		const name = document.createElement('span');
		name.className = 'file_item_name';
		name.textContent = row.title || row.file;
		open.append(name);
		open.addEventListener('click', () => OpenHouseFile(row.file, document.getElementById('whiteboard_msg'), row.title));
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'mdl_drop';
		rm.setAttribute('aria-label', 'Remove ' + (row.title || row.file));
		rm.title = 'Remove';
		rm.append(ArchiveIcon());
		rm.addEventListener('click', () => RemoveBoardRow('plan', row));
		item.append(open, rm);
		list.append(item);
	}
}

function PaintWhiteboardNotes() {
	const grid = document.getElementById('whiteboard_notes_grid');
	const empty = document.getElementById('whiteboard_notes_empty');
	grid.replaceChildren();
	const rows = Array.isArray(whiteboardState.notes && whiteboardState.notes.items)
		? whiteboardState.notes.items
		: [];
	empty.classList.toggle('hidden', rows.length > 0);
	for (const row of rows) {
		const item = document.createElement('li');
		item.className = 'sticky_item';
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'sticky_note';
		open.setAttribute('aria-label', 'Show ' + (row.title || row.file));
		const name = document.createElement('span');
		name.className = 'sticky_note_title';
		name.textContent = row.title || row.file;
		open.append(name);
		if (row.preview) {
			const body = document.createElement('span');
			body.className = 'sticky_note_body';
			body.textContent = row.preview;
			open.append(body);
		}
		open.addEventListener('click', () => OpenHouseFile(row.file, document.getElementById('whiteboard_msg'), row.title));
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'mdl_drop';
		rm.setAttribute('aria-label', 'Remove ' + (row.title || row.file));
		rm.title = 'Remove';
		rm.append(ArchiveIcon());
		rm.addEventListener('click', () => RemoveBoardRow('note', row));
		item.append(open, rm);
		grid.append(item);
	}
}

function PaintWhiteboard() {
	PaintWhiteboardPlans();
	PaintWhiteboardNotes();
}

async function OpenWhiteboard() {
	if (!currentSlug) return;
	document.getElementById('whiteboard_msg').textContent = '';
	try {
		whiteboardState = await window.lociAPI.listWhiteboard(currentSlug);
		PaintWhiteboard();
	} catch (err) {
		whiteboardState = { plans: { items: [] }, notes: { items: [] } };
		PaintWhiteboard();
		document.getElementById('whiteboard_msg').textContent = IpcErrorText(err, 'Could not open the whiteboard.');
	}
	ShowWhiteboard(true);
}

function OpenAddPlan() {
	document.getElementById('plan_form_name').value = '';
	document.getElementById('plan_form_body').value = '';
	document.getElementById('plan_form_msg').textContent = '';
	ShowPlanForm(true);
	document.getElementById('plan_form_name').focus();
}

function OpenAddNote() {
	document.getElementById('note_form_name').value = '';
	document.getElementById('note_form_body').value = '';
	document.getElementById('note_form_msg').textContent = '';
	ShowNoteForm(true);
	document.getElementById('note_form_name').focus();
}

async function SubmitPlan(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const title = document.getElementById('plan_form_name').value.trim();
	const body = document.getElementById('plan_form_body').value;
	if (!title) {
		document.getElementById('plan_form_msg').textContent = 'A title is required.';
		return;
	}
	if (!body.trim()) {
		document.getElementById('plan_form_msg').textContent = 'A plan body is required.';
		return;
	}
	try {
		whiteboardState = await window.lociAPI.createBoardItem(currentSlug, 'plan', { title, body });
		ShowPlanForm(false);
		document.getElementById('whiteboard_msg').textContent = '';
		PaintWhiteboard();
	} catch (err) {
		document.getElementById('plan_form_msg').textContent = IpcErrorText(err, 'Could not add that plan.');
	}
}

async function SubmitNote(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const title = document.getElementById('note_form_name').value.trim();
	const body = document.getElementById('note_form_body').value;
	if (!title) {
		document.getElementById('note_form_msg').textContent = 'A title is required.';
		return;
	}
	try {
		whiteboardState = await window.lociAPI.createBoardItem(currentSlug, 'note', { title, body });
		ShowNoteForm(false);
		document.getElementById('whiteboard_msg').textContent = '';
		PaintWhiteboard();
	} catch (err) {
		document.getElementById('note_form_msg').textContent = IpcErrorText(err, 'Could not add that note.');
	}
}

async function RemoveBoardRow(kind, row) {
	if (!currentSlug || !row || !row.file) return;
	const ok = await ConfirmAction({
		title: kind === 'plan' ? 'Remove plan' : 'Remove note',
		message: 'Remove ' + (row.title || row.file) + '?',
		detail: 'The ' + kind + ' is deleted from the whiteboard. This cannot be undone.'
	});
	if (!ok) return;
	try {
		whiteboardState = await window.lociAPI.removeBoardItem(currentSlug, kind, row.file);
		document.getElementById('whiteboard_msg').textContent = '';
		PaintWhiteboard();
	} catch (err) {
		document.getElementById('whiteboard_msg').textContent = IpcErrorText(err, 'Could not remove that ' + (kind === 'note' ? 'note' : 'plan') + '.');
	}
}

function SyncDevChrome() {
	const on = !!settingsCache.dev_mode;
	document.getElementById('dev_tools_btn').classList.toggle('hidden', !on);
	if (!on) ShowDevTools(false);
}

function ShowDevTools(open) {
	devOverlay.classList.toggle('hidden', !open);
}

let packsCache = [];
let packToolsId = '';

function ShowPacks(open) {
	packsOverlay.classList.toggle('hidden', !open);
	if (!open) ShowPackTools(false);
}

function ShowPackTools(open) {
	packToolsOverlay.classList.toggle('hidden', !open);
	if (!open) {
		packToolsId = '';
		ShowPackSet(false);
	}
}

function ShowPackSet(open) {
	packSetOverlay.classList.toggle('hidden', !open);
}

function ShowMcpJson(open) {
	mcpJsonOverlay.classList.toggle('hidden', !open);
}

function PackSafeId(id) {
	return String(id || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

function PackToggle(id, checked, opts) {
	const wrap = document.createElement('label');
	wrap.className = 'pack_toggle';
	const on = document.createElement('input');
	on.type = 'checkbox';
	on.id = id;
	on.checked = !!checked;
	if (opts && opts.disabled) on.disabled = true;
	if (opts && opts.label) on.setAttribute('aria-label', opts.label);
	on.addEventListener('click', (e) => e.stopPropagation());
	if (opts && opts.onChange) on.addEventListener('change', () => opts.onChange(on.checked));
	const track = document.createElement('span');
	track.className = 'pack_toggle_track';
	wrap.append(on, track);
	return wrap;
}

function PackNameStatusClass(row) {
	if (!row || !row.enabled || row.status === 'off') return 'pack_off';
	if (row.status === 'running') return 'pack_on';
	if (row.status === 'connecting') return 'pack_wait';
	if (row.status === 'error') return 'pack_err';
	return '';
}

function PacksFromIpc(out) {
	if (Array.isArray(out)) return { packs: out, mcpError: '', mcpWarnings: [] };
	return {
		packs: Array.isArray(out && out.packs) ? out.packs : [],
		mcpError: (out && out.mcpError) || '',
		mcpWarnings: Array.isArray(out && out.mcpWarnings) ? out.mcpWarnings : []
	};
}

function ShowPacksMcpNotice(info) {
	const el = document.getElementById('packs_msg');
	if (info.mcpError) el.textContent = info.mcpError;
	else if (info.mcpWarnings.length) el.textContent = info.mcpWarnings.join(' ');
	else el.textContent = '';
}

async function RefreshPacksStatus() {
	if (!currentSlug) return;
	try {
		const info = PacksFromIpc(await window.lociAPI.listPacks(currentSlug));
		PaintPacksList(info.packs);
		ShowPacksMcpNotice(info);
		await AwaitPacksWarm();
	} catch {
		// keep the last paint
	}
}

async function AwaitPacksWarm() {
	const slug = currentSlug;
	if (!slug) return;
	if (!packsCache.some((p) => p.status === 'connecting')) return;
	try {
		const info = PacksFromIpc(await window.lociAPI.waitPacksWarm(slug));
		if (currentSlug !== slug) return;
		PaintPacksList(info.packs);
		ShowPacksMcpNotice(info);
	} catch {
		// keep the last paint
	}
}

function MarkPackConnecting(packId) {
	const row = packsCache.find((p) => p.id === packId);
	if (!row || row.kind !== 'mcp' || !row.enabled) return;
	if (row.status === 'running' || row.status === 'error') return;
	row.status = 'connecting';
	row.statusLabel = 'Connecting';
	PaintPacksList(packsCache);
}

function PaintPacksList(rows) {
	packsCache = Array.isArray(rows) ? rows : [];
	const list = document.getElementById('packs_list');
	list.replaceChildren();
	for (const row of packsCache) {
		const item = document.createElement('li');
		item.className = 'pack_item';
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'pack_item_open';
		open.id = 'pack_open_' + PackSafeId(row.id);
		const name = document.createElement('span');
		name.className = 'pack_item_name';
		const statusClass = PackNameStatusClass(row);
		if (statusClass) name.classList.add(statusClass);
		name.textContent = row.name || row.id;
		name.title = row.statusLabel || '';
		const meta = document.createElement('span');
		meta.className = 'pack_item_meta';
		meta.textContent = row.kindLabel || (row.kind === 'mcp' ? 'MCP' : 'Native');
		open.append(name, meta);
		open.addEventListener('click', () => OpenPackTools(row.id, row.name || row.id));
		const toggle = PackToggle('pack_on_' + PackSafeId(row.id), row.enabled, {
			label: 'Enable ' + (row.name || row.id),
			onChange: (enabled) => TogglePack(row.id, enabled)
		});
		item.append(open, toggle);
		list.append(item);
	}
}

async function OpenPacks() {
	if (!currentSlug) return;
	PaintPacksList([]);
	document.getElementById('packs_msg').textContent = 'Loading…';
	ShowPacks(true);
	try {
		const info = PacksFromIpc(await window.lociAPI.listPacks(currentSlug));
		PaintPacksList(info.packs);
		ShowPacksMcpNotice(info);
		await AwaitPacksWarm();
	} catch (err) {
		document.getElementById('packs_msg').textContent = IpcErrorText(err, 'Could not load tool packs.');
	}
}

async function TogglePack(packId, enabled) {
	if (!currentSlug) return;
	document.getElementById('packs_msg').textContent = '';
	try {
		const rows = await window.lociAPI.setPack(currentSlug, packId, { enabled });
		PaintPacksList(rows);
		await AwaitPacksWarm();
		if (packToolsId === packId) {
			const row = packsCache.find((p) => p.id === packId);
			await OpenPackTools(packId, row ? row.name : packId);
		}
	} catch (err) {
		document.getElementById('packs_msg').textContent = IpcErrorText(err, 'Could not update pack.');
		OpenPacks();
	}
}

function SyncPackToolsChrome(packId) {
	const row = packsCache.find((p) => p.id === packId);
	document.getElementById('pack_tools_actions').classList.toggle('hidden', !row || row.kind !== 'mcp');
}

function PaintPackToolsList(packId, tools, packEnabled) {
	const list = document.getElementById('pack_tools_list');
	list.replaceChildren();
	const canToggle = packEnabled !== false;
	for (const row of tools || []) {
		const item = document.createElement('li');
		item.className = 'pack_tool_item';
		const label = document.createElement('span');
		label.className = 'pack_tool_label';
		const name = document.createElement('span');
		name.className = 'pack_tool_name';
		name.textContent = row.name;
		if (row.description) name.title = row.description;
		label.append(name);
		if (row.capability) {
			const meta = document.createElement('span');
			meta.className = 'pack_tool_meta';
			meta.textContent = row.capability;
			label.append(meta);
		}
		const toggle = PackToggle(
			'pack_tool_on_' + PackSafeId(packId) + '_' + PackSafeId(row.name),
			row.enabled !== false,
			{
				disabled: !canToggle,
				label: 'Enable ' + row.name,
				onChange: canToggle ? (enabled) => TogglePackTool(packId, row.name, enabled) : null
			}
		);
		item.append(label, toggle);
		list.append(item);
	}
}

async function OpenPackTools(packId, title) {
	if (!currentSlug) return;
	packToolsId = packId;
	document.getElementById('pack_tools_title').textContent = title || packId;
	document.getElementById('pack_tools_msg').textContent = 'Loading tools…';
	SyncPackToolsChrome(packId);
	const cached = packsCache.find((p) => p.id === packId);
	PaintPackToolsList(packId, [], cached ? cached.enabled : true);
	ShowPackTools(true);
	if (cached && cached.kind === 'mcp' && cached.enabled) MarkPackConnecting(packId);
	try {
		const out = await window.lociAPI.listPackTools(currentSlug, packId);
		if (packToolsId !== packId) return;
		await RefreshPacksStatus();
		if (!out || !out.ok) {
			document.getElementById('pack_tools_msg').textContent = (out && out.error) || 'Could not list tools.';
			PaintPackToolsList(packId, (out && out.tools) || [], out && out.packEnabled);
			return;
		}
		const tools = out.tools || [];
		let msg = '';
		if (out.note) msg = out.note;
		else if (out.error) msg = out.error;
		else if (!tools.length) msg = 'This pack has no tools yet.';
		document.getElementById('pack_tools_msg').textContent = msg;
		PaintPackToolsList(packId, tools, out.packEnabled);
	} catch (err) {
		if (packToolsId !== packId) return;
		await RefreshPacksStatus();
		document.getElementById('pack_tools_msg').textContent = IpcErrorText(err, 'Could not list tools.');
	}
}

async function TogglePackTool(packId, tool, enabled) {
	if (!currentSlug) return;
	const row = packsCache.find((p) => p.id === packId);
	if (row && !row.enabled) return;
	document.getElementById('pack_tools_msg').textContent = '';
	try {
		await window.lociAPI.setPack(currentSlug, packId, { tool, toolEnabled: enabled });
		await OpenPackTools(packId, row ? row.name : packId);
	} catch (err) {
		document.getElementById('pack_tools_msg').textContent = IpcErrorText(err, 'Could not update tool.');
	}
}

function JsonPretty(value, fallback) {
	try {
		return JSON.stringify(value != null ? value : fallback, null, '\t');
	} catch {
		return JSON.stringify(fallback);
	}
}

async function OpenPackSettings(packId) {
	document.getElementById('pack_set_msg').textContent = '';
	try {
		const cfg = await window.lociAPI.packSettings(packId);
		if (!cfg) {
			document.getElementById('pack_set_msg').textContent = 'This pack has no settings.';
			return;
		}
		document.getElementById('pack_set_title').textContent = (cfg.id || packId) + ' settings';
		document.getElementById('pack_set_id').value = cfg.id || packId;
		document.getElementById('pack_set_command').value = cfg.command || '';
		document.getElementById('pack_set_args').value = JsonPretty(cfg.args || [], []);
		document.getElementById('pack_set_cwd').value = cfg.cwd || '';
		document.getElementById('pack_set_env').value = JsonPretty(cfg.env || {}, {});
		ShowPackSet(true);
	} catch (err) {
		document.getElementById('pack_set_msg').textContent = IpcErrorText(err, 'Could not load pack settings.');
		ShowPackSet(true);
	}
}

async function SavePackSettings(e) {
	e.preventDefault();
	if (!currentSlug) return;
	const packId = document.getElementById('pack_set_id').value;
	document.getElementById('pack_set_msg').textContent = '';
	try {
		const out = await window.lociAPI.savePackSettings(currentSlug, packId, {
			command: document.getElementById('pack_set_command').value,
			args: document.getElementById('pack_set_args').value,
			cwd: document.getElementById('pack_set_cwd').value,
			env: document.getElementById('pack_set_env').value
		});
		if (out && out.packs) PaintPacksList(out.packs);
		ShowPackSet(false);
		await AwaitPacksWarm();
		if (packToolsId === packId) {
			const row = packsCache.find((p) => p.id === packId);
			await OpenPackTools(packId, row ? row.name : packId);
		}
	} catch (err) {
		document.getElementById('pack_set_msg').textContent = IpcErrorText(err, 'Could not save pack settings.');
	}
}

async function OpenMcpJson() {
	document.getElementById('mcp_json_msg').textContent = '';
	try {
		const file = await window.lociAPI.readMcpJson();
		document.getElementById('mcp_json_text_caption').textContent = 'Configure installed MCP servers (' + (file.path || '') + ')';
		document.getElementById('mcp_json_text').value = file.text || '';
		ShowMcpJson(true);
	} catch (err) {
		document.getElementById('mcp_json_msg').textContent = IpcErrorText(err, 'Could not open mcp.json.');
		ShowMcpJson(true);
	}
}

async function SaveMcpJson(e) {
	e.preventDefault();
	document.getElementById('mcp_json_msg').textContent = '';
	try {
		await window.lociAPI.writeMcpJson(document.getElementById('mcp_json_text').value);
		ShowMcpJson(false);
		if (currentSlug && !packsOverlay.classList.contains('hidden')) {
			const info = PacksFromIpc(await window.lociAPI.listPacks(currentSlug));
			PaintPacksList(info.packs);
			ShowPacksMcpNotice(info);
			await AwaitPacksWarm();
		}
	} catch (err) {
		document.getElementById('mcp_json_msg').textContent = IpcErrorText(err, 'Could not save mcp.json.');
	}
}

function FillDevToolSelect(names) {
	const sel = document.getElementById('dev_tool');
	const prev = sel.value;
	sel.replaceChildren();
	for (const name of names || []) {
		const opt = document.createElement('option');
		opt.value = name;
		opt.textContent = name;
		sel.append(opt);
	}
	if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function DevArgExample(name) {
	const examples = {
		read_file: { path: 'NOTES.md' },
		write_file: { path: 'NOTES.md', text: '', mode: 'replace' },
		edit_file: { path: 'NOTES.md', old_string: '', new_string: '' },
		search_files: { mode: 'glob', pattern: '**/*.md' },
		chat_history: { start: -1 },
		run_command: { command: '' },
		list_actions: { target: 'pc' },
		list_objects: {},
		send_action: {
			action: 'submit',
			target: 'approval_tray',
			payload: { task: 'title or file', work: 'what you did' }
		},
		get_state: {},
		get_screen: {},
		lock_body: {},
		system_prompt: {}
	};
	const body = Object.prototype.hasOwnProperty.call(examples, name) ? examples[name] : {};
	return JSON.stringify(body, null, '\t');
}

function ApplyDevArgExample() {
	document.getElementById('dev_args').value = DevArgExample(document.getElementById('dev_tool').value);
}

function ParseDevArgs() {
	const raw = document.getElementById('dev_args').value.trim();
	if (!raw) return {};
	const val = JSON.parse(raw);
	if (!val || typeof val !== 'object' || Array.isArray(val)) {
		throw new Error('Arguments must be a JSON object.');
	}
	return val;
}

async function OpenDevTools() {
	if (!currentSlug || !settingsCache.dev_mode) return;
	try {
		const names = await window.lociAPI.devTools(currentSlug);
		FillDevToolSelect(names);
		ApplyDevArgExample();
		document.getElementById('dev_msg').textContent = '';
		ShowDevTools(true);
	} catch (err) {
		AppendLine('house', IpcErrorText(err, 'Could not open Dev tools.'));
	}
}

function ResetTaskForm() {
	editingTaskFile = '';
	document.getElementById('task_title').value = '';
	document.getElementById('task_title').disabled = false;
	document.getElementById('task_body').value = '';
	document.getElementById('task_assign').textContent = 'Assign';
	document.getElementById('task_cancel').classList.add('hidden');
}

function LoadProgressTask(task) {
	editingTaskFile = task.file;
	document.getElementById('task_title').value = task.title || '';
	document.getElementById('task_title').disabled = true;
	document.getElementById('task_body').value = task.body || '';
	document.getElementById('task_form_msg').textContent = '';
	document.getElementById('task_assign').textContent = 'Save';
	document.getElementById('task_assign').disabled = false;
	document.getElementById('task_cancel').classList.remove('hidden');
}

function StampFeedbackDraft(task, verdict) {
	const title = task && task.title ? task.title : 'a task';
	if (verdict === 'change') {
		return 'I need some changes made to "' + title + '".';
	}
	return '';
}

function StampTitle(verdict) {
	if (verdict === 'change') return 'Change';
	if (verdict === 'drop') return 'Drop';
	return 'Approve';
}

function PickStamp(verdict) {
	if (!approvalTask) return;
	if (gameSlug) {
		document.getElementById('approval_msg').textContent = 'Approval is off while a game is connected.';
		return;
	}
	if (document.getElementById('approval_dialog').hasAttribute('data-readonly')) return;
	pendingStamp = verdict;
	document.getElementById('stamp_title').textContent = StampTitle(verdict);
	document.getElementById('stamp_msg').textContent = '';
	const box = document.getElementById('stamp_feedback');
	box.value = StampFeedbackDraft(approvalTask, verdict);
	approvalOverlay.classList.add('hidden');
	ShowStamp(true);
	box.focus();
}

function CancelStamp() {
	const resume = !!approvalTask;
	ShowStamp(false);
	if (resume) approvalOverlay.classList.remove('hidden');
}

function FormatStampTime(iso) {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return String(iso || '');
	return new Date(ms).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

function FillWorkList(entries) {
	const list = document.getElementById('approval_work_list');
	list.replaceChildren();
	if (!entries.length) {
		const empty = document.createElement('li');
		empty.className = 'approval_work_empty';
		empty.textContent = 'No work description yet.';
		list.append(empty);
		return;
	}
	for (const row of entries) {
		const li = document.createElement('li');
		li.className = 'approval_work_item';
		const at = document.createElement('time');
		at.className = 'approval_work_at';
		at.dateTime = row.at || '';
		at.textContent = row.at ? FormatStampTime(row.at) : '';
		const text = document.createElement('p');
		text.className = 'approval_work_text';
		text.textContent = row.text || '';
		li.append(at, text);
		list.append(li);
	}
}

function FillApprovalDialog(task, readonly) {
	approvalTask = task;
	ShowStamp(false);
	const dialog = document.getElementById('approval_dialog');
	dialog.toggleAttribute('data-readonly', !!readonly);
	const name = task.title || task.file || '';
	document.getElementById('approval_title').textContent = (readonly ? 'Completed: ' : 'Approval: ') + name;
	document.getElementById('approval_msg').textContent = '';
	const when = document.getElementById('approval_when');
	const workBox = document.getElementById('approval_work_box');
	const notesBox = document.getElementById('approval_notes_box');
	const bodyEl = document.getElementById('approval_body');
	const notesEl = document.getElementById('approval_notes');
	const gen = ++approvalFill;
	if (readonly) {
		workBox.classList.add('hidden');
		notesBox.classList.add('hidden');
		bodyEl.classList.remove('hidden');
		when.textContent = task.stamped_at
			? 'Approved ' + FormatStampTime(task.stamped_at)
			: '';
		bodyEl.replaceChildren();
		PaintMarkdown(bodyEl, task.markdown, gen);
	} else {
		when.textContent = '';
		bodyEl.classList.add('hidden');
		bodyEl.replaceChildren();
		workBox.classList.remove('hidden');
		FillWorkList(Array.isArray(task.work_log) ? task.work_log : []);
		const notes = String(task.body || '').trim();
		notesBox.classList.toggle('hidden', !notes);
		notesEl.replaceChildren();
		if (notes) PaintMarkdown(notesEl, notes, gen);
	}
	ShowApproval(true);
}

async function PaintMarkdown(el, src, gen) {
	try {
		const page = await window.lociAPI.renderMarkdown(src);
		if (gen != null && gen !== approvalFill) return;
		el.innerHTML = page.html || '';
	} catch {
		if (gen != null && gen !== approvalFill) return;
		el.textContent = String(src || '').trim();
	}
}

async function ShowApprovalIfWaiting(house) {
	const wait = house && house.waiting;
	if (!wait || wait.kind !== 'approval') return;
	try {
		const board = await window.lociAPI.listTasks(house.slug || currentSlug);
		FillTasksBoard(board);
		const task = (board.items || []).find((t) => t.file === wait.task)
			|| (board.items || []).find((t) => t.status === 'awaiting-approval');
		if (task) FillApprovalDialog(task, false);
	} catch {
		// board is optional here
	}
}

function TaskRow(task) {
	const li = document.createElement('li');
	const label = document.createElement('span');
	label.textContent = task.title || task.file;
	label.addEventListener('click', () => {
		if (task.status === 'in-progress') LoadProgressTask(task);
		else FillApprovalDialog(task, task.status === 'completed');
	});
	const rm = document.createElement('button');
	rm.type = 'button';
	rm.className = 'mdl_drop';
	rm.setAttribute('aria-label', 'Remove ' + (task.title || task.file));
	rm.title = 'Remove';
	rm.append(ArchiveIcon());
	rm.addEventListener('click', (e) => {
		e.stopPropagation();
		RemoveBoardTask(task);
	});
	li.append(label, rm);
	return li;
}

function RenderTaskColumn(listId, items) {
	const list = document.getElementById(listId);
	list.replaceChildren();
	if (!items.length) {
		const empty = document.createElement('li');
		empty.className = 'task_empty';
		empty.textContent = 'None';
		list.append(empty);
		return;
	}
	for (const task of items) list.append(TaskRow(task));
}

function FillTasksBoard(board) {
	taskBoard = board || { address: '', items: [], cap: 16, count: 0 };
	const items = Array.isArray(taskBoard.items) ? taskBoard.items : [];
	document.getElementById('task_address').textContent = taskBoard.assign_to
		|| (currentName ? 'Assign task to ' + currentName : 'Assign task');
	const cap = taskBoard.cap || 16;
	const full = items.length >= cap;
	if (!editingTaskFile) document.getElementById('task_assign').disabled = full;
	const msg = document.getElementById('task_form_msg');
	if (!editingTaskFile && full) {
		msg.textContent = 'Task Board is full (' + cap + '). Finish or remove a note before assigning another.';
	} else if (msg.textContent.startsWith('Task Board is full')) {
		msg.textContent = '';
	}
	if (editingTaskFile && !items.some((t) => t.file === editingTaskFile)) ResetTaskForm();
	for (const col of TASK_COLUMNS) {
		RenderTaskColumn(col.listId, items.filter((t) => t.status === col.status));
	}
}

async function OpenTasksBoard() {
	if (!currentSlug) return;
	if (gameSlug) {
		statusEl.textContent = 'Task Board is off while a game is connected.';
		return;
	}
	try {
		const board = await window.lociAPI.listTasks(currentSlug);
		ResetTaskForm();
		document.getElementById('task_form_msg').textContent = '';
		FillTasksBoard(board);
		ShowTasks(true);
	} catch (err) {
		AppendLine('house', IpcErrorText(err, 'Could not open the Task Board.'));
	}
}

async function RemoveBoardTask(task) {
	if (!currentSlug || !task || !task.file) return;
	try {
		const res = await window.lociAPI.removeTask(currentSlug, task.file);
		if (!res || res.cancelled) return;
		if (approvalTask && approvalTask.file === task.file) ShowApproval(false);
		FillTasksBoard(res.board);
	} catch (err) {
		document.getElementById('task_form_msg').textContent = IpcErrorText(err, 'Could not remove task.');
	}
}

async function ConfirmStamp() {
	if (!currentSlug || !approvalTask || !pendingStamp) return;
	const verdict = pendingStamp;
	const note = document.getElementById('stamp_feedback').value.trim();
	try {
		const res = await window.lociAPI.stampTask(currentSlug, approvalTask.file, verdict, note);
		ShowApproval(false);
		if (res && res.board) FillTasksBoard(res.board);
	} catch (err) {
		document.getElementById('stamp_msg').textContent = IpcErrorText(err, 'Could not stamp.');
	}
}

function RenderRooms(catalog) {
	if (!catalog || !Array.isArray(catalog.rooms)) return;
	palaceCache = catalog;
	const roomsEl = document.getElementById('rooms');
	const objects = Array.isArray(catalog.objects) ? catalog.objects : [];
	roomsEl.replaceChildren();
	for (const room of catalog.rooms) {
		const card = document.createElement('article');
		card.id = 'room_' + room.id;
		card.className = 'room';
		card.dataset.room = room.id;
		const title = document.createElement('h3');
		title.className = 'room_name';
		title.textContent = room.name;
		const list = document.createElement('ul');
		list.className = 'room_objects';
		for (const obj of objects.filter((o) => o.room === room.id)) {
			const item = document.createElement('li');
			item.className = 'room_obj';
			item.dataset.object = obj.id;
			item.id = 'obj_' + obj.id;
			const nameBtn = document.createElement('button');
			nameBtn.type = 'button';
			nameBtn.className = 'room_obj_inspect';
			nameBtn.id = 'obj_' + obj.id + '_open';
			nameBtn.textContent = obj.name;
			nameBtn.addEventListener('click', () => {
				if (obj.ui) OpenObjectUi(obj);
				else OpenInspector(obj);
			});
			item.append(nameBtn);
			if (obj.ui) {
				const aboutBtn = document.createElement('button');
				aboutBtn.type = 'button';
				aboutBtn.className = 'room_obj_open';
				aboutBtn.id = 'obj_' + obj.id + '_inspect';
				aboutBtn.setAttribute('aria-label', 'About ' + obj.name);
				aboutBtn.append(InfoIcon());
				aboutBtn.addEventListener('click', () => OpenInspector(obj));
				item.append(aboutBtn);
			}
			list.append(item);
		}
		card.append(title, list);
		roomsEl.append(card);
	}
}

let playbookKind = 'rule';
let playbookStamp = '';
let playbookTimer = 0;
let playbookBusy = 0;

function StopPlaybookPoll() {
	if (!playbookTimer) return;
	clearInterval(playbookTimer);
	playbookTimer = 0;
}

function StartPlaybookPoll() {
	StopPlaybookPoll();
	playbookTimer = setInterval(PollPlaybook, 1000);
}

function ShowPlaybook(open) {
	document.getElementById('playbook_overlay').classList.toggle('hidden', !open);
	if (!open) {
		ShowPlaybookForm(false);
		StopPlaybookPoll();
	}
}

function ShowPlaybookForm(open) {
	document.getElementById('playbook_form_overlay').classList.toggle('hidden', !open);
}

function PlaybookDomId(prefix, toolPath) {
	return prefix + '_' + String(toolPath || '').replace(/[^a-zA-Z0-9]+/g, '_');
}

function PaintPlaybookColumn(listId, emptyText, rows) {
	const list = document.getElementById(listId);
	list.replaceChildren();
	if (!rows.length) {
		const empty = document.createElement('li');
		empty.className = 'playbook_empty';
		empty.textContent = emptyText;
		list.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('li');
		item.className = 'file_item';
		item.id = PlaybookDomId('playbook_row', row.path);
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'file_item_open';
		open.id = PlaybookDomId('playbook_open', row.path);
		const name = document.createElement('span');
		name.className = 'file_item_name';
		name.textContent = row.name || row.path;
		if (row.description) name.title = row.description;
		const mark = document.createElement('span');
		mark.className = 'file_item_meta';
		mark.textContent = row.scope === 'global' ? 'Global' : 'This house';
		open.append(name, mark);
		open.addEventListener('click', () => OpenPlaybookFile(row));
		const toggle = PackToggle(
			PlaybookDomId('playbook_on', row.path),
			row.enabled,
			{
				label: (row.enabled ? 'Disable ' : 'Enable ') + (row.name || row.path),
				onChange: (on) => SetPlaybookRow(row.path, on)
			}
		);
		toggle.addEventListener('click', (e) => e.stopPropagation());
		item.append(open, toggle);
		list.append(item);
	}
}

function PaintPlaybook(board) {
	const data = board || { rules: [], skills: [] };
	playbookStamp = data.stamp || '';
	PaintPlaybookColumn('playbook_rules_list', 'No rules yet.', data.rules || []);
	PaintPlaybookColumn('playbook_skills_list', 'No skills yet.', data.skills || []);
}

async function PollPlaybook() {
	if (!currentSlug || playbookBusy) return;
	if (document.getElementById('playbook_overlay').classList.contains('hidden')) return;
	try {
		const board = await window.lociAPI.listPlaybook(currentSlug);
		if (!board || board.stamp === playbookStamp) return;
		PaintPlaybook(board);
	} catch {
		// The next tick tries again. A failed poll should not clear the list.
	}
}

async function OpenPlaybookFile(row) {
	if (!currentSlug) return;
	try {
		const page = await window.lociAPI.readPlaybook(currentSlug, row.path);
		mdFromPlaybook = true;
		mdFile = page.file || row.path;
		const label = String(row.name || '').trim();
		document.getElementById('md_title').textContent = label || MarkdownViewerTitle(mdFile);
		document.getElementById('md_body').innerHTML = page.html || '';
		document.getElementById('md_msg').textContent = '';
		ShowMarkdown(true);
	} catch (err) {
		document.getElementById('playbook_msg').textContent = IpcErrorText(err, 'Could not open that file.');
	}
}

async function OpenPlaybook() {
	if (!currentSlug) return;
	document.getElementById('playbook_msg').textContent = '';
	ShowPlaybook(true);
	try {
		PaintPlaybook(await window.lociAPI.listPlaybook(currentSlug));
		StartPlaybookPoll();
	} catch (err) {
		document.getElementById('playbook_msg').textContent = IpcErrorText(err, 'Could not open the Rule Book.');
	}
}

async function SetPlaybookRow(toolPath, enabled) {
	playbookBusy += 1;
	try {
		const out = await window.lociAPI.setPlaybook(currentSlug, toolPath, enabled);
		document.getElementById('playbook_msg').textContent = out && out.warning ? out.warning : '';
	} catch (err) {
		document.getElementById('playbook_msg').textContent = IpcErrorText(err, 'Could not update that toggle.');
		try {
			PaintPlaybook(await window.lociAPI.listPlaybook(currentSlug));
		} catch {
			// The checkbox stays as the user left it until the next poll.
		}
	} finally {
		playbookBusy -= 1;
	}
}

function OpenPlaybookForm(kind) {
	playbookKind = kind === 'skill' ? 'skill' : 'rule';
	document.getElementById('playbook_form_title').textContent = playbookKind === 'skill' ? 'Add skill' : 'Add rule';
	document.getElementById('playbook_form').reset();
	document.getElementById('playbook_desc').placeholder = playbookKind === 'skill'
		? 'A brief description of the skill and when to use it'
		: 'A brief description of the rule';
	document.getElementById('playbook_scope_house').checked = true;
	document.getElementById('playbook_form_msg').textContent = '';
	ShowPlaybookForm(true);
	document.getElementById('playbook_name').focus();
}

async function SavePlaybookForm(event) {
	event.preventDefault();
	const scope = document.getElementById('playbook_scope_global').checked ? 'global' : 'house';
	document.getElementById('playbook_form_msg').textContent = '';
	try {
		await window.lociAPI.addPlaybook(currentSlug, {
			kind: playbookKind,
			scope,
			name: document.getElementById('playbook_name').value,
			description: document.getElementById('playbook_desc').value,
			body: document.getElementById('playbook_body').value
		});
		ShowPlaybookForm(false);
		PaintPlaybook(await window.lociAPI.listPlaybook(currentSlug));
	} catch (err) {
		document.getElementById('playbook_form_msg').textContent = FormErrorText(err, 'Could not save that file.');
	}
}

function ShowNotice(open) {
	document.getElementById('notice_overlay').classList.toggle('hidden', !open);
}

function NoticeWhen(iso) {
	const ms = Date.parse(iso || '');
	if (!Number.isFinite(ms)) return '';
	return new Date(ms).toLocaleString();
}

let noticeBoard = null;

function ShowPollForm(open) {
	document.getElementById('poll_form_overlay').classList.toggle('hidden', !open);
	if (!open) document.getElementById('poll_form_msg').textContent = '';
}

function ShowNoticeForm(open) {
	document.getElementById('notice_form_overlay').classList.toggle('hidden', !open);
	if (!open) document.getElementById('notice_form_msg').textContent = '';
}

function PaintOpenPoll(open) {
	const box = document.getElementById('notice_open');
	box.replaceChildren();
	if (!open) return;
	const head = document.createElement('div');
	head.id = 'notice_open_head';
	const label = document.createElement('span');
	label.textContent = 'Open poll';
	const when = document.createElement('span');
	when.textContent = 'Closes ' + NoticeWhen(open.closes_at);
	head.append(label, when);
	const question = document.createElement('p');
	question.id = 'notice_open_question';
	question.textContent = open.question;
	const bars = document.createElement('ol');
	bars.id = 'notice_open_bars';
	const tally = open.tally || {};
	const choices = open.choices || [];
	const total = choices.reduce((sum, c) => sum + (Number(tally[c]) || 0), 0);
	for (const choice of choices) {
		const n = Number(tally[choice]) || 0;
		const pct = total ? Math.round((n / total) * 100) : 0;
		const row = document.createElement('li');
		row.className = 'poll_bar';
		const label = document.createElement('span');
		label.className = 'poll_bar_label';
		label.textContent = choice;
		const count = document.createElement('span');
		count.className = 'poll_bar_count';
		count.tabIndex = 0;
		count.textContent = n + (n === 1 ? ' vote' : ' votes') + ' · ' + pct + '%';
		const names = (open.voters_by_choice && open.voters_by_choice[choice]) || [];
		const tip = document.createElement('span');
		tip.className = 'poll_bar_who';
		tip.setAttribute('role', 'tooltip');
		tip.textContent = names.length ? names.join(', ') : 'No votes yet';
		count.append(tip);
		const track = document.createElement('span');
		track.className = 'poll_bar_track';
		const fill = document.createElement('span');
		fill.className = 'poll_bar_fill';
		fill.style.setProperty('--share', pct + '%');
		track.append(fill);
		row.append(label, count, track);
		bars.append(row);
	}
	const foot = document.createElement('div');
	foot.id = 'notice_open_foot';
	const close = document.createElement('button');
	close.type = 'button';
	close.id = 'notice_close_btn';
	close.textContent = 'Close poll';
	close.addEventListener('click', () => NoticeClose());
	foot.append(close);
	box.append(head, question, bars, foot);
}

function PaintNotice(board) {
	noticeBoard = board;
	const list = document.getElementById('notice_list');
	const msg = document.getElementById('notice_msg');
	const pollBtn = document.getElementById('notice_poll_btn');
	const addBtn = document.getElementById('notice_add_btn');
	list.replaceChildren();
	msg.textContent = '';
	const grouped = !!(board && board.group);
	pollBtn.disabled = !grouped || !!(board && board.open);
	pollBtn.title = !grouped ? '' : (board.open ? 'Close the open poll first' : '');
	addBtn.disabled = !grouped;
	if (!grouped) {
		PaintOpenPoll(null);
		msg.textContent = 'This house is not in a group. Polls and notices are shared within a group.';
		return;
	}
	PaintOpenPoll(board.open);
	for (const notice of board.notices || []) {
		const li = document.createElement('li');
		li.className = 'notice_item';
		const meta = document.createElement('span');
		meta.className = 'notice_meta';
		meta.textContent = notice.author + ' · ' + NoticeWhen(notice.created_at);
		const text = document.createElement('p');
		text.className = 'notice_text';
		text.textContent = notice.text;
		li.append(meta, text);
		list.append(li);
	}
}

async function OpenNotice() {
	if (!currentSlug) return;
	try {
		PaintNotice(await window.lociAPI.noticeState(currentSlug));
		ShowNotice(true);
	} catch (err) {
		statusEl.textContent = IpcErrorText(err, 'Could not open the Notice Board.');
	}
}

async function NoticeClose() {
	const open = noticeBoard && noticeBoard.open;
	if (!open) return;
	const ok = await ConfirmAction({
		title: 'Close poll',
		message: 'Close "' + open.question + '" now?',
		detail: 'The votes so far are counted and the result is posted as a notice. The project managers are woken with it.',
		ok: 'Close poll',
		cancel: 'Keep open'
	});
	if (!ok) return;
	try {
		PaintNotice(await window.lociAPI.closePoll(currentSlug));
	} catch (err) {
		document.getElementById('notice_msg').textContent = IpcErrorText(err, 'Could not close the poll.');
	}
}

async function SubmitPollForm() {
	const question = document.getElementById('poll_question').value.trim();
	const choices = document.getElementById('poll_choices').value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
	const inn = document.getElementById('poll_in').value.trim() || '4h';
	try {
		PaintNotice(await window.lociAPI.openPoll(currentSlug, { question, choices, in: inn }));
		document.getElementById('poll_question').value = '';
		document.getElementById('poll_choices').value = '';
		ShowPollForm(false);
	} catch (err) {
		document.getElementById('poll_form_msg').textContent = FormErrorText(err, 'Could not open the poll.');
	}
}

async function SubmitNoticeForm() {
	const text = document.getElementById('notice_text').value.trim();
	try {
		PaintNotice(await window.lociAPI.addNotice(currentSlug, { text }));
		document.getElementById('notice_text').value = '';
		ShowNoticeForm(false);
	} catch (err) {
		document.getElementById('notice_form_msg').textContent = FormErrorText(err, 'Could not post the notice.');
	}
}

function OpenObjectUi(obj) {
	const ui = obj && obj.ui;
	if (ui === 'md') {
		const file = (obj.paths || []).find((p) => IsMarkdownRel(p));
		if (file) OpenMarkdown(file);
		return;
	}
	if (ui === 'tasks') OpenTasksBoard();
	if (ui === 'calendar') OpenCalendar();
	if (ui === 'contacts') OpenContacts();
	if (ui === 'books') OpenBooks();
	if (ui === 'cabinet') OpenCabinet();
	if (ui === 'chest') OpenChest();
	if (ui === 'stories') OpenStories();
	if (ui === 'pc') OpenPc();
	if (ui === 'clock') OpenClock();
	if (ui === 'alarm') OpenAlarmClock();
	if (ui === 'whiteboard') OpenWhiteboard();
	if (ui === 'diary') OpenDiary();
	if (ui === 'playbook') OpenPlaybook();
	if (ui === 'game') OpenGameConsole();
	if (ui === 'notices') OpenNotice();
}

function ShowGame(open) {
	document.getElementById('game_overlay').classList.toggle('hidden', !open);
}

function GameDialogOpen() {
	return !document.getElementById('game_overlay').classList.contains('hidden');
}

const SKILL_OFF = 'That skill is installed but not enabled. The agent can still read it.';

let gameProbe = null;
let gameSlug = '';
let gamePrefsTimer = 0;

function GameUrlValue() {
	return document.getElementById('game_url').value.trim();
}

function ProbeMatches() {
	return !!(gameProbe && gameProbe.slug === currentSlug && GameUrlValue() === gameProbe.baseUrl);
}

function SetGameLine(id, label, value) {
	const el = document.getElementById(id);
	el.replaceChildren();
	if (!value) return;
	const mark = document.createElement('strong');
	mark.textContent = label;
	el.append(mark, document.createTextNode(': ' + value));
}

function ShowGameProbe(name, skill) {
	SetGameLine('game_name', 'Game', name || '');
	SetGameLine('game_skill', 'Skill', skill || '');
}

function ApplyGameFields(st) {
	document.getElementById('game_url').value = st.baseUrl || st.defaultUrl || '';
	document.getElementById('game_idle').value = String(st.idleSec || 30);
	document.getElementById('game_idle_off').checked = !!st.idleOff;
	document.getElementById('game_rounds').value = String(st.maxToolRounds || 32);
	document.getElementById('game_cap').checked = st.capToolRounds === false;
}

function ReadGamePrefs() {
	return {
		url: GameUrlValue(),
		idle_sec: Number(document.getElementById('game_idle').value),
		idle_off: document.getElementById('game_idle_off').checked,
		max_tool_rounds: Number(document.getElementById('game_rounds').value),
		cap_off: document.getElementById('game_cap').checked
	};
}

function SaveGamePrefsSoon() {
	if (!currentSlug || !window.lociAPI || !window.lociAPI.gamePrefs) return;
	clearTimeout(gamePrefsTimer);
	gamePrefsTimer = setTimeout(() => {
		window.lociAPI.gamePrefs(currentSlug, ReadGamePrefs()).catch(() => {});
	}, 300);
}

function SyncGameIdleField() {
	const locked = document.getElementById('game_url').disabled;
	document.getElementById('game_idle').disabled = locked || document.getElementById('game_idle_off').checked;
	document.getElementById('game_rounds').disabled = locked || document.getElementById('game_cap').checked;
}

async function PaintGame(opts) {
	if (!currentSlug) return;
	const st = await window.lociAPI.gameStatus(currentSlug);
	const running = !!(st.gaming && st.yours);
	const other = !!(st.gaming && !st.yours);
	if (st.gaming && st.slug) gameSlug = st.slug;
	else gameSlug = '';
	if (running && st.baseUrl) {
		gameProbe = {
			slug: currentSlug,
			baseUrl: st.baseUrl,
			name: st.name || '',
			skill: st.skill || '',
			enabled: st.enabled !== false
		};
		ApplyGameFields(st);
	} else if (opts && opts.applyPrefs) ApplyGameFields(st);
	else if (!document.getElementById('game_url').value) {
		document.getElementById('game_url').value = st.defaultUrl || '';
	}
	const matched = ProbeMatches();
	if (running || matched) ShowGameProbe(gameProbe.name, gameProbe.skill);
	else ShowGameProbe('', '');
	const start = document.getElementById('game_start');
	if (running) {
		start.dataset.mode = 'stop';
		start.textContent = 'Stop';
		start.disabled = false;
	} else {
		start.dataset.mode = 'start';
		start.textContent = 'Start';
		start.disabled = other || !matched || !!currentWorking;
	}
	document.getElementById('game_connect').disabled = running || other;
	for (const id of ['game_url', 'game_idle_off', 'game_cap']) {
		document.getElementById(id).disabled = running || other;
	}
	SyncGameIdleField();
	SyncHouseActions();
	const status = document.getElementById('game_status');
	if (other) status.textContent = 'Another house is already in gaming mode.';
	else if (running) status.textContent = st.warning || (st.enabled === false ? SKILL_OFF : '');
	else if (matched && gameProbe.enabled === false) status.textContent = SKILL_OFF;
	else status.textContent = '';
}

async function OpenGameConsole() {
	ShowGame(true);
	try {
		await PaintGame({ applyPrefs: true });
		if (gameSlug && gameSlug !== currentSlug && window.lociAPI && window.lociAPI.alert) {
			const who = allHouses.find((h) => h.slug === gameSlug);
			const name = who && who.name ? who.name : gameSlug;
			await window.lociAPI.alert({
				title: 'Gaming mode',
				message: name + ' is already in gaming mode.'
			});
		}
	} catch (err) {
		document.getElementById('game_status').textContent = IpcErrorText(err, 'Could not open the Game Console.');
	}
}

function OpenInspector(obj) {
	if (!obj) return;
	document.getElementById('inspect_title').textContent = obj.name || 'Object';
	const blurb = document.getElementById('inspect_blurb');
	const text = obj.blurb ? String(obj.blurb).trim() : '';
	blurb.textContent = text;
	blurb.classList.toggle('hidden', !text);
	const paths = Array.isArray(obj.paths) ? obj.paths.filter((p) => String(p || '').trim()) : [];
	const list = document.getElementById('inspect_paths');
	list.replaceChildren();
	for (const raw of paths) {
		const rel = String(raw).trim();
		const row = document.createElement('li');
		row.className = 'inspect_path';
		const name = IsMarkdownRel(rel) ? document.createElement('button') : document.createElement('span');
		if (IsMarkdownRel(rel)) {
			name.type = 'button';
			name.addEventListener('click', () => OpenHouseFile(rel, document.getElementById('inspect_msg')));
		}
		name.className = 'inspect_path_name';
		name.textContent = rel;
		const show = document.createElement('button');
		show.type = 'button';
		show.className = 'inspect_path_show';
		show.textContent = 'Show in folder';
		show.addEventListener('click', () => RevealHousePath(rel));
		row.append(name, show);
		list.append(row);
	}
	list.classList.toggle('hidden', paths.length === 0);
	document.getElementById('inspect_empty').classList.toggle('hidden', paths.length > 0);
	document.getElementById('inspect_msg').textContent = '';
	ShowInspect(true);
}

function IsMarkdownRel(rel) {
	return /\.md$/i.test(String(rel || '').trim());
}

function MarkdownViewerTitle(rel) {
	const name = String(rel || '').replace(/\\/g, '/').split('/').pop() || 'file.md';
	return 'Markdown viewer: ' + name;
}

function ShowMarkdown(open) {
	mdOverlay.classList.toggle('hidden', !open);
	if (!open) {
		mdFile = '';
		mdFromPlaybook = false;
		document.getElementById('md_title').textContent = '';
		document.getElementById('md_body').replaceChildren();
		document.getElementById('md_msg').textContent = '';
	}
}

async function OpenMarkdown(rel, msgEl, title) {
	if (!currentSlug) return;
	const box = msgEl || document.getElementById('inspect_msg');
	try {
		const page = await window.lociAPI.readMarkdown(currentSlug, rel);
		mdFromPlaybook = false;
		mdFile = page.file || String(rel || '');
		const label = String(title || '').trim();
		document.getElementById('md_title').textContent = label || MarkdownViewerTitle(mdFile);
		document.getElementById('md_body').innerHTML = page.html || '';
		document.getElementById('md_msg').textContent = '';
		ShowMarkdown(true);
	} catch (err) {
		if (box) box.textContent = IpcErrorText(err, 'Could not open that file.');
	}
}

function OpenHouseFile(rel, msgEl, title) {
	if (IsMarkdownRel(rel)) return OpenMarkdown(rel, msgEl, title);
	return RevealHousePath(rel, msgEl);
}

async function RevealHousePath(rel, msgEl) {
	if (!currentSlug) return;
	try {
		await window.lociAPI.revealPath(currentSlug, rel);
	} catch (err) {
		const box = msgEl || document.getElementById('inspect_msg');
		if (box) box.textContent = IpcErrorText(err, 'Could not open that path.');
	}
}

function PaintTitlebar() {
	statusEl.textContent = appLabel;
}

function PoseCaption(pose) {
	const name = (pose && pose.name) || currentName || 'Agent';
	const activity = pose && pose.activity ? String(pose.activity).trim() : '';
	const st = pose && pose.status ? String(pose.status).trim() : '';
	// The status the agent set stays up until it clears it. Tool activity is shown after it.
	return [name, st, activity].filter(Boolean).join(' · ');
}

function ApplyPose(pose) {
	let fresh = '';
	if (pose) {
		fresh = pose.activity ? String(pose.activity).trim() : '';
		if (!fresh && pose.activity !== '' && lastPose && lastPose.activity) {
			pose = { ...pose, activity: lastPose.activity };
		}
		lastPose = pose;
	}
	const shown = pose || lastPose;
	const room = shown && shown.room ? shown.room : { id: 'office', name: 'Office' };
	const object = shown && shown.object ? shown.object : null;
	document.getElementById('house_pose').textContent = PoseCaption(shown);
	for (const el of document.querySelectorAll('#rooms .room')) {
		el.classList.toggle('is-here', el.dataset.room === room.id);
	}
	for (const el of document.querySelectorAll('#rooms .room_obj')) {
		el.classList.toggle('is-focus', object && el.dataset.object === object.id);
	}
	if (!fresh) return;
	if (poseTimer) {
		clearTimeout(poseTimer);
		poseTimer = 0;
	}
	poseTimer = setTimeout(() => {
		poseTimer = 0;
		if (!lastPose) return;
		lastPose = { ...lastPose, activity: '' };
		document.getElementById('house_pose').textContent = PoseCaption(lastPose);
	}, POSE_ACTIVITY_MS);
}

function HouseStatus(h) {
	const bits = [FormatAlarms(h.alarm_count), FormatEvents(h.event_count)];
	if (h.run_command) bits.push('Shell');
	// Show the setting itself, even without a group, so the card matches Manage House.
	if (h.project_manager) bits.push('Manager');
	if (h.group) bits.push(h.group);
	return bits.join(' · ');
}

function FormatEvents(count) {
	const n = Number(count) || 0;
	if (n <= 0) return 'Events off';
	return n === 1 ? '1 event' : n + ' events';
}

const ALARM_PRESETS = {
	off: '',
	'15m': '*/15 * * * * "house heartbeat"\n',
	hourly: '0 * * * * "house heartbeat"\n',
	daily: '0 9 * * * "house heartbeat"\n'
};

function FormatAlarms(count) {
	const n = Number(count) || 0;
	if (n <= 0) return 'Alarms off';
	return n === 1 ? '1 alarm' : n + ' alarms';
}

function NormalizeAlarmsText(text) {
	return String(text || '').replace(/\r\n/g, '\n').trim();
}

function GuessAlarmPreset(text) {
	const n = NormalizeAlarmsText(text);
	if (!n) return 'off';
	for (const [key, value] of Object.entries(ALARM_PRESETS)) {
		if (key === 'off') continue;
		if (n === NormalizeAlarmsText(value)) return key;
	}
	return 'custom';
}

function SetAlarmFields(text) {
	const body = text == null ? '' : String(text);
	document.getElementById('hf_alarms').value = body;
	const preset = GuessAlarmPreset(body);
	document.getElementById('hf_alarms_preset').value = preset;
	SyncAlarmsPreset(false);
}

function SyncAlarmsPreset(fill) {
	const preset = document.getElementById('hf_alarms_preset').value;
	document.getElementById('hf_alarms_wrap').classList.toggle('hidden', preset !== 'custom');
	if (fill && preset !== 'custom') {
		document.getElementById('hf_alarms').value = ALARM_PRESETS[preset] || '';
	}
}

function ReadAlarmsText() {
	const preset = document.getElementById('hf_alarms_preset').value;
	if (preset !== 'custom') return ALARM_PRESETS[preset] || '';
	return document.getElementById('hf_alarms').value;
}

function RenderWorkspaces() {
	const ul = document.getElementById('hf_workspaces');
	ul.replaceChildren();
	workspaces.forEach((dir, i) => {
		const li = document.createElement('li');
		const label = document.createElement('span');
		label.textContent = dir;
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'ghost';
		rm.textContent = 'Remove';
		rm.addEventListener('click', () => {
			workspaces = workspaces.filter((_, j) => j !== i);
			RenderWorkspaces();
		});
		li.append(label, rm);
		ul.append(li);
	});
}

function SyncCreateTemplates() {
	if (editingSlug) return;
	const name = document.getElementById('hf_name').value;
	const group = document.getElementById('hf_group').value;
	if (!soulTouched) {
		document.getElementById('hf_soul').value = FillHouseTemplate(templates['SOUL.md'], name, group);
	}
	if (!systemTouched) {
		document.getElementById('hf_system').value = FillHouseTemplate(templates['SYSTEM.md'], name, group);
	}
}

function ResetNewForm() {
	editingSlug = null;
	soulTouched = false;
	systemTouched = false;
	workspaces = [];
	document.getElementById('form_title').textContent = 'New House';
	document.getElementById('form_save').textContent = 'Create';
	document.getElementById('hf_name').value = '';
	document.getElementById('hf_name').disabled = false;
	document.getElementById('hf_description').value = '';
	document.getElementById('hf_group').value = '';
	SetAlarmFields('');
	document.getElementById('hf_agent_alarms').checked = true;
	document.getElementById('hf_agent_events').checked = true;
	document.getElementById('hf_agent_web').checked = true;
	document.getElementById('hf_manager').checked = false;
	document.getElementById('hf_max_turns').value = '0';
	document.getElementById('hf_boot').value = templates['BOOT.md'];
	document.getElementById('hf_logoff').value = templates['LOGOFF.md'];
	document.getElementById('hf_system').value = FillHouseTemplate(templates['SYSTEM.md'], '');
	document.getElementById('hf_soul').value = FillHouseTemplate(templates['SOUL.md'], '');
	document.getElementById('hf_user').value = templates['USER.md'];
	formMsg.textContent = '';
	FillHouseModelSelect('', '');
	RenderWorkspaces();
	SyncConfigButton();
}

function FillEditForm(house) {
	editingSlug = house.slug;
	soulTouched = true;
	systemTouched = true;
	workspaces = Array.isArray(house.workspaces) ? house.workspaces.slice() : [];
	document.getElementById('form_title').textContent = 'Manage ' + house.name;
	document.getElementById('form_save').textContent = 'Save';
	document.getElementById('hf_name').value = house.name;
	document.getElementById('hf_name').disabled = false;
	document.getElementById('hf_description').value = house.description || '';
	document.getElementById('hf_group').value = house.group || '';
	SetAlarmFields(house.alarms || '');
	document.getElementById('hf_agent_alarms').checked = house.agent_alarms !== false;
	document.getElementById('hf_agent_events').checked = house.agent_events !== false;
	document.getElementById('hf_agent_web').checked = house.agent_web !== false;
	document.getElementById('hf_manager').checked = house.project_manager === true;
	document.getElementById('hf_max_turns').value = String(house.max_turns || 0);
	document.getElementById('hf_boot').value = house.boot || '';
	document.getElementById('hf_logoff').value = house.logoff || '';
	document.getElementById('hf_system').value = house.system || '';
	document.getElementById('hf_soul').value = house.soul || '';
	document.getElementById('hf_user').value = house.user || '';
	formMsg.textContent = '';
	FillHouseModelSelect(house.provider, house.model);
	RenderWorkspaces();
	SyncConfigButton();
}

function SyncConfigButton() {
	const btn = document.getElementById('hf_config_open');
	const on = !!editingSlug;
	btn.disabled = !on;
	btn.title = on
		? 'Open the runtime JSON in the file manager'
		: 'Available after the house is created';
}

function ReadHouseForm() {
	const picked = ParseModelKey(document.getElementById('hf_model').value);
	return {
		name: document.getElementById('hf_name').value.trim(),
		description: document.getElementById('hf_description').value,
		group: document.getElementById('hf_group').value,
		alarms: ReadAlarmsText(),
		agent_alarms: document.getElementById('hf_agent_alarms').checked,
		agent_events: document.getElementById('hf_agent_events').checked,
		agent_web: document.getElementById('hf_agent_web').checked,
		project_manager: document.getElementById('hf_manager').checked,
		max_turns: Math.max(0, Math.floor(Number(document.getElementById('hf_max_turns').value) || 0)),
		workspaces: workspaces.slice(),
		provider: picked.provider,
		model: picked.model,
		boot: document.getElementById('hf_boot').value,
		logoff: document.getElementById('hf_logoff').value,
		system: document.getElementById('hf_system').value,
		soul: document.getElementById('hf_soul').value,
		user: document.getElementById('hf_user').value
	};
}

function HouseMatchesGroup(h, filter) {
	if (!filter) return true;
	const group = String(h.group || '').trim();
	if (filter === UNGROUPED) return !group;
	return group === filter;
}

function HouseNameOrder(a, b) {
	return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
		|| String(a.slug || '').localeCompare(String(b.slug || ''));
}

function FilteredHouses() {
	const rows = allHouses.filter((h) => HouseMatchesGroup(h, groupFilter) && HouseMatchesShow(h));
	rows.sort(houseSort === 'recent' ? HouseRecentOrder : HouseNameOrder);
	return rows;
}

function HouseMatchesShow(h) {
	if (houseShow === 'enabled') return h.enabled !== false;
	if (houseShow === 'disabled') return h.enabled === false;
	return true;
}

function HouseRecentOrder(a, b) {
	const at = houseViews[a.slug] || '';
	const bt = houseViews[b.slug] || '';
	if (at !== bt) {
		if (!at) return 1;
		if (!bt) return -1;
		return bt.localeCompare(at);
	}
	return HouseNameOrder(a, b);
}

function ListEmptyText() {
	if (!allHouses.length) return 'No houses yet.';
	const which = houseShow === 'enabled' ? 'enabled' : houseShow === 'disabled' ? 'disabled' : '';
	if (groupFilter && which) return 'No ' + which + ' houses in this group.';
	if (groupFilter) return 'No houses in this group.';
	if (which) return 'No ' + which + ' houses.';
	return 'No houses yet.';
}

function FillGroupFilter() {
	const sel = document.getElementById('group_filter');
	const named = [...new Set(allHouses.map((h) => String(h.group || '').trim()).filter(Boolean))];
	named.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	const hasUngrouped = allHouses.some((h) => !String(h.group || '').trim());
	sel.replaceChildren();
	const all = document.createElement('option');
	all.value = '';
	all.textContent = 'All groups';
	sel.append(all);
	if (hasUngrouped) {
		const o = document.createElement('option');
		o.value = UNGROUPED;
		o.textContent = 'Ungrouped';
		sel.append(o);
	}
	for (const g of named) {
		const o = document.createElement('option');
		o.value = g;
		o.textContent = g;
		sel.append(o);
	}
	if (![...sel.options].some((o) => o.value === groupFilter)) groupFilter = '';
	sel.value = groupFilter;
}

function RenderHouseCards(houses) {
	const wrap = document.getElementById('house_cards');
	wrap.replaceChildren();
	const empty = document.getElementById('list_empty');
	empty.classList.toggle('hidden', houses.length > 0);
	empty.textContent = ListEmptyText();
	for (const h of houses) {
		const card = document.createElement('article');
		card.className = 'house_card' + (h.enabled === false ? ' is-disabled' : '') + (h.enabled !== false && h.waiting ? ' is-waiting' : '');
		const titleRow = document.createElement('div');
		titleRow.className = 'house_title';
		const title = document.createElement('h3');
		title.textContent = h.name;
		titleRow.append(title);
		for (const st of HouseTags(h)) {
			const tag = document.createElement('span');
			tag.className = 'tag tag-' + st.kind;
			tag.textContent = st.label;
			titleRow.append(tag);
		}
		const archiveBtn = document.createElement('button');
		archiveBtn.type = 'button';
		archiveBtn.className = 'btn-archive';
		archiveBtn.title = 'Archive house';
		archiveBtn.setAttribute('aria-label', 'Archive ' + h.name);
		archiveBtn.append(ArchiveIcon());
		archiveBtn.addEventListener('click', () => ArchiveHouse(h));
		const desc = document.createElement('p');
		desc.className = 'desc';
		desc.textContent = h.description || 'No description';
		const meta = document.createElement('p');
		meta.className = 'meta';
		meta.textContent = HouseStatus(h);
		const actions = document.createElement('div');
		actions.className = 'card_actions';
		const viewBtn = document.createElement('button');
		viewBtn.type = 'button';
		viewBtn.textContent = 'View';
		if (h.enabled === false) viewBtn.disabled = true;
		else viewBtn.addEventListener('click', () => OpenHouse(h.slug));
		const manageBtn = document.createElement('button');
		manageBtn.type = 'button';
		manageBtn.className = 'btn-manage';
		manageBtn.textContent = 'Manage';
		manageBtn.addEventListener('click', () => EditHouse(h.slug));
		const toggleBtn = document.createElement('button');
		toggleBtn.type = 'button';
		toggleBtn.className = h.working ? 'btn-disable' : (h.enabled === false ? 'btn-enable' : 'btn-disable');
		toggleBtn.textContent = h.working ? 'Stop' : (h.enabled === false ? 'Enable' : 'Disable');
		toggleBtn.addEventListener('click', () => ToggleHouseEnabled(h));
		actions.append(viewBtn, manageBtn, toggleBtn);
		card.append(archiveBtn, titleRow, desc, meta, actions);
		wrap.append(card);
	}
}

async function ToggleHouseEnabled(h) {
	if (h.working) {
		await window.lociAPI.abortTurn(h.slug);
		return;
	}
	await window.lociAPI.updateHouse(h.slug, { enabled: h.enabled === false });
	await ShowList();
}

async function ArchiveHouse(h) {
	try {
		const result = await window.lociAPI.archiveHouse(h.slug);
		if (!result || !result.archived) return;
		if (currentSlug === h.slug) currentSlug = '';
		await ShowList();
	} catch (err) {
		statusEl.textContent = IpcErrorText(err, 'Could not archive house.');
	}
}

async function ShowList() {
	manageFromHouse = false;
	const data = await window.lociAPI.listHouses();
	lastHouse = data.last_house || '';
	houseViews = data.house_views && typeof data.house_views === 'object' ? data.house_views : {};
	houseShow = data.house_show === 'enabled' || data.house_show === 'disabled' ? data.house_show : '';
	houseSort = data.house_sort === 'name' ? 'name' : 'recent';
	allHouses = data.houses;
	const gamingHouse = allHouses.find((h) => h.gaming);
	gameSlug = gamingHouse ? gamingHouse.slug : '';
	SyncHouseActions();
	RenderWaitingWidget();
	if (!allHouses.length) {
		ShowView('view_welcome');
		return;
	}
	FillGroupFilter();
	document.getElementById('house_show').value = houseShow;
	document.getElementById('house_sort').value = houseSort;
	RenderHouseCards(FilteredHouses());
	ShowView('view_list');
}

async function ShowNew() {
	manageFromHouse = false;
	templates = await window.lociAPI.houseTemplates();
	settingsCache = await window.lociAPI.getSettings();
	if (!CatalogHasModels(settingsCache)) {
		FillModelsForm(settingsCache);
		modelsMsg.textContent = 'Add at least one model before creating a house.';
		ShowModels(true);
		return;
	}
	ResetNewForm();
	ShowView('view_form');
}

async function EditHouse(slug) {
	settingsCache = await window.lociAPI.getSettings();
	const house = await window.lociAPI.getHouse(slug);
	FillEditForm(house);
	ShowView('view_form');
}

async function OpenHouse(slug) {
	const house = await window.lociAPI.openHouse(slug);
	if (gameProbe && gameProbe.slug !== house.slug) gameProbe = null;
	if (currentSlug !== house.slug) ClearPending();
	currentSlug = house.slug;
	currentName = house.name;
	currentWorking = !!house.working;
	lastHouse = house.slug;
	UpsertHouseRow({
		slug: house.slug,
		name: house.name,
		waiting: house.waiting || null,
		working: !!house.working
	});
	RenderWaitingWidget();
	ShowView('view_house');
	FillLog(house.log);
	RenderRooms(house.palace || palaceCache);
	ApplyPose(house.pose);
	SyncDevChrome();
	ShowNotifyIfWaiting(house);
}

document.getElementById('chat_form').addEventListener('submit', async (e) => {
	e.preventDefault();
	ShowChatMenu(false);
	if (currentWorking && currentSlug) {
		try {
			await window.lociAPI.abortTurn(currentSlug);
		} catch (err) {
			AppendLine('house', IpcErrorText(err, 'Could not stop.'));
		}
		return;
	}
	const input = document.getElementById('chat_input');
	const text = input.value.trim();
	const pics = pendingImages.slice();
	if ((!text && !pics.length) || !currentSlug) return;
	ShowAttachMenu(false);
	ClearPending();
	AppendLine('you', text, false, pics);
	input.value = '';
	currentWorking = true;
	if (!turnStartedAt) turnStartedAt = Date.now();
	SyncChatButtons();
	const slug = currentSlug;
	try {
		await window.lociAPI.sendChat(slug, text, pics);
	} catch (err) {
		currentWorking = false;
		turnStartedAt = 0;
		SyncChatButtons();
		AppendLine('house', IpcErrorText(err, 'Could not send.'));
		if (pics.length && currentSlug === slug && !pendingImages.length) {
			pendingImages = pics;
			PaintPending();
		}
	}
});

document.getElementById('chat_attach').addEventListener('click', (e) => {
	e.stopPropagation();
	if (document.getElementById('chat_attach').disabled) return;
	ShowAttachMenu(document.getElementById('chat_attach_menu').classList.contains('hidden'));
});

document.getElementById('chat_attach_image').addEventListener('click', async () => {
	ShowAttachMenu(false);
	const room = 4 - pendingImages.length;
	if (room <= 0) {
		statusEl.textContent = 'You can attach up to 4 images.';
		return;
	}
	const slug = currentSlug;
	try {
		const res = await window.lociAPI.pickImages(room);
		if (!res || currentSlug !== slug) return;
		if (res.error) {
			statusEl.textContent = res.error;
			return;
		}
		const got = Array.isArray(res.images) ? res.images : [];
		if (!got.length) return;
		pendingImages.push(...got.slice(0, room));
		statusEl.textContent = '';
		PaintPending();
	} catch (err) {
		statusEl.textContent = IpcErrorText(err, 'Could not attach that image.');
	}
});

document.getElementById('chat_pending_clear').addEventListener('click', () => ClearPending());

document.getElementById('chat_more').addEventListener('click', (e) => {
	e.stopPropagation();
	ShowChatMenu(document.getElementById('chat_menu').classList.contains('hidden'));
});

document.addEventListener('click', (e) => {
	if (!document.getElementById('chat_send_wrap').contains(e.target)) ShowChatMenu(false);
	if (!document.getElementById('chat_field').contains(e.target)) ShowAttachMenu(false);
	if (!waitingWrap.contains(e.target)) ShowWaitingMenu(false);
	if (!workingWrap.contains(e.target)) ShowWorkingMenu(false);
});

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		ShowChatMenu(false);
		ShowAttachMenu(false);
		ShowWaitingMenu(false);
		ShowWorkingMenu(false);
		if (!approvalOverlay.classList.contains('hidden')) {
			ShowApproval(false);
			return;
		}
		HideNotifyDialog();
		ShowTasks(false);
		ShowDevTools(false);
		ShowGame(false);
	}
});

document.getElementById('chat_redo').addEventListener('click', async () => {
	ShowChatMenu(false);
	if (!currentSlug || currentWorking) return;
	try {
		const res = await window.lociAPI.redoChat(currentSlug);
		if (!res || res.cancelled) return;
		currentWorking = true;
		SyncChatButtons();
		FillLog(res && res.log);
	} catch (err) {
		currentWorking = false;
		SyncChatButtons();
		AppendLine('house', IpcErrorText(err, 'Could not redo.'));
	}
});

document.getElementById('chat_clear').addEventListener('click', async () => {
	ShowChatMenu(false);
	if (!currentSlug || currentWorking || !chatLog.length) return;
	try {
		const res = await window.lociAPI.clearChat(currentSlug);
		if (res && res.cancelled) return;
		chatLog = [];
		chatShown = 0;
		logEl.replaceChildren();
		SyncChatButtons();
	} catch (err) {
		AppendLine('house', IpcErrorText(err, 'Could not clear.'));
	}
});

document.getElementById('settings_btn').addEventListener('click', async () => {
	FillSettings(await window.lociAPI.getSettings());
	ShowSettings(true);
});

document.getElementById('models_btn').addEventListener('click', async () => {
	FillModelsForm(await window.lociAPI.getSettings());
	ShowModels(true);
});

document.getElementById('settings_dismiss').addEventListener('click', () => CloseSettings());
document.getElementById('models_dismiss').addEventListener('click', () => ShowModels(false));

overlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === overlay) CloseSettings();
});

modelsOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === modelsOverlay) ShowModels(false);
});

document.getElementById('cfg_theme').addEventListener('change', async () => {
	ApplyTheme(document.getElementById('cfg_theme').value);
	try {
		await window.lociAPI.saveSettings(ReadSettingsForm());
	} catch {
		settingsMsg.textContent = 'Could not save settings.';
	}
});

document.getElementById('cfg_houses_browse').addEventListener('click', async () => {
	const dir = await window.lociAPI.openFolder();
	if (dir) document.getElementById('cfg_houses_root').value = dir;
});

settingsForm.addEventListener('submit', (e) => {
	e.preventDefault();
});

document.getElementById('mdl_anthropic_add').addEventListener('click', () => AddDraftModel('anthropic'));
document.getElementById('mdl_openai_add').addEventListener('click', () => AddDraftModel('openai'));
document.getElementById('mdl_openrouter_add').addEventListener('click', () => AddDraftModel('openrouter'));
document.getElementById('mdl_anthropic_input').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		AddDraftModel('anthropic');
	}
});
document.getElementById('mdl_openai_input').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		AddDraftModel('openai');
	}
});
document.getElementById('mdl_openrouter_input').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		AddDraftModel('openrouter');
	}
});

document.getElementById('models_form').addEventListener('submit', (e) => {
	e.preventDefault();
});

document.getElementById('welcome_new').addEventListener('click', () => ShowNew());
newHouseBtn.addEventListener('click', () => ShowNew());
housesBtn.addEventListener('click', () => ShowList());
waitingBtn.addEventListener('click', (e) => {
	e.stopPropagation();
	const open = waitingMenu.classList.contains('hidden');
	ShowWorkingMenu(false);
	ShowWaitingMenu(open);
});
workingBtn.addEventListener('click', (e) => {
	e.stopPropagation();
	const open = workingMenu.classList.contains('hidden');
	ShowWaitingMenu(false);
	ShowWorkingMenu(open);
});
document.getElementById('notify_ok').addEventListener('click', () => {
	HideNotifyDialog();
	document.getElementById('chat_input').focus();
});
notifyOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === notifyOverlay) HideNotifyDialog();
});
document.getElementById('inspect_dismiss').addEventListener('click', () => ShowInspect(false));
inspectOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === inspectOverlay) ShowInspect(false);
});
document.getElementById('md_dismiss').addEventListener('click', () => ShowMarkdown(false));
mdOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === mdOverlay) ShowMarkdown(false);
});
document.getElementById('md_reveal').addEventListener('click', () => {
	if (!mdFile) return;
	const globalLibrary = mdFile.startsWith('loci-rules/') || mdFile.startsWith('loci-skills/');
	if (mdFromPlaybook && globalLibrary) {
		window.lociAPI.revealPlaybook(currentSlug, mdFile).catch((err) => {
			document.getElementById('md_msg').textContent = IpcErrorText(err, 'Could not open that path.');
		});
		return;
	}
	RevealHousePath(mdFile, document.getElementById('md_msg'));
});
function OnMarkdownLink(e) {
	const a = e.target.closest('a');
	if (!a || !e.currentTarget.contains(a)) return;
	e.preventDefault();
	const href = String(a.getAttribute('href') || '');
	if (/^https?:\/\//i.test(href)) window.open(href);
}

document.getElementById('md_body').addEventListener('click', OnMarkdownLink);
document.getElementById('log').addEventListener('click', OnMarkdownLink);
document.getElementById('approval_notes').addEventListener('click', OnMarkdownLink);
document.getElementById('approval_body').addEventListener('click', OnMarkdownLink);
document.getElementById('calendar_dismiss').addEventListener('click', () => ShowCalendar(false));
calendarOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === calendarOverlay) ShowCalendar(false);
});
document.getElementById('calendar_add').addEventListener('click', () => OpenAddEvent());
document.getElementById('calendar_list_btn').addEventListener('click', () => OpenEventList());
document.getElementById('calendar_day_dismiss').addEventListener('click', () => ShowCalendarDay(false));
calendarDayOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === calendarDayOverlay) ShowCalendarDay(false);
});
document.getElementById('calendar_day_add').addEventListener('click', () => {
	if (calendarDay) OpenAddEvent(calendarDay);
});
document.getElementById('calendar_list_dismiss').addEventListener('click', () => ShowCalendarList(false));
calendarListOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === calendarListOverlay) ShowCalendarList(false);
});
document.getElementById('calendar_list_add').addEventListener('click', () => OpenAddEvent());
document.getElementById('calendar_event_dismiss').addEventListener('click', () => ShowCalendarEvent(false));
calendarEventOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === calendarEventOverlay) ShowCalendarEvent(false);
});
document.getElementById('calendar_event_form').addEventListener('submit', SubmitCalendarEvent);
document.getElementById('playbook_dismiss').addEventListener('click', () => ShowPlaybook(false));
document.getElementById('playbook_add_rule').addEventListener('click', () => OpenPlaybookForm('rule'));
document.getElementById('playbook_add_skill').addEventListener('click', () => OpenPlaybookForm('skill'));
document.getElementById('playbook_form_dismiss').addEventListener('click', () => ShowPlaybookForm(false));
document.getElementById('playbook_form').addEventListener('submit', SavePlaybookForm);
document.getElementById('playbook_overlay').addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target.id === 'playbook_overlay') ShowPlaybook(false);
});
document.getElementById('playbook_form_overlay').addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target.id === 'playbook_form_overlay') ShowPlaybookForm(false);
});
document.getElementById('contacts_dismiss').addEventListener('click', () => ShowContacts(false));
contactsOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === contactsOverlay) ShowContacts(false);
});
document.getElementById('contacts_add').addEventListener('click', () => OpenAddContact());
document.getElementById('contacts_form_dismiss').addEventListener('click', () => ShowContactsForm(false));
contactsFormOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === contactsFormOverlay) ShowContactsForm(false);
});
document.getElementById('contacts_form').addEventListener('submit', SubmitContact);
document.getElementById('books_dismiss').addEventListener('click', () => ShowBooks(false));
booksOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === booksOverlay) ShowBooks(false);
});
document.getElementById('books_query').addEventListener('input', ScheduleBooksSearch);
document.getElementById('books_query').addEventListener('search', RefreshBooks);
document.getElementById('books_mode').addEventListener('change', RefreshBooks);
document.getElementById('books_add').addEventListener('click', () => OpenAddBook());
document.getElementById('books_form_dismiss').addEventListener('click', () => ShowBooksForm(false));
booksFormOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === booksFormOverlay) ShowBooksForm(false);
});
document.getElementById('books_form').addEventListener('submit', SubmitBook);
document.getElementById('diary_dismiss').addEventListener('click', () => ShowDiary(false));
diaryOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === diaryOverlay) ShowDiary(false);
});
document.getElementById('cabinet_dismiss').addEventListener('click', () => ShowCabinet(false));

document.getElementById('notice_dismiss').addEventListener('click', () => ShowNotice(false));
document.getElementById('notice_overlay').addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target.id === 'notice_overlay') ShowNotice(false);
});
document.getElementById('notice_poll_btn').addEventListener('click', () => {
	ShowPollForm(true);
	document.getElementById('poll_question').focus();
});
document.getElementById('notice_add_btn').addEventListener('click', () => {
	ShowNoticeForm(true);
	document.getElementById('notice_text').focus();
});
document.getElementById('poll_form_dismiss').addEventListener('click', () => ShowPollForm(false));
document.getElementById('notice_form_dismiss').addEventListener('click', () => ShowNoticeForm(false));
document.getElementById('poll_form_overlay').addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target.id === 'poll_form_overlay') ShowPollForm(false);
});
document.getElementById('notice_form_overlay').addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target.id === 'notice_form_overlay') ShowNoticeForm(false);
});
document.getElementById('poll_form').addEventListener('submit', (e) => {
	e.preventDefault();
	SubmitPollForm();
});
document.getElementById('notice_form').addEventListener('submit', (e) => {
	e.preventDefault();
	SubmitNoticeForm();
});
cabinetOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === cabinetOverlay) ShowCabinet(false);
});
document.getElementById('chest_dismiss').addEventListener('click', () => ShowChest(false));
chestOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === chestOverlay) ShowChest(false);
});
document.getElementById('story_dismiss').addEventListener('click', () => ShowStories(false));
document.getElementById('story_back').addEventListener('click', () => LoadStories(storyParent || ''));
storyOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === storyOverlay) ShowStories(false);
});
document.getElementById('pc_dismiss').addEventListener('click', () => ShowPc(false));
pcOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === pcOverlay) ShowPc(false);
});
document.getElementById('pc_system').addEventListener('click', () => {
	OpenMarkdown('SYSTEM.md', document.getElementById('pc_msg'));
});
document.getElementById('pc_add').addEventListener('click', () => OpenAddReminder());
document.getElementById('pc_form_dismiss').addEventListener('click', () => ShowPcForm(false));
pcFormOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === pcFormOverlay) ShowPcForm(false);
});
document.getElementById('pc_form').addEventListener('submit', SubmitReminder);
document.getElementById('game_dismiss').addEventListener('click', () => ShowGame(false));
document.getElementById('game_overlay').addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === document.getElementById('game_overlay')) ShowGame(false);
});
document.getElementById('game_url').addEventListener('input', () => {
	SaveGamePrefsSoon();
	if (document.getElementById('game_start').dataset.mode === 'stop') return;
	if (gameProbe && GameUrlValue() !== gameProbe.baseUrl) {
		gameProbe = null;
		ShowGameProbe('', '');
		document.getElementById('game_start').disabled = true;
		const status = document.getElementById('game_status');
		if (status.textContent === SKILL_OFF) status.textContent = '';
	}
});
document.getElementById('game_idle').addEventListener('input', SaveGamePrefsSoon);
document.getElementById('game_rounds').addEventListener('input', SaveGamePrefsSoon);
document.getElementById('game_idle_off').addEventListener('change', () => {
	SyncGameIdleField();
	SaveGamePrefsSoon();
});
document.getElementById('game_cap').addEventListener('change', () => {
	SyncGameIdleField();
	SaveGamePrefsSoon();
});
document.getElementById('game_connect').addEventListener('click', async () => {
	if (!currentSlug) return;
	const status = document.getElementById('game_status');
	status.textContent = 'Connecting…';
	try {
		const out = await window.lociAPI.gameConnect(currentSlug, { baseUrl: GameUrlValue() });
		document.getElementById('game_url').value = out.baseUrl || GameUrlValue();
		gameProbe = {
			slug: currentSlug,
			baseUrl: document.getElementById('game_url').value.trim(),
			name: out.name || '',
			skill: out.skill || '',
			enabled: out.enabled === true
		};
		await PaintGame();
	} catch (err) {
		gameProbe = null;
		ShowGameProbe('', '');
		document.getElementById('game_start').disabled = true;
		status.textContent = IpcErrorText(err, 'Could not connect to the game.');
	}
});
document.getElementById('game_start').addEventListener('click', async () => {
	if (!currentSlug) return;
	const status = document.getElementById('game_status');
	const start = document.getElementById('game_start');
	const connect = document.getElementById('game_connect');
	if (start.dataset.mode === 'stop') {
		start.disabled = true;
		try {
			await window.lociAPI.gameStop(currentSlug);
			await PaintGame();
		} catch (err) {
			status.textContent = IpcErrorText(err, 'Could not leave gaming mode.');
			start.disabled = false;
		}
		return;
	}
	if (!ProbeMatches() || currentWorking) return;
	start.disabled = true;
	connect.disabled = true;
	status.textContent = 'Starting…';
	try {
		if (window.lociAPI.gamePrefs) await window.lociAPI.gamePrefs(currentSlug, ReadGamePrefs());
		await window.lociAPI.gameStart(currentSlug, {
			baseUrl: GameUrlValue(),
			idleSec: Number(document.getElementById('game_idle').value),
			idleOff: document.getElementById('game_idle_off').checked,
			maxToolRounds: Number(document.getElementById('game_rounds').value),
			capToolRounds: !document.getElementById('game_cap').checked
		});
		await PaintGame();
	} catch (err) {
		status.textContent = IpcErrorText(err, 'Could not start gaming mode.');
		start.disabled = !ProbeMatches() || !!currentWorking;
		connect.disabled = false;
	}
});
document.getElementById('clock_dismiss').addEventListener('click', () => ShowClock(false));
clockOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === clockOverlay) ShowClock(false);
});
document.getElementById('alarm_dismiss').addEventListener('click', () => ShowAlarmClock(false));
alarmOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === alarmOverlay) ShowAlarmClock(false);
});
document.getElementById('alarm_add').addEventListener('click', () => OpenAddAlarm());
document.getElementById('alarm_form_dismiss').addEventListener('click', () => ShowAlarmForm(false));
alarmFormOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === alarmFormOverlay) ShowAlarmForm(false);
});
document.getElementById('alarm_form_preset').addEventListener('change', SyncAlarmFormPreset);
document.getElementById('alarm_form').addEventListener('submit', SubmitAlarm);
document.getElementById('whiteboard_dismiss').addEventListener('click', () => ShowWhiteboard(false));
whiteboardOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === whiteboardOverlay) ShowWhiteboard(false);
});
document.getElementById('whiteboard_plan_add').addEventListener('click', () => OpenAddPlan());
document.getElementById('whiteboard_note_add').addEventListener('click', () => OpenAddNote());
document.getElementById('plan_form_dismiss').addEventListener('click', () => ShowPlanForm(false));
planFormOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === planFormOverlay) ShowPlanForm(false);
});
document.getElementById('plan_form').addEventListener('submit', SubmitPlan);
document.getElementById('note_form_dismiss').addEventListener('click', () => ShowNoteForm(false));
noteFormOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === noteFormOverlay) ShowNoteForm(false);
});
document.getElementById('note_form').addEventListener('submit', SubmitNote);
document.getElementById('assign_task_btn').addEventListener('click', () => {
	OpenTasksBoard();
});
document.getElementById('manage_house_btn').addEventListener('click', () => {
	if (!currentSlug) return;
	manageFromHouse = true;
	EditHouse(currentSlug);
});
document.getElementById('tool_packs_btn').addEventListener('click', () => {
	OpenPacks();
});
document.getElementById('packs_dismiss').addEventListener('click', () => ShowPacks(false));
packsOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === packsOverlay) ShowPacks(false);
});
document.getElementById('packs_open_mcp').addEventListener('click', () => {
	OpenMcpJson();
});
document.getElementById('pack_tools_dismiss').addEventListener('click', () => ShowPackTools(false));
packToolsOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === packToolsOverlay) ShowPackTools(false);
});
document.getElementById('pack_tools_settings').addEventListener('click', () => {
	if (packToolsId) OpenPackSettings(packToolsId);
});
document.getElementById('pack_set_dismiss').addEventListener('click', () => ShowPackSet(false));
packSetOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === packSetOverlay) ShowPackSet(false);
});
document.getElementById('pack_set_form').addEventListener('submit', SavePackSettings);
document.getElementById('mcp_json_dismiss').addEventListener('click', () => ShowMcpJson(false));
mcpJsonOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === mcpJsonOverlay) ShowMcpJson(false);
});
document.getElementById('mcp_json_form').addEventListener('submit', SaveMcpJson);
document.getElementById('dev_tools_btn').addEventListener('click', () => {
	OpenDevTools();
});
document.getElementById('dev_tool').addEventListener('change', () => {
	ApplyDevArgExample();
});
document.getElementById('dev_dismiss').addEventListener('click', () => ShowDevTools(false));
devOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === devOverlay) ShowDevTools(false);
});
document.getElementById('dev_form').addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!currentSlug || !settingsCache.dev_mode) return;
	const msg = document.getElementById('dev_msg');
	const out = document.getElementById('dev_result');
	msg.textContent = '';
	let args;
	try {
		args = ParseDevArgs();
	} catch (err) {
		msg.textContent = err && err.message ? String(err.message) : 'Invalid JSON.';
		return;
	}
	try {
		const tool = document.getElementById('dev_tool').value;
		const result = await window.lociAPI.devCall(currentSlug, tool, args);
		if (tool === 'system_prompt' && result && typeof result.text === 'string') {
			out.textContent = result.text;
		} else {
			out.textContent = JSON.stringify(result, null, '\t');
		}
		if (!tasksOverlay.classList.contains('hidden')) {
			try {
				FillTasksBoard(await window.lociAPI.listTasks(currentSlug));
			} catch {
				// board refresh is best-effort
			}
		}
	} catch (err) {
		msg.textContent = IpcErrorText(err, 'Could not run tool.');
	}
});
document.getElementById('tasks_dismiss').addEventListener('click', () => ShowTasks(false));
document.getElementById('task_cancel').addEventListener('click', () => {
	ResetTaskForm();
	FillTasksBoard(taskBoard);
});
tasksOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === tasksOverlay) ShowTasks(false);
});
document.getElementById('task_form').addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!currentSlug) return;
	const title = document.getElementById('task_title').value.trim();
	const body = document.getElementById('task_body').value;
	try {
		if (editingTaskFile) {
			const board = await window.lociAPI.updateTask(currentSlug, editingTaskFile, body);
			ResetTaskForm();
			document.getElementById('task_form_msg').textContent = '';
			FillTasksBoard(board);
			return;
		}
		if (!title) {
			document.getElementById('task_form_msg').textContent = 'A title is required.';
			return;
		}
		const board = await window.lociAPI.createTask(currentSlug, { title, body });
		ResetTaskForm();
		document.getElementById('task_form_msg').textContent = '';
		FillTasksBoard(board);
		const created = (board.items || []).find((t) => t.title === title && t.status === 'in-progress');
		const start = await ConfirmAction({
			title: 'Start this task',
			message: 'Should ' + (currentName || 'the agent') + ' start on "' + title + '" now?',
			detail: 'If not, the agent will start next time they wake and check the Task Board.',
			ok: 'Start now',
			cancel: 'Not now'
		});
		if (!start || !created) return;
		try {
			await window.lociAPI.sendNote(
				currentSlug,
				'System message: The user assigned "' + created.title + '" (tasks/' + created.file + '). Start on it now.',
				'task'
			);
		} catch (err) {
			document.getElementById('task_form_msg').textContent = 'Assigned, but the house was not woken. ' + IpcErrorText(err, '');
		}
	} catch (err) {
		document.getElementById('task_form_msg').textContent = IpcErrorText(err, 'Could not save.');
	}
});
document.getElementById('approval_good').addEventListener('click', () => PickStamp('good'));
document.getElementById('approval_change').addEventListener('click', () => PickStamp('change'));
document.getElementById('approval_drop').addEventListener('click', () => PickStamp('drop'));
document.getElementById('approval_dismiss').addEventListener('click', () => ShowApproval(false));
document.getElementById('stamp_confirm').addEventListener('click', () => ConfirmStamp());
document.getElementById('stamp_dismiss').addEventListener('click', () => CancelStamp());
approvalOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === approvalOverlay) ShowApproval(false);
});
stampOverlay.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;
	if (e.target === stampOverlay) CancelStamp();
});
document.getElementById('group_filter').addEventListener('change', () => {
	groupFilter = document.getElementById('group_filter').value;
	RenderHouseCards(FilteredHouses());
});
document.getElementById('house_show').addEventListener('change', () => {
	const value = document.getElementById('house_show').value;
	houseShow = value === 'enabled' || value === 'disabled' ? value : '';
	window.lociAPI.saveSettings({ house_show: houseShow });
	RenderHouseCards(FilteredHouses());
});
document.getElementById('house_sort').addEventListener('change', () => {
	houseSort = document.getElementById('house_sort').value === 'name' ? 'name' : 'recent';
	window.lociAPI.saveSettings({ house_sort: houseSort });
	RenderHouseCards(FilteredHouses());
});

document.getElementById('hf_alarms_preset').addEventListener('change', () => SyncAlarmsPreset(true));

document.getElementById('hf_name').addEventListener('input', SyncCreateTemplates);
document.getElementById('hf_group').addEventListener('input', SyncCreateTemplates);
document.getElementById('hf_soul').addEventListener('input', () => {
	soulTouched = true;
});
document.getElementById('hf_system').addEventListener('input', () => {
	systemTouched = true;
});

document.getElementById('hf_ws_add').addEventListener('click', async () => {
	const dir = await window.lociAPI.openFolder();
	if (!dir || workspaces.includes(dir)) return;
	workspaces.push(dir);
	RenderWorkspaces();
});

document.getElementById('hf_config_open').addEventListener('click', async () => {
	if (!editingSlug) return;
	try {
		await window.lociAPI.openHouseConfig(editingSlug);
	} catch (err) {
		formMsg.textContent = FormErrorText(err, 'Could not open config.');
	}
});

document.getElementById('form_cancel').addEventListener('click', () => {
	if (manageFromHouse && currentSlug) {
		const slug = currentSlug;
		manageFromHouse = false;
		OpenHouse(slug);
		return;
	}
	ShowList();
});

document.getElementById('house_form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const payload = ReadHouseForm();
	if (!payload.name) {
		formMsg.textContent = 'Name is required.';
		return;
	}
	if (!payload.model) {
		formMsg.textContent = 'Add at least one model under Models, then pick it here.';
		return;
	}
	try {
		if (editingSlug) {
			const slug = editingSlug;
			await window.lociAPI.updateHouse(slug, payload);
			formMsg.textContent = 'Saved.';
			if (manageFromHouse) {
				manageFromHouse = false;
				await OpenHouse(slug);
			} else {
				await ShowList();
			}
		} else {
			const house = await window.lociAPI.createHouse(payload);
			await OpenHouse(house.slug);
		}
	} catch (err) {
		formMsg.textContent = FormErrorText(err, 'Could not save house.');
	}
});

function ApplyHouseEvent(_n, payload) {
	if (!payload) return;
	if (payload.type === 'waiting-open' && payload.slug) {
		const row = allHouses.find((h) => h.slug === payload.slug);
		if (row && row.enabled === false) return;
		OpenHouse(payload.slug);
		return;
	}
	if (payload.type === 'working') {
		const patch = { slug: payload.slug, working: !!payload.working };
		if (payload.name) patch.name = payload.name;
		UpsertHouseRow(patch);
		if (!document.getElementById('view_list').classList.contains('hidden')) {
			RenderHouseCards(FilteredHouses());
		}
		RenderWorkingWidget();
		if (payload.slug === currentSlug) {
			currentWorking = !!payload.working;
			turnStartedAt = payload.working ? Number(payload.started) || Date.now() : 0;
			SyncChatButtons();
			if (!clockOverlay.classList.contains('hidden')) PaintClock();
		}
	}
	if (payload.type === 'waiting') {
		const patch = { slug: payload.slug, waiting: payload.waiting || null };
		if (payload.name) patch.name = payload.name;
		UpsertHouseRow(patch);
		RenderWaitingWidget();
		if (!document.getElementById('view_list').classList.contains('hidden')) {
			RenderHouseCards(FilteredHouses());
		}
		const viewing = payload.slug === currentSlug &&
			!document.getElementById('view_house').classList.contains('hidden');
		if (!payload.waiting) {
			if (viewing) {
				HideNotifyDialog();
				if (!approvalOverlay.classList.contains('hidden') && !document.getElementById('approval_dialog').hasAttribute('data-readonly')) {
					ShowApproval(false);
				}
			}
			return;
		}
		if (viewing && payload.waiting.kind === 'notify') {
			ShowNotifyDialog({
				slug: payload.slug,
				name: payload.name || currentName,
				waiting: payload.waiting
			});
		}
		if (viewing && payload.waiting.kind === 'approval') {
			ShowApprovalIfWaiting({
				slug: payload.slug,
				name: payload.name || currentName,
				waiting: payload.waiting
			});
		}
		return;
	}
	if (payload.type === 'pose') {
		if (payload.slug === currentSlug) ApplyPose(payload.pose);
		return;
	}
	if (payload.type === 'game') {
		for (const h of allHouses) h.gaming = !!(payload.gaming && h.slug === payload.slug);
		gameSlug = payload.gaming ? payload.slug : '';
		if (!document.getElementById('view_list').classList.contains('hidden')) {
			RenderHouseCards(FilteredHouses());
		}
		SyncHouseActions();
		if (GameDialogOpen()) PaintGame().catch(() => {});
		return;
	}
	if (payload.slug !== currentSlug) return;
	if (payload.type === 'speech') AppendLine(payload.name || currentName, payload.text);
	if (payload.type === 'note') AppendLine(NoteLabel(payload.from), payload.text, true);
	if (payload.type === 'error') AppendLine(currentName || 'Error', payload.text);
}

async function Boot() {
	const api = window.lociAPI;
	if (!api) {
		statusEl.textContent = 'preload missing';
		return;
	}
	try {
		const version = await api.getAppVersion();
		appLabel = `v${version}`;
		PaintTitlebar();
		FillDismissButtons();
		templates = await api.houseTemplates();
		settingsCache = await api.getSettings();
		ApplyTheme(settingsCache.theme);
		SyncDevChrome();
		api.on('house:event', ApplyHouseEvent);
		await ShowList();
	} catch (err) {
		statusEl.textContent = 'ipc error';
	}
}

Boot();
