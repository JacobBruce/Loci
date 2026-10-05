import fs from 'node:fs';
import path from 'node:path';

function WalkFiles(root, rel) {
	const dir = rel ? path.join(root, rel) : root;
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const out = [];
	for (const ent of entries) {
		if (ent.name.startsWith('.')) continue;
		const child = rel ? rel + '/' + ent.name : ent.name;
		if (ent.isDirectory()) {
			out.push(...WalkFiles(root, child));
			continue;
		}
		if (!ent.isFile()) continue;
		let mtime = 0;
		try {
			mtime = fs.statSync(path.join(root, child)).mtimeMs;
		} catch {
			// skip
		}
		out.push({ name: child, mtime });
	}
	return out;
}

export function ChestBoard(houseDir) {
	const rel = 'artifacts/';
	if (!houseDir) return { path: rel, count: 0, items: [] };
	const dir = path.join(houseDir, 'artifacts');
	if (!fs.existsSync(dir)) return { path: rel, count: 0, items: [] };
	const rows = WalkFiles(dir, '');
	rows.sort((a, b) => {
		if (b.mtime !== a.mtime) return b.mtime - a.mtime;
		return a.name.localeCompare(b.name);
	});
	return {
		path: rel,
		count: rows.length,
		items: rows.map((row) => ({ file: rel + row.name, name: row.name }))
	};
}

function ChestError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

/**
 * Delete one file under artifacts/. `query` is a chest path or a unique file name.
 */
export function RemoveChestFile(houseDir, query) {
	const raw = String(query || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
	if (!raw) throw ChestError('file is required.');
	const root = path.resolve(houseDir, 'artifacts');
	let rel = raw;
	if (rel === 'artifacts') throw ChestError('Name a file inside the chest.');
	if (rel.startsWith('artifacts/')) rel = rel.slice('artifacts/'.length);
	if (!rel.includes('/')) {
		const named = ChestBoard(houseDir).items.filter((row) => row.name === rel || row.name.endsWith('/' + rel));
		if (named.length === 1) rel = named[0].name;
		else if (!named.length) throw ChestError('No chest file named "' + raw + '".');
		else throw ChestError('More than one file named "' + raw + '". Use the path.');
	}
	if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw ChestError('That file is not in the chest.');
	}
	const abs = path.resolve(root, rel);
	if (abs !== root && !abs.startsWith(root + path.sep)) throw ChestError('That file is not in the chest.');
	if (!fs.existsSync(abs)) throw ChestError('No chest file named "' + rel + '".');
	const st = fs.lstatSync(abs);
	if (st.isSymbolicLink()) throw ChestError('Refusing to remove a symlink.');
	if (st.isDirectory()) throw ChestError('That is a folder. Name a file inside it.');
	if (!st.isFile()) throw ChestError('That is not a file.');
	fs.unlinkSync(abs);
	return { file: 'artifacts/' + rel, board: ChestBoard(houseDir) };
}
