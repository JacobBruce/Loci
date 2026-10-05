import fs from 'node:fs';
import { ResolvePath } from './tools.js';

/**
 * The short "what is the agent doing" label shown next to its name.
 * Kept free of Electron so tests can import it.
 */

/**
 * Label for a search_files call.
 * - no path, or the house root: "Searching house"
 * - a folder in the house (any depth): "Searching <top folder>", e.g. cabinet/ or cabinet/2026 -> "Searching cabinet"
 * - anywhere in a workspace: "Searching workspace"
 * - loci-rules/ or loci-skills/: "Searching loci-rules" / "Searching loci-skills"
 * Paths may be relative or absolute. A path that cannot be resolved gets a generic label.
 * @param {string} rawPath
 * @param {{ houseDir: string, workspaces?: string[] }} ctx
 */
export function SearchActivity(rawPath, ctx) {
	const raw = String(rawPath == null ? '' : rawPath).trim();
	if (!raw || raw === '.') return 'Searching house';
	let target;
	try {
		target = ResolvePath(ctx, raw);
	} catch {
		return 'Searching files';
	}
	if (target.kind === 'workspace') return 'Searching workspace';
	if (target.kind === 'loci-library') return 'Searching ' + target.prefix;
	const parts = String(target.rel || '').split('/').filter(Boolean);
	if (!parts.length) return 'Searching house';
	if (parts.length === 1) {
		// A single top-level name is a folder worth naming, but a file at the root is just the house.
		let isDir = false;
		try {
			isDir = fs.statSync(target.abs).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) return 'Searching house';
	}
	return 'Searching ' + parts[0];
}

const ACTION_ACTIVITY = {
	boot: 'Booting the PC',
	logoff: 'Logging off',
	create_book: 'Shelving a book',
	remove_book: 'Removing a book',
	remove_file: 'Removing an artifact',
	search_books: 'Searching book shelf',
	set_alarm: 'Setting an alarm',
	stop_alarm: 'Stopping an alarm',
	set_reminder: 'Setting a reminder',
	cancel_reminder: 'Cancelling a reminder',
	list_reminders: 'Checking reminders',
	notify_user: 'Notifying you',
	send_mail: 'Sending mail',
	vote: 'Voting in poll',
	open_poll: 'Opening a poll',
	close_poll: 'Closing a poll',
	add_notice: 'Posting a notice',
	sleep: 'Going to sleep'
};

/**
 * @param {{ name?: string, arguments?: object }} call
 * @param {object} [result] the tool result, when the call has finished
 * @param {{ houseDir: string, workspaces?: string[] }} [ctx] needed to label search_files
 * @returns {string} '' when the call should not change the activity line
 */
export function ActivityFromTool(call, result, ctx) {
	if (!call) return '';
	if (result && result.ok === false) return '';
	const name = String(call.name || '');
	const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
	const done = result && typeof result === 'object' ? result : null;
	if (name === 'read_file' || name === 'write_file' || name === 'edit_file') {
		const verb = name === 'read_file' ? 'Reading' : name === 'write_file' ? 'Writing' : 'Editing';
		return verb + ' a file';
	}
	if (name === 'search_files') return SearchActivity(args.path, ctx || { houseDir: '' });
	if (name === 'chat_history') return 'Reading chat history';
	if (name === 'run_command') return 'Running command';
	if (name === 'send_msg') return 'Speaking in the game';
	if (name === 'list_objects') {
		const room = done && done.room && done.room.name ? done.room.name : '';
		return room ? 'Looking around ' + room : 'Looking around';
	}
	if (name === 'list_actions') {
		const label = (done && done.name) || args.target || '';
		return label ? 'Checking ' + label : 'Checking actions';
	}
	if (name === 'get_state') return 'Checking state of house';
	if (name === 'get_screen') return 'Looking at game screen';
	if (name === 'lock_body') return 'Choosing game character';
	if (name !== 'send_action') return '';
	const action = String(args.action || (done && done.action) || '').toLowerCase();
	if (action === 'set_status') return '';
	if (action === 'examine' || action === 'look') {
		return 'Examining ' + ((done && done.name) || args.target || 'an object');
	}
	if (action === 'search_web') return 'Searching the web';
	if (action === 'get_web_page') return 'Reading a web page';
	if (action === 'download_file') return 'Downloading a file';
	if (action === 'dm') return 'Waking ' + ((done && done.to) || 'another house');
	if (action === 'go' || action === 'move') {
		const room = done && done.room && done.room.name ? done.room.name : (done && done.to) || args.target || 'a room';
		return 'Going to ' + room;
	}
	if (ACTION_ACTIVITY[action]) return ACTION_ACTIVITY[action];
	if (done && done.name) return 'Interacting with ' + done.name;
	if (args.target) return 'Using ' + args.target;
	return '';
}
