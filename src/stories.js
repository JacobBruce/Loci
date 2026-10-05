import fs from 'node:fs';
import path from 'node:path';

function CleanRel(rel) {
	const parts = String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
	if (parts.some((part) => part === '.' || part === '..' || part.startsWith('.'))) {
		throw new Error('That story path is not allowed.');
	}
	return parts.join('/');
}

/**
 * One level of stories/. `rel` is empty at the root, or a campaign / character path.
 * Only directories and markdown files are listed.
 */
export function StoryBoard(houseDir, rel) {
	const sub = CleanRel(rel);
	const atRoot = !sub;
	const parent = atRoot ? null : (sub.includes('/') ? sub.slice(0, sub.lastIndexOf('/')) : '');
	const palace = sub ? 'stories/' + sub + '/' : 'stories/';
	const empty = { path: palace, rel: sub, atRoot, parent, items: [] };
	if (!houseDir) return empty;
	const root = path.resolve(houseDir, 'stories');
	const dir = sub ? path.resolve(root, sub) : root;
	if (dir !== root && !dir.startsWith(root + path.sep)) {
		throw new Error('That story path is not allowed.');
	}
	if (!fs.existsSync(dir)) return empty;
	const st = fs.lstatSync(dir);
	if (st.isSymbolicLink()) throw new Error('That story path is not allowed.');
	if (!st.isDirectory()) throw new Error('That story path is a file.');
	const items = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue;
		const child = sub ? sub + '/' + ent.name : ent.name;
		const file = 'stories/' + child;
		if (ent.isDirectory()) {
			items.push({ kind: 'dir', name: ent.name, rel: child, file });
		} else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
			items.push({ kind: 'file', name: ent.name, rel: child, file });
		}
	}
	items.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return { path: palace, rel: sub, atRoot, parent, items };
}
