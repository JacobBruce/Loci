import fs from 'node:fs';
import path from 'node:path';
import { ListHouses } from './house.js';

const BODY_MAX = 64 * 1024;
const SUBJECT_MAX = 200;

function MailError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

export function EnsureMailDirs(houseDir) {
	for (const name of ['inbox', 'read', 'sent']) {
		fs.mkdirSync(path.join(houseDir, 'mail', name), { recursive: true });
	}
}

function InboxDir(houseDir) {
	return path.join(houseDir, 'mail', 'inbox');
}

export function CountInbox(houseDir) {
	const dir = InboxDir(houseDir);
	if (!fs.existsSync(dir)) return 0;
	let n = 0;
	for (const name of fs.readdirSync(dir)) {
		if (name.startsWith('.')) continue;
		if (!name.toLowerCase().endsWith('.md')) continue;
		try {
			if (fs.statSync(path.join(dir, name)).isFile()) n += 1;
		} catch {
			// skip
		}
	}
	return n;
}

export function FormatUnreadMail(count) {
	const n = Number(count) || 0;
	if (n <= 0) return '';
	if (n === 1) return 'You have 1 unread item in mail/inbox.';
	return 'You have ' + n + ' unread items in mail/inbox.';
}

export function AttachUnreadMail(houseDir, text) {
	const block = FormatUnreadMail(CountInbox(houseDir));
	if (!block) return String(text || '');
	const body = String(text || '');
	return body ? body + '\n\n' + block : block;
}

function YamlScalar(value) {
	return String(value || '').replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
}

function LetterMarkdown(meta, body) {
	const lines = [
		'---',
		'from: ' + YamlScalar(meta.from),
		'to: ' + YamlScalar(meta.to),
		'subject: ' + YamlScalar(meta.subject),
		'at: ' + YamlScalar(meta.at),
		'---',
		''
	];
	let text = String(body || '').replace(/\r\n/g, '\n');
	if (text && !text.endsWith('\n')) text += '\n';
	return lines.join('\n') + text;
}

function UniqueName(dirs, base) {
	const list = Array.isArray(dirs) ? dirs : [dirs];
	const stem = String(base || 'letter').replace(/\.md$/i, '');
	let name = stem + '.md';
	let n = 2;
	while (list.some((dir) => fs.existsSync(path.join(dir, name)))) {
		name = stem + '-' + n + '.md';
		n += 1;
	}
	return name;
}

function StampName(fromSlug) {
	const d = new Date();
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	const hh = String(d.getUTCHours()).padStart(2, '0');
	const mm = String(d.getUTCMinutes()).padStart(2, '0');
	const ss = String(d.getUTCSeconds()).padStart(2, '0');
	const slug = String(fromSlug || 'agent').replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '') || 'agent';
	return y + '-' + m + '-' + day + 'T' + hh + mm + ss + 'Z-' + slug + '.md';
}

function ParseAddress(raw) {
	const src = String(raw || '').trim();
	if (!src) throw MailError('payload.to is required (house slug, or slug@group).');
	if (/^user$/i.test(src) || /^user@/i.test(src)) {
		throw MailError('There is no mailbox for the user. Use notify_user when you are stuck, or the Approval Tray for finished work.');
	}
	const at = src.lastIndexOf('@');
	if (at <= 0) return { slug: src, group: '' };
	return {
		slug: src.slice(0, at).trim(),
		group: src.slice(at + 1).trim()
	};
}

function ParsePayload(raw) {
	const src = String(raw || '').trim();
	if (!src) throw MailError('payload must be JSON: {"to":"slug","subject":"…","body":"…"}');
	let obj;
	try {
		obj = JSON.parse(src);
	} catch {
		throw MailError('payload must be JSON: {"to":"slug","subject":"…","body":"…"}');
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		throw MailError('payload must be JSON: {"to":"slug","subject":"…","body":"…"}');
	}
	const addr = ParseAddress(obj.to);
	if (!addr.slug) throw MailError('payload.to is required (house slug, or slug@group).');
	const subject = YamlScalar(obj.subject);
	if (!subject) throw MailError('payload.subject is required.');
	if (subject.length > SUBJECT_MAX) {
		throw MailError('payload.subject is too long (max ' + SUBJECT_MAX + ' characters).');
	}
	const body = obj.body == null ? '' : String(obj.body);
	if (Buffer.byteLength(body, 'utf8') > BODY_MAX) {
		throw MailError('payload.body is too large (max 64KiB).');
	}
	return { ...addr, subject, body };
}

function HousesRootFrom(ctx) {
	const root = String(ctx && ctx.housesRoot || '').trim();
	if (root) return path.resolve(root);
	const houseDir = String(ctx && ctx.houseDir || '').trim();
	if (!houseDir) throw MailError('House directory is missing');
	return path.dirname(path.resolve(houseDir));
}

/**
 * Another house in this named group. `addr` is `{ slug, group }` from the address.
 * @param {object} ctx
 * @param {{ slug?: string, group?: string }} addr
 */
export function ResolvePeer(ctx, addr) {
	const group = String(ctx && ctx.group || '').trim();
	const fromSlug = String(ctx && ctx.slug || '').trim();
	const slug = String(addr && addr.slug || '').trim();
	const addrGroup = String(addr && addr.group || '').trim();
	if (!group) throw MailError('Solitary houses cannot reach other agents.');
	if (addrGroup && addrGroup !== group) {
		throw MailError('Address group "' + addrGroup + '" does not match this house\'s group (' + group + ').');
	}
	if (!slug) throw MailError('payload.to is required (house slug, or slug@group).');
	const houses = ListHouses(HousesRootFrom(ctx));
	const dest = FindHouse(houses, slug, group);
	if (!dest) throw MailError('No house with slug "' + slug + '".');
	if (dest.slug === fromSlug) throw MailError('You cannot message yourself.');
	if (String(dest.group || '').trim() !== group) {
		throw MailError('No house named "' + slug + '" in your group (' + group + ').');
	}
	return dest;
}

/**
 * The slug first, then the same slug in another case, then a house name in this group.
 * Agents often write a name ("Cedar") where the slug is "cedar". Houses in this group
 * win, so a same-slug house in another group cannot shadow a peer's name. A house
 * outside the group is still returned so the caller can say it is not in the group.
 */
function FindHouse(houses, raw, group) {
	const key = raw.toLowerCase();
	const BySlug = (list) => list.find((h) => h.slug === raw) || list.find((h) => h.slug.toLowerCase() === key);
	const peers = houses.filter((h) => String(h.group || '').trim() === group);
	const peer = BySlug(peers);
	if (peer) return peer;
	const byName = peers.filter((h) => String(h.name || '').trim().toLowerCase() === key);
	if (byName.length === 1) return byName[0];
	return BySlug(houses) || null;
}

/**
 * Write a letter to the recipient inbox and this house's sent folder.
 * Does not wake the recipient.
 */
export function SendMail(ctx, payload) {
	const parsed = ParsePayload(payload);
	const fromSlug = String(ctx && ctx.slug || '').trim();
	const fromName = String(ctx && ctx.name || '').trim() || fromSlug || 'agent';
	const dest = ResolvePeer(ctx, parsed);
	const group = String(ctx && ctx.group || '').trim();
	EnsureMailDirs(ctx.houseDir);
	EnsureMailDirs(dest.path);
	const at = new Date().toISOString();
	const filename = UniqueName([
		InboxDir(dest.path),
		path.join(ctx.houseDir, 'mail', 'sent')
	], StampName(fromSlug));
	const markdown = LetterMarkdown({
		from: fromSlug || fromName,
		to: dest.slug,
		subject: parsed.subject,
		at
	}, parsed.body);
	const inboxRel = 'mail/inbox/' + filename;
	const sentRel = 'mail/sent/' + filename;
	fs.writeFileSync(path.join(dest.path, 'mail', 'inbox', filename), markdown, 'utf8');
	fs.writeFileSync(path.join(ctx.houseDir, 'mail', 'sent', filename), markdown, 'utf8');
	return {
		delivered: true,
		to: dest.slug,
		group,
		subject: parsed.subject,
		inbox: inboxRel,
		sent: sentRel,
		at
	};
}

/**
 * Move an inbox letter to mail/read/. Returns null if this path is not an inbox letter.
 */
export function MarkInboxRead(houseDir, rel) {
	const posix = String(rel || '').replace(/\\/g, '/');
	const parts = posix.split('/').filter(Boolean);
	if (parts.length !== 3 || parts[0] !== 'mail' || parts[1] !== 'inbox') return null;
	const name = parts[2];
	if (!name || name.startsWith('.') || name === '..') return null;
	const src = path.join(houseDir, 'mail', 'inbox', name);
	if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return null;
	EnsureMailDirs(houseDir);
	const destName = UniqueName(path.join(houseDir, 'mail', 'read'), name);
	const dest = path.join(houseDir, 'mail', 'read', destName);
	fs.renameSync(src, dest);
	return {
		from: 'mail/inbox/' + name,
		to: 'mail/read/' + destName
	};
}
