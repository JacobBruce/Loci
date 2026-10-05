const { contextBridge, ipcRenderer } = require('electron');

let bootTheme = 'brass';
try {
	const got = ipcRenderer.sendSync('settings:theme');
	if (got === 'blue' || got === 'brass') bootTheme = got;
} catch {
	bootTheme = 'brass';
}
contextBridge.exposeInMainWorld('lociTheme', bootTheme);

const validSend = [];

const validInvoke = [
	'getAppVersion',
	'settings:get',
	'settings:save',
	'dialog:openFolder',
	'ui:confirm',
	'ui:alert',
	'houses:list',
	'houses:templates',
	'houses:get',
	'houses:create',
	'houses:update',
	'houses:open',
	'houses:openConfig',
	'houses:archive',
	'house:reveal',
	'house:read',
	'markdown:render',
	'diary:list',
	'calendar:state',
	'calendar:add',
	'calendar:remove',
	'notices:state',
	'notices:open',
	'notices:close',
	'notices:add',
	'contacts:list',
	'contacts:create',
	'contacts:remove',
	'books:search',
	'books:create',
	'books:remove',
	'playbook:list',
	'playbook:set',
	'playbook:add',
	'playbook:remove',
	'playbook:read',
	'playbook:reveal',
	'cabinet:list',
	'chest:list',
	'chest:remove',
	'stories:list',
	'reminders:list',
	'reminders:add',
	'reminders:cancel',
	'clock:state',
	'alarms:list',
	'alarms:add',
	'alarms:remove',
	'whiteboard:list',
	'whiteboard:create',
	'whiteboard:remove',
	'game:status',
	'game:prefs',
	'game:connect',
	'game:start',
	'game:stop',
	'chat:send',
	'chat:pickImages',
	'chat:note',
	'chat:redo',
	'chat:clear',
	'chat:abort',
	'tasks:list',
	'tasks:create',
	'tasks:update',
	'tasks:remove',
	'tasks:stamp',
	'dev:tools',
	'dev:call',
	'packs:list',
	'packs:waitWarm',
	'packs:tools',
	'packs:set',
	'packs:settings',
	'packs:saveSettings',
	'mcp:read',
	'mcp:write'
];

const validReceive = [
	'house:event'
];

contextBridge.exposeInMainWorld('lociAPI', {
	getAppVersion: () => ipcRenderer.invoke('getAppVersion'),
	getSettings: () => ipcRenderer.invoke('settings:get'),
	saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
	openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
	confirmAction: (payload) => ipcRenderer.invoke('ui:confirm', payload),
	alert: (payload) => ipcRenderer.invoke('ui:alert', payload),
	listHouses: () => ipcRenderer.invoke('houses:list'),
	houseTemplates: () => ipcRenderer.invoke('houses:templates'),
	getHouse: (slug) => ipcRenderer.invoke('houses:get', slug),
	createHouse: (payload) => ipcRenderer.invoke('houses:create', payload),
	updateHouse: (slug, payload) => ipcRenderer.invoke('houses:update', slug, payload),
	openHouse: (slug) => ipcRenderer.invoke('houses:open', slug),
	openHouseConfig: (slug) => ipcRenderer.invoke('houses:openConfig', slug),
	archiveHouse: (slug) => ipcRenderer.invoke('houses:archive', slug),
	revealPath: (slug, rel) => ipcRenderer.invoke('house:reveal', slug, rel),
	readMarkdown: (slug, rel) => ipcRenderer.invoke('house:read', slug, rel),
	renderMarkdown: (src) => ipcRenderer.invoke('markdown:render', src),
	listDiary: (slug) => ipcRenderer.invoke('diary:list', slug),
	calendarState: (slug) => ipcRenderer.invoke('calendar:state', slug),
	addEvent: (slug, payload) => ipcRenderer.invoke('calendar:add', slug, payload),
	removeEvent: (slug, payload) => ipcRenderer.invoke('calendar:remove', slug, payload),
	noticeState: (slug) => ipcRenderer.invoke('notices:state', slug),
	openPoll: (slug, payload) => ipcRenderer.invoke('notices:open', slug, payload),
	closePoll: (slug) => ipcRenderer.invoke('notices:close', slug),
	addNotice: (slug, payload) => ipcRenderer.invoke('notices:add', slug, payload),
	listContacts: (slug) => ipcRenderer.invoke('contacts:list', slug),
	createContact: (slug, payload) => ipcRenderer.invoke('contacts:create', slug, payload),
	removeContact: (slug, query) => ipcRenderer.invoke('contacts:remove', slug, query),
	searchBooks: (slug, payload) => ipcRenderer.invoke('books:search', slug, payload),
	createBook: (slug, payload) => ipcRenderer.invoke('books:create', slug, payload),
	removeBook: (slug, query) => ipcRenderer.invoke('books:remove', slug, query),
	listPlaybook: (slug) => ipcRenderer.invoke('playbook:list', slug),
	setPlaybook: (slug, toolPath, enabled) => ipcRenderer.invoke('playbook:set', slug, toolPath, enabled),
	addPlaybook: (slug, payload) => ipcRenderer.invoke('playbook:add', slug, payload),
	removePlaybook: (slug, toolPath) => ipcRenderer.invoke('playbook:remove', slug, toolPath),
	readPlaybook: (slug, toolPath) => ipcRenderer.invoke('playbook:read', slug, toolPath),
	revealPlaybook: (slug, toolPath) => ipcRenderer.invoke('playbook:reveal', slug, toolPath),
	listCabinet: (slug) => ipcRenderer.invoke('cabinet:list', slug),
	listChest: (slug) => ipcRenderer.invoke('chest:list', slug),
	removeChestFile: (slug, file) => ipcRenderer.invoke('chest:remove', slug, file),
	listStories: (slug, rel) => ipcRenderer.invoke('stories:list', slug, rel || ''),
	listReminders: (slug) => ipcRenderer.invoke('reminders:list', slug),
	addReminder: (slug, payload) => ipcRenderer.invoke('reminders:add', slug, payload),
	cancelReminder: (slug, id) => ipcRenderer.invoke('reminders:cancel', slug, id),
	clockState: (slug) => ipcRenderer.invoke('clock:state', slug),
	listAlarms: (slug) => ipcRenderer.invoke('alarms:list', slug),
	addAlarm: (slug, line) => ipcRenderer.invoke('alarms:add', slug, line),
	removeAlarm: (slug, expr) => ipcRenderer.invoke('alarms:remove', slug, expr),
	listWhiteboard: (slug) => ipcRenderer.invoke('whiteboard:list', slug),
	createBoardItem: (slug, kind, payload) => ipcRenderer.invoke('whiteboard:create', slug, kind, payload),
	removeBoardItem: (slug, kind, query) => ipcRenderer.invoke('whiteboard:remove', slug, kind, query),
	gameStatus: (slug) => ipcRenderer.invoke('game:status', slug),
	gamePrefs: (slug, payload) => ipcRenderer.invoke('game:prefs', slug, payload),
	gameConnect: (slug, payload) => ipcRenderer.invoke('game:connect', slug, payload),
	gameStart: (slug, payload) => ipcRenderer.invoke('game:start', slug, payload),
	gameStop: (slug) => ipcRenderer.invoke('game:stop', slug),
	sendChat: (slug, text, images) => ipcRenderer.invoke('chat:send', slug, text, images),
	pickImages: (max) => ipcRenderer.invoke('chat:pickImages', max),
	sendNote: (slug, text, from) => ipcRenderer.invoke('chat:note', slug, text, from),
	redoChat: (slug) => ipcRenderer.invoke('chat:redo', slug),
	clearChat: (slug) => ipcRenderer.invoke('chat:clear', slug),
	abortTurn: (slug) => ipcRenderer.invoke('chat:abort', slug),
	listTasks: (slug) => ipcRenderer.invoke('tasks:list', slug),
	createTask: (slug, payload) => ipcRenderer.invoke('tasks:create', slug, payload),
	updateTask: (slug, filename, body) => ipcRenderer.invoke('tasks:update', slug, filename, body),
	removeTask: (slug, filename) => ipcRenderer.invoke('tasks:remove', slug, filename),
	stampTask: (slug, filename, verdict, feedback) => ipcRenderer.invoke('tasks:stamp', slug, filename, verdict, feedback),
	devTools: (slug) => ipcRenderer.invoke('dev:tools', slug),
	devCall: (slug, name, args) => ipcRenderer.invoke('dev:call', slug, name, args),
	listPacks: (slug) => ipcRenderer.invoke('packs:list', slug),
	waitPacksWarm: (slug) => ipcRenderer.invoke('packs:waitWarm', slug),
	listPackTools: (slug, packId) => ipcRenderer.invoke('packs:tools', slug, packId),
	setPack: (slug, packId, patch) => ipcRenderer.invoke('packs:set', slug, packId, patch),
	packSettings: (packId) => ipcRenderer.invoke('packs:settings', packId),
	savePackSettings: (slug, packId, patch) => ipcRenderer.invoke('packs:saveSettings', slug, packId, patch),
	readMcpJson: () => ipcRenderer.invoke('mcp:read'),
	writeMcpJson: (text) => ipcRenderer.invoke('mcp:write', text),

	send: (channel, ...args) => {
		if (validSend.includes(channel)) ipcRenderer.send(channel, ...args);
	},

	invoke: (channel, ...args) => {
		if (validInvoke.includes(channel)) return ipcRenderer.invoke(channel, ...args);
		return Promise.reject(new Error('Invalid invoke channel: ' + channel));
	},

	on: (channel, listener) => {
		if (!validReceive.includes(channel)) return;
		const wrapped = (_event, ...args) => listener(null, ...args);
		ipcRenderer.on(channel, wrapped);
	},

	versions: {
		chrome: process.versions.chrome,
		node: process.versions.node,
		electron: process.versions.electron
	},

	platform: process.platform
});
