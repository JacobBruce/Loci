import { app, BrowserWindow, ipcMain, shell, dialog, Menu, Notification, nativeImage } from 'electron';
import path from 'node:path';
import { LoadSettings, SaveSettings } from './settings.js';
import { ArchiveHouse, CreateHouse, DiaryBoard, ListHouses, LoadTemplates, ReadHouse, ReadHouseMarkdown, RevealHousePath, UpdateHouse } from './house.js';
import { MarkdownPage, RenderMarkdown } from './markdown.js';
import { ConfigPath, LoadHouseConfig, PatchHouseConfig, SeedHouseConfig } from './house-config.js';
import { AbortTurn, ClearChat, EnqueueChat, EnqueueDm, EnqueueRedo, EnqueueStamp, HouseBusy, IsWorking, StartAlarmsTick, TurnStartedAt } from './loop.js';
import { LoadSession, SpeechFromSession } from './session.js';
import { ClearApprovalWait, PalaceCatalog, PalacePose, PinGameConsole, WaitingOnUser } from './world.js';
import { BindGameLoop, GameStatus, GameToolExtra, GamingOn, HouseIsGaming, ProbeGame, StartGaming, StopGaming } from './game.js';
import { AlarmSummaries, SetAlarm, StopAlarm } from './alarms.js';
import { CabinetBoard, CreateTask, FormatStampWake, ListTasks, RemoveTask, StampTask, UpdateTaskNotes } from './tasks.js';
import { ChestBoard, RemoveChestFile } from './chest.js';
import { StoryBoard } from './stories.js';
import { CalendarState, SetEvent, StopEvent } from './events.js';
import { ContactsState, CreateContact, RemoveContact } from './contacts.js';
import { BooksBoard, CreateBook, RemoveBook, USER_BOOK_SOURCE } from './books.js';
import { CancelReminder, ListReminders, SetReminder } from './reminders.js';
import { CreateBoardItem, RemoveBoardItem, WhiteboardBoard } from './whiteboard.js';
import { BuildSystemPrompt, ToolContextFromHouse } from './prompt.js';
import { CallTool } from './tools.js';
import { ReadImageFile, MAX_IMAGES } from './images.js';
import { HouseToolSpecs, KickMcpForHouse, ListPacksForHouse, ListPackTools, PackSettings, SetPackForHouse } from './tool-packs.js';
import { CloseAllMcpSessions, CloseMcpSessionsForServer, CloseMcpSessionsForSlug, WaitMcpForSlug } from './mcp-client.js';
import { LociHome, LoadMcpConfig, ReadMcpText, UpdateMcpServer, WriteMcpText } from './mcp-store.js';
import { AddPlaybookItem, ListPlaybook, ReadPlaybookFile, RemovePlaybookItem, RevealPlaybookPath, SetPlaybookEnabled } from './playbook.js';
import { ThemeName } from './themes.js';
import { AddNotice, BoardForHouse, ClosePoll, OpenPoll } from './notices.js';

app.setName('Loci');

const ROOT = import.meta.dirname;
const THEME_CHROME = {
	brass: {
		icon: path.join(ROOT, '..', 'assets', 'logo', 'loci-brass.png'),
		window: '#2a2622'
	},
	blue: {
		icon: path.join(ROOT, '..', 'assets', 'logo', 'loci-blue.png'),
		window: '#101318'
	}
};
let win = null;
let appMenu = null;

function ThemeChrome() {
	return THEME_CHROME[ThemeName(LoadSettings().theme)];
}

function LoadWindowIcon(file) {
	const image = nativeImage.createFromPath(file || ThemeChrome().icon);
	return image.isEmpty() ? null : image;
}

function ApplyWindowTheme(target) {
	const chrome = ThemeChrome();
	if (target && !target.isDestroyed()) target.setBackgroundColor(chrome.window);
	ApplyWindowIcon(target, chrome.icon);
}

function ApplyWindowIcon(target, file) {
	const image = LoadWindowIcon(file);
	if (!image) return;
	if (target && !target.isDestroyed()) target.setIcon(image);
	if (process.platform === 'darwin' && app.dock) app.dock.setIcon(image);
}

function GetWin() {
	return win;
}

function HousesRoot() {
	return LoadSettings().houses_root;
}

function IsDevMode() {
	return !!LoadSettings().dev_mode;
}

function ApplyWindowChrome(w) {
	if (!w || w.isDestroyed()) return;
	const on = IsDevMode();
	if (process.platform !== 'darwin') {
		Menu.setApplicationMenu(on ? appMenu : null);
	}
	w.setMenuBarVisibility(on);
	w.setAutoHideMenuBar(!on);
	if (!on && w.webContents.isDevToolsOpened()) {
		w.webContents.closeDevTools();
	}
}

function EnableSpellcheck(w) {
	const ses = w.webContents.session;
	let available = [];
	try {
		available = ses.availableSpellCheckerLanguages || [];
	} catch {
		return;
	}
	if (!available.length) return;
	const locale = app.getLocale() || 'en-US';
	const base = locale.split('-')[0];
	const chosen = available.includes(locale)
		? locale
		: available.find((lang) => lang === base || lang.startsWith(base + '-'))
			|| (available.includes('en-US') ? 'en-US' : available[0]);
	try {
		ses.setSpellCheckerLanguages([chosen]);
	} catch {
		// an unknown code leaves Chromium's own choice
	}
}

function BindContextMenu(w) {
	w.webContents.on('context-menu', (_event, params) => {
		const items = [];
		for (const word of params.dictionarySuggestions || []) {
			items.push({
				label: word,
				click: () => {
					if (!w.isDestroyed()) w.webContents.replaceMisspelling(word);
				}
			});
		}
		if (params.misspelledWord) {
			if (items.length) items.push({ type: 'separator' });
			items.push({
				label: 'Add to dictionary',
				click: () => {
					if (!w.isDestroyed()) {
						w.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
					}
				}
			});
		}
		if (params.isEditable) {
			if (items.length) items.push({ type: 'separator' });
			items.push(
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				{ role: 'selectAll' }
			);
		} else if (params.selectionText) {
			if (items.length) items.push({ type: 'separator' });
			items.push({ role: 'copy' });
		}
		if (IsDevMode()) {
			if (items.length) items.push({ type: 'separator' });
			items.push({
				label: 'Inspect Element',
				click: () => {
					if (!w.isDestroyed()) w.webContents.inspectElement(params.x, params.y);
				}
			});
		}
		if (!items.length) return;
		Menu.buildFromTemplate(items).popup({ window: w });
	});
}

function CreateWindow() {
	win = new BrowserWindow({
		width: 1280,
		height: 800,
		resizable: true,
		backgroundColor: ThemeChrome().window,
		title: 'Loci',
		icon: ThemeChrome().icon,
		webPreferences: {
			spellcheck: true,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			preload: path.join(ROOT, 'preload.cjs')
		}
	});

	win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
	ApplyWindowTheme(win);
	ApplyWindowChrome(win);
	EnableSpellcheck(win);
	BindContextMenu(win);

	function RestoreMenuBar() {
		if (process.platform === 'darwin') return;
		ApplyWindowChrome(win);
	}
	// Linux: View → Toggle Full Screen dismisses the GTK menu first, so Electron
	// snapshots the bar as hidden and never restores it on exit (F11-only is fine).
	for (const ev of ['enter-full-screen', 'leave-full-screen', 'enter-html-full-screen', 'leave-html-full-screen']) {
		win.on(ev, () => { setTimeout(RestoreMenuBar, 0); });
	}

	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('https:') || url.startsWith('http:')) {
			shell.openExternal(url);
			return { action: 'deny' };
		}
		return { action: 'allow' };
	});

	win.on('close', (e) => {
		if (quitConfirmed) return;
		e.preventDefault();
		if (ConfirmQuit()) setImmediate(() => win.close());
	});
}

async function WarnMessage(opts) {
	const box = {
		type: 'warning',
		noLink: true,
		title: opts.title,
		message: opts.message,
		detail: opts.detail || '',
		buttons: ['OK']
	};
	const w = GetWin();
	if (w) await dialog.showMessageBox(w, box);
	else await dialog.showMessageBox(box);
}

async function PacksListPayload(slug, opts) {
	const house = ReadHouse(HousesRoot(), slug);
	if (opts && opts.warm) KickMcpForHouse(HousesRoot(), house);
	const mcp = LoadMcpConfig();
	const packs = await ListPacksForHouse(HousesRoot(), house);
	return {
		packs,
		mcpError: mcp.error || '',
		mcpWarnings: mcp.warnings || []
	};
}

async function ConfirmQuestion(opts) {
	const box = {
		type: 'question',
		noLink: true,
		title: opts.title,
		message: opts.message,
		detail: opts.detail || '',
		buttons: opts.buttons,
		defaultId: 1,
		cancelId: 1
	};
	const w = GetWin();
	const { response } = w
		? await dialog.showMessageBox(w, box)
		: await dialog.showMessageBox(box);
	return response === 0;
}

async function HandleDirOpen() {
	const w = GetWin();
	if (!w) return null;
	const { canceled, filePaths } = await dialog.showOpenDialog(w, {
		properties: ['openDirectory']
	});
	if (canceled) return null;
	return filePaths[0];
}

function HouseListPayload() {
	const cfg = LoadSettings();
	return {
		houses: ListHouses(cfg.houses_root).map((h) => ({
			...h,
			working: IsWorking(h.slug),
			gaming: HouseIsGaming(h.slug),
			waiting: WaitingOnUser(h.path)
		})),
		last_house: cfg.last_house,
		house_views: cfg.house_views,
		house_sort: cfg.house_sort,
		house_show: cfg.house_show,
		houses_root: cfg.houses_root
	};
}

function WithWaiting(house, extra) {
	return {
		...house,
		waiting: WaitingOnUser(house.path),
		...extra
	};
}

function MaybeOsNotify(payload) {
	if (!payload || payload.type !== 'waiting' || !payload.waiting) return;
	try {
		const house = ReadHouse(HousesRoot(), payload.slug);
		if (house.enabled === false) return;
	} catch {
		return;
	}
	const w = GetWin();
	if (w && !w.isDestroyed() && w.isFocused()) return;
	if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return;
	const kind = payload.waiting.kind === 'approval' ? 'Approval' : 'Notify';
	const title = (payload.name || 'Loci') + ' · ' + kind;
	const body = String(payload.waiting.text || '').trim() || 'Needs you';
	const note = new Notification({ title, body });
	note.on('click', () => {
		if (!w || w.isDestroyed()) return;
		if (w.isMinimized()) w.restore();
		w.show();
		w.focus();
		w.webContents.send('house:event', { type: 'waiting-open', slug: payload.slug });
	});
	note.show();
}

function EmitHouseEvent(payload) {
	MaybeOsNotify(payload);
	const w = GetWin();
	if (w && !w.isDestroyed()) w.webContents.send('house:event', payload);
}

function RegisterIpc() {
	BindGameLoop({
		enqueue(slug, text) {
			EnqueueChat(HousesRoot(), slug, text, EmitHouseEvent, 'game');
		},
		busy(slug) {
			return HouseBusy(slug);
		},
		pose(slug) {
			const house = ReadHouse(HousesRoot(), slug);
			const pose = PinGameConsole(house.path);
			EmitHouseEvent({ type: 'pose', slug, pose: { ...pose, name: house.name } });
		},
		changed(slug, gaming) {
			EmitHouseEvent({ type: 'game', slug, gaming: !!gaming });
		}
	});
	ipcMain.on('settings:theme', (event) => {
		event.returnValue = ThemeName(LoadSettings().theme);
	});
	ipcMain.handle('getAppVersion', () => app.getVersion());
	ipcMain.handle('settings:get', () => LoadSettings());
	ipcMain.handle('settings:save', (_event, payload) => {
		const saved = SaveSettings(payload);
		ApplyWindowChrome(GetWin());
		ApplyWindowTheme(GetWin());
		return saved;
	});
	ipcMain.handle('dialog:openFolder', HandleDirOpen);
	ipcMain.handle('ui:confirm', (_event, payload) => {
		const opts = payload || {};
		return ConfirmQuestion({
			title: String(opts.title || 'Confirm'),
			message: String(opts.message || 'Are you sure?'),
			detail: String(opts.detail || ''),
			buttons: [String(opts.ok || 'Remove'), String(opts.cancel || 'Cancel')]
		});
	});
	ipcMain.handle('houses:list', () => HouseListPayload());
	ipcMain.handle('houses:templates', () => LoadTemplates());
	ipcMain.handle('houses:get', (_event, slug) => {
		return WithWaiting(ReadHouse(HousesRoot(), slug));
	});
	ipcMain.handle('houses:create', (_event, payload) => {
		const house = CreateHouse(HousesRoot(), payload);
		SaveSettings({ last_house: house.slug });
		return house;
	});
	ipcMain.handle('houses:update', async (_event, slug, payload) => {
		const house = UpdateHouse(HousesRoot(), slug, payload);
		if (payload && payload.enabled === false) await CloseMcpSessionsForSlug(slug);
		return house;
	});
	ipcMain.handle('houses:open', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		const views = { ...(LoadSettings().house_views || {}), [slug]: new Date().toISOString() };
		SaveSettings({ last_house: slug, house_views: views });
		return WithWaiting(house, {
			log: SpeechFromSession(LoadSession(house.path)),
			working: IsWorking(slug),
			pose: { ...PalacePose(house.path), name: house.name },
			palace: PalaceCatalog()
		});
	});
	ipcMain.handle('houses:openConfig', (_event, slug) => {
		const housesRoot = HousesRoot();
		const house = ReadHouse(housesRoot, slug);
		SeedHouseConfig(housesRoot, house.slug);
		const p = ConfigPath(housesRoot, house.slug);
		shell.showItemInFolder(p);
		return { ok: true, path: p };
	});
	ipcMain.handle('house:reveal', (_event, slug, rel) => {
		const house = ReadHouse(HousesRoot(), slug);
		const target = RevealHousePath(house.path, rel);
		if (!target) throw new Error('That path is not in this house.');
		shell.showItemInFolder(target);
		return { ok: true, path: target };
	});
	ipcMain.handle('house:read', (_event, slug, rel) => {
		const house = ReadHouse(HousesRoot(), slug);
		const raw = ReadHouseMarkdown(house.path, rel);
		const page = MarkdownPage(raw.text);
		return { file: raw.file, html: page.html };
	});
	ipcMain.handle('markdown:render', (_event, src) => {
		return { html: RenderMarkdown(src) };
	});
	ipcMain.handle('diary:list', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return DiaryBoard(house.path);
	});
	ipcMain.handle('calendar:state', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		const now = new Date();
		return CalendarState(house.path, now.getFullYear(), now.getMonth() + 1);
	});
	ipcMain.handle('calendar:add', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		SetEvent(house.path, payload);
		const now = new Date();
		return CalendarState(house.path, now.getFullYear(), now.getMonth() + 1);
	});
	ipcMain.handle('calendar:remove', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		StopEvent(house.path, payload);
		const now = new Date();
		return CalendarState(house.path, now.getFullYear(), now.getMonth() + 1);
	});
	ipcMain.handle('notices:state', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return BoardForHouse(HousesRoot(), house, { live: true });
	});
	ipcMain.handle('notices:open', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		OpenPoll(HousesRoot(), house, payload || {}, 'user');
		return BoardForHouse(HousesRoot(), house, { live: true });
	});
	ipcMain.handle('notices:close', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		ClosePoll(HousesRoot(), house);
		return BoardForHouse(HousesRoot(), house, { live: true });
	});
	ipcMain.handle('notices:add', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		AddNotice(HousesRoot(), house, payload || {}, 'user');
		return BoardForHouse(HousesRoot(), house, { live: true });
	});
	ipcMain.handle('contacts:list', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return ContactsState(house.path);
	});
	ipcMain.handle('contacts:create', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		const out = CreateContact(house, payload);
		return { ...out.contacts, file: out.file, name: out.name, letter: out.letter };
	});
	ipcMain.handle('contacts:remove', (_event, slug, query) => {
		const house = ReadHouse(HousesRoot(), slug);
		const out = RemoveContact(house, query);
		return out.contacts;
	});
	ipcMain.handle('books:search', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		return BooksBoard(house.path, payload);
	});
	ipcMain.handle('books:create', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		const out = CreateBook(house, { ...(payload || {}), source: USER_BOOK_SOURCE });
		return { file: out.file, title: out.title, letter: out.letter };
	});
	ipcMain.handle('playbook:list', (_event, slug) => ListPlaybook(ToolContextFromHouse(ReadHouse(HousesRoot(), slug))));
	ipcMain.handle('playbook:set', (_event, slug, toolPath, enabled) => {
		return SetPlaybookEnabled(ToolContextFromHouse(ReadHouse(HousesRoot(), slug)), toolPath, !!enabled);
	});
	ipcMain.handle('playbook:add', (_event, slug, payload) => {
		return AddPlaybookItem(ToolContextFromHouse(ReadHouse(HousesRoot(), slug)), payload || {});
	});
	ipcMain.handle('playbook:remove', (_event, slug, toolPath) => {
		return RemovePlaybookItem(ToolContextFromHouse(ReadHouse(HousesRoot(), slug)), toolPath);
	});
	ipcMain.handle('playbook:read', (_event, slug, toolPath) => {
		const raw = ReadPlaybookFile(ToolContextFromHouse(ReadHouse(HousesRoot(), slug)), toolPath);
		const page = MarkdownPage(raw.text);
		return { file: raw.file, html: page.html };
	});
	ipcMain.handle('playbook:reveal', (_event, slug, toolPath) => {
		const abs = RevealPlaybookPath(ToolContextFromHouse(ReadHouse(HousesRoot(), slug)), toolPath);
		shell.showItemInFolder(abs);
		return { ok: true, path: abs };
	});
	ipcMain.handle('books:remove', (_event, slug, query) => {
		const house = ReadHouse(HousesRoot(), slug);
		const out = RemoveBook(house, query);
		return { file: out.file, title: out.title };
	});
	ipcMain.handle('cabinet:list', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return CabinetBoard(house.path);
	});
	ipcMain.handle('chest:list', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return ChestBoard(house.path);
	});
	ipcMain.handle('chest:remove', (_event, slug, file) => {
		const house = ReadHouse(HousesRoot(), slug);
		return RemoveChestFile(house.path, file);
	});
	ipcMain.handle('stories:list', (_event, slug, rel) => {
		const house = ReadHouse(HousesRoot(), slug);
		return StoryBoard(house.path, rel);
	});
	ipcMain.handle('reminders:list', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return ListReminders(house.path);
	});
	ipcMain.handle('reminders:add', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		SetReminder(house.path, JSON.stringify(payload || {}));
		return ListReminders(house.path);
	});
	ipcMain.handle('reminders:cancel', (_event, slug, id) => {
		const house = ReadHouse(HousesRoot(), slug);
		CancelReminder(house.path, String(id));
		return ListReminders(house.path);
	});
	ipcMain.handle('clock:state', (_event, slug) => {
		return {
			working: IsWorking(slug),
			turn_started_at: TurnStartedAt(slug)
		};
	});
	ipcMain.handle('alarms:list', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return AlarmSummaries(house.path);
	});
	ipcMain.handle('alarms:add', (_event, slug, line) => {
		const house = ReadHouse(HousesRoot(), slug);
		SetAlarm(house.path, String(line || ''));
		return AlarmSummaries(house.path);
	});
	ipcMain.handle('alarms:remove', (_event, slug, expr) => {
		const house = ReadHouse(HousesRoot(), slug);
		StopAlarm(house.path, JSON.stringify({ expr: String(expr || '') }));
		return AlarmSummaries(house.path);
	});
	ipcMain.handle('whiteboard:list', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		return WhiteboardBoard(house.path);
	});
	ipcMain.handle('whiteboard:create', (_event, slug, kind, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		CreateBoardItem(house, kind, payload || {});
		return WhiteboardBoard(house.path);
	});
	ipcMain.handle('whiteboard:remove', (_event, slug, kind, query) => {
		const house = ReadHouse(HousesRoot(), slug);
		RemoveBoardItem(house, kind, query);
		return WhiteboardBoard(house.path);
	});
	ipcMain.handle('chat:pickImages', async (_event, max) => {
		const cap = Math.min(MAX_IMAGES, Math.max(0, Math.floor(Number(max) || 0)));
		if (!cap) return { error: 'You can attach up to 4 images.' };
		const live = GetWin();
		const parent = live && !live.isDestroyed() ? live : null;
		const chooser = {
			title: 'Attach image',
			properties: ['openFile', 'multiSelections'],
			filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
		};
		const picked = parent
			? await dialog.showOpenDialog(parent, chooser)
			: await dialog.showOpenDialog(chooser);
		const filePaths = picked.filePaths;
		if (picked.canceled || !filePaths || !filePaths.length) return { images: [] };
		if (filePaths.length > cap) {
			return { error: cap === 1 ? 'You can attach 1 more image.' : 'You can attach ' + cap + ' more images.' };
		}
		try {
			const images = [];
			for (const file of filePaths) images.push(await ReadImageFile(file));
			return { images };
		} catch (err) {
			return { error: err && err.message ? String(err.message) : 'Could not read that image.' };
		}
	});
	ipcMain.handle('chat:send', (_event, slug, text, images) => {
		EnqueueChat(HousesRoot(), slug, String(text || ''), EmitHouseEvent, '', images);
		return { ok: true };
	});
	ipcMain.handle('chat:note', (_event, slug, text, from) => {
		EnqueueChat(HousesRoot(), slug, String(text || ''), EmitHouseEvent, String(from || 'note'));
		return { ok: true };
	});
	ipcMain.handle('chat:redo', async (_event, slug) => {
		const ok = await ConfirmQuestion({
			title: 'Redo',
			message: 'Retry the last message?',
			detail: 'The last reply is dropped and the same message is sent again.',
			buttons: ['Redo', 'Cancel']
		});
		if (!ok) return { cancelled: true };
		return EnqueueRedo(HousesRoot(), slug, EmitHouseEvent);
	});
	ipcMain.handle('chat:clear', async (_event, slug) => {
		const ok = await ConfirmQuestion({
			title: 'Clear',
			message: 'Clear this log?',
			detail: 'The session file is wiped. This action cannot be undone.',
			buttons: ['Clear', 'Cancel']
		});
		if (!ok) return { cancelled: true };
		ClearChat(HousesRoot(), slug);
		return { ok: true };
	});
	ipcMain.handle('ui:alert', async (_event, payload) => {
		const opts = payload || {};
		const box = {
			type: 'info',
			noLink: true,
			title: String(opts.title || 'Loci'),
			message: String(opts.message || ''),
			buttons: ['OK']
		};
		const w = GetWin();
		if (w) await dialog.showMessageBox(w, box);
		else await dialog.showMessageBox(box);
		return { ok: true };
	});
	ipcMain.handle('game:status', (_event, slug) => {
		const id = String(slug || '');
		const st = GameStatus(id);
		let prefs = null;
		try {
			prefs = LoadHouseConfig(HousesRoot(), id).game_console;
		} catch {
			prefs = null;
		}
		if (st.gaming && st.yours) return st;
		const p = prefs || {};
		return {
			...st,
			baseUrl: p.url || st.defaultUrl,
			idleSec: Number(p.idle_sec) || 30,
			idleOff: p.idle_off === true,
			maxToolRounds: Number(p.max_tool_rounds) || 32,
			capToolRounds: p.cap_off !== true
		};
	});
	ipcMain.handle('game:prefs', (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		const body = payload && typeof payload === 'object' ? payload : {};
		const cfg = PatchHouseConfig(HousesRoot(), house.slug, { game_console: body });
		return cfg.game_console;
	});
	ipcMain.handle('game:connect', async (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		const body = payload && typeof payload === 'object' ? payload : {};
		return ProbeGame({
			slug: house.slug,
			houseDir: house.path,
			housesRoot: HousesRoot(),
			baseUrl: body.baseUrl,
			lociHome: LociHome()
		});
	});
	ipcMain.handle('game:start', async (_event, slug, payload) => {
		const house = ReadHouse(HousesRoot(), slug);
		const body = payload && typeof payload === 'object' ? payload : {};
		return StartGaming({
			slug: house.slug,
			houseDir: house.path,
			housesRoot: HousesRoot(),
			baseUrl: body.baseUrl,
			idleSec: body.idleSec,
			idleOff: body.idleOff,
			maxToolRounds: body.maxToolRounds,
			capToolRounds: body.capToolRounds,
			lociHome: LociHome()
		});
	});
	ipcMain.handle('game:stop', (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		if (!HouseIsGaming(house.slug)) throw new Error('This house is not in gaming mode.');
		return StopGaming();
	});
	ipcMain.handle('chat:abort', (_event, slug) => {
		AbortTurn(slug);
		return { ok: true };
	});
	ipcMain.handle('tasks:list', (_event, slug) => {
		return ListTasks(ReadHouse(HousesRoot(), slug));
	});
	ipcMain.handle('tasks:create', (_event, slug, payload) => {
		return CreateTask(ReadHouse(HousesRoot(), slug), payload);
	});
	ipcMain.handle('tasks:update', (_event, slug, filename, body) => {
		return UpdateTaskNotes(ReadHouse(HousesRoot(), slug), filename, body);
	});
	ipcMain.handle('tasks:remove', async (_event, slug, filename) => {
		const house = ReadHouse(HousesRoot(), slug);
		const board = ListTasks(house);
		const item = board.items.find((t) => t.file === filename);
		const label = item && item.title ? item.title : String(filename || 'this task');
		const completed = item && item.status === 'completed';
		const ok = await ConfirmQuestion({
			title: 'Remove task',
			message: 'Remove ' + label + '?',
			detail: completed
				? 'The agent typically files completed tasks, which removes them from the Task Board. Trash deletes the note for good. This cannot be undone.'
				: 'The note is deleted from the Task Board. This cannot be undone.',
			buttons: ['Remove', 'Cancel']
		});
		if (!ok) return { cancelled: true, board };
		const next = RemoveTask(house, filename);
		const wait = WaitingOnUser(house.path);
		if (wait && wait.kind === 'approval' && wait.task === filename) {
			ClearApprovalWait(house.path);
			EmitHouseEvent({ type: 'waiting', slug, name: house.name, waiting: null });
		}
		return { cancelled: false, board: next };
	});
	ipcMain.handle('tasks:stamp', (_event, slug, filename, verdict, feedback) => {
		const house = ReadHouse(HousesRoot(), slug);
		const result = StampTask(house, filename, verdict, feedback);
		if (ClearApprovalWait(house.path)) {
			EmitHouseEvent({ type: 'waiting', slug, name: house.name, waiting: null });
		}
		const note = String(feedback || '').trim();
		const wake = FormatStampWake(result) + (note ? '\n\nUser note: ' + note : '');
		EnqueueStamp(HousesRoot(), slug, wake, EmitHouseEvent);
		return result;
	});
	ipcMain.handle('dev:tools', async (_event, slug) => {
		if (!IsDevMode()) throw new Error('Developer Mode is off.');
		const house = ReadHouse(HousesRoot(), slug);
		const names = (await HouseToolSpecs(ToolContextFromHouse(house))).map((s) => s.function.name);
		names.unshift('system_prompt');
		return names;
	});
	ipcMain.handle('dev:call', async (_event, slug, name, args) => {
		if (!IsDevMode()) throw new Error('Developer Mode is off.');
		const house = ReadHouse(HousesRoot(), slug);
		if (String(name || '') === 'system_prompt') return { text: BuildSystemPrompt(house) };
		const ctx = ToolContextFromHouse(house, {
			turn_started_at: Date.now(),
			firecrawl_api_key: LoadSettings().firecrawl_api_key,
			wake_house: (target, text) => EnqueueDm(HousesRoot(), target, text, EmitHouseEvent),
			house_busy: HouseBusy,
			...GameToolExtra(house.slug)
		});
		const payload = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
		const result = await CallTool(ctx, String(name || ''), payload);
		EmitHouseEvent({
			type: 'pose',
			slug,
			pose: { ...PalacePose(house.path), name: house.name }
		});
		if (result && (result.halt === 'notify' || result.halt === 'approval')) {
			EmitHouseEvent({
				type: 'waiting',
				slug,
				name: house.name,
				waiting: WaitingOnUser(house.path) || { kind: result.halt, text: '' }
			});
		}
		if (result && Array.isArray(result.images)) {
			result.images = result.images.map((img) => ({
				name: img.name,
				media_type: img.media_type,
				bytes: Math.floor(String(img.data || '').length * 3 / 4)
			}));
		}
		return result;
	});
	ipcMain.handle('packs:list', async (_event, slug) => {
		const out = await PacksListPayload(slug, { warm: true });
		if (out.mcpError) {
			await WarnMessage({
				title: 'mcp.json',
				message: 'Could not load mcp.json',
				detail: out.mcpError + '\n\nMCP packs are hidden until the file is valid JSON. Use Edit mcp.json to fix it.'
			});
		}
		return out;
	});
	ipcMain.handle('packs:waitWarm', async (_event, slug) => {
		const house = ReadHouse(HousesRoot(), slug);
		await WaitMcpForSlug(house.slug);
		return PacksListPayload(slug);
	});
	ipcMain.handle('packs:tools', async (_event, slug, packId) => {
		const house = ReadHouse(HousesRoot(), slug);
		return ListPackTools(HousesRoot(), house, String(packId || ''));
	});
	ipcMain.handle('packs:set', async (_event, slug, packId, patch) => {
		const house = ReadHouse(HousesRoot(), slug);
		const result = await SetPackForHouse(HousesRoot(), house, String(packId || ''), patch || {});
		if (result.run_command !== !!house.run_command) {
			UpdateHouse(HousesRoot(), slug, { run_command: result.run_command });
		}
		const next = ReadHouse(HousesRoot(), slug);
		KickMcpForHouse(HousesRoot(), next);
		return ListPacksForHouse(HousesRoot(), next);
	});
	ipcMain.handle('packs:settings', (_event, packId) => {
		return PackSettings(String(packId || ''));
	});
	ipcMain.handle('packs:saveSettings', async (_event, slug, packId, patch) => {
		const out = UpdateMcpServer(String(packId || ''), patch || {});
		const house = ReadHouse(HousesRoot(), slug);
		await CloseMcpSessionsForServer(String(packId || ''));
		KickMcpForHouse(HousesRoot(), house);
		return { ...out, packs: await ListPacksForHouse(HousesRoot(), house) };
	});
	ipcMain.handle('mcp:read', () => ReadMcpText());
	ipcMain.handle('mcp:write', async (_event, text) => {
		const out = WriteMcpText(text);
		await CloseAllMcpSessions();
		return out;
	});
	ipcMain.handle('houses:archive', async (_event, slug) => {
		const housesRoot = HousesRoot();
		const house = ReadHouse(housesRoot, slug);
		const archiveHint = path.join(path.dirname(path.resolve(housesRoot)), 'archive');
		const ok = await ConfirmQuestion({
			title: 'Archive house',
			message: 'Archive ' + house.name + '?',
			detail: 'The house folder moves to ' + archiveHint + '. Alarms will not run. Restore by moving the folder back into Houses.',
			buttons: ['Archive', 'Cancel']
		});
		if (!ok) return { archived: false };
		AbortTurn(slug);
		await CloseMcpSessionsForSlug(slug);
		const dest = ArchiveHouse(housesRoot, slug);
		const cfg = LoadSettings();
		const views = { ...(cfg.house_views || {}) };
		delete views[slug];
		const patch = { house_views: views };
		if (cfg.last_house === slug) patch.last_house = '';
		SaveSettings(patch);
		return { archived: true, path: dest };
	});
}

app.whenReady().then(() => {
	appMenu = Menu.getApplicationMenu();
	RegisterIpc();
	CreateWindow();
	StartAlarmsTick(() => HousesRoot(), EmitHouseEvent);

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			CreateWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

function WorkingHouses() {
	try {
		return ListHouses(HousesRoot()).filter((h) => IsWorking(h.slug));
	} catch {
		return [];
	}
}

function ConfirmQuit() {
	if (quitConfirmed) return true;
	const working = WorkingHouses();
	const gaming = GamingOn();
	const names = working.map((h) => h.name || h.slug);
	let message = 'Quit Loci?';
	let detail = '';
	if (names.length === 1) {
		message = names[0] + ' is in the middle of a turn.';
		detail = 'Closing Loci stops that turn.';
	} else if (names.length > 1) {
		message = names.join(', ') + ' are in the middle of a turn.';
		detail = 'Closing Loci stops those turns.';
	} else if (gaming) {
		message = 'A game is still connected.';
		detail = 'Closing Loci disconnects the game.';
	}
	if (names.length && gaming) detail += ' The game connection closes too.';
	const box = {
		type: 'question',
		buttons: ['Quit', 'Cancel'],
		defaultId: names.length || gaming ? 1 : 0,
		cancelId: 1,
		noLink: true,
		title: 'Quit Loci',
		message,
		detail
	};
	const parent = win && !win.isDestroyed() ? win : null;
	const response = parent
		? dialog.showMessageBoxSync(parent, box)
		: dialog.showMessageBoxSync(box);
	if (response !== 0) return false;
	quitConfirmed = true;
	return true;
}

let mcpClosed = false;
let quitConfirmed = false;
app.on('before-quit', (e) => {
	if (mcpClosed) return;
	e.preventDefault();
	if (!ConfirmQuit()) return;
	mcpClosed = true;
	CloseAllMcpSessions().finally(() => app.quit());
});
