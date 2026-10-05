import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChestBoard, RemoveChestFile } from '../src/chest.js';

function House() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'loci-chest-'));
}

test('ChestBoard lists artifacts newest first and skips hidden files', () => {
	const dir = House();
	assert.equal(ChestBoard(dir).count, 0);
	const root = path.join(dir, 'artifacts');
	fs.mkdirSync(path.join(root, 'dump'), { recursive: true });
	fs.writeFileSync(path.join(root, '.secret'), 'nope\n', 'utf8');
	fs.writeFileSync(path.join(root, 'old.txt'), 'older\n', 'utf8');
	const old = Date.now() - 60_000;
	fs.utimesSync(path.join(root, 'old.txt'), old / 1000, old / 1000);
	fs.writeFileSync(path.join(root, 'dump', 'fresh.bin'), 'new\n', 'utf8');
	const board = ChestBoard(dir);
	assert.equal(board.path, 'artifacts/');
	assert.equal(board.count, 2);
	assert.equal(board.items[0].file, 'artifacts/dump/fresh.bin');
	assert.equal(board.items[0].name, 'dump/fresh.bin');
	assert.equal(board.items[1].file, 'artifacts/old.txt');
	assert.equal(board.items.some((row) => row.name === '.secret'), false);
	const removed = RemoveChestFile(dir, 'fresh.bin');
	assert.equal(removed.file, 'artifacts/dump/fresh.bin');
	assert.equal(removed.board.count, 1);
	assert.equal(fs.existsSync(path.join(root, 'dump', 'fresh.bin')), false);
	assert.throws(() => RemoveChestFile(dir, 'artifacts/../NOTES.md'), /not in the chest/);
	assert.throws(() => RemoveChestFile(dir, 'missing.txt'), /No chest file/);
});
