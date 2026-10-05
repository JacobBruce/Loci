import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FitBox, MAX_IMAGE_BYTES, NormalizeImages, PrepareScreen, ReadImageFile, ScreenEdge } from '../src/images.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

function Gif(width, height, extra) {
	const head = Buffer.alloc(13);
	head.write('GIF89a', 0, 'ascii');
	head.writeUInt16LE(width, 6);
	head.writeUInt16LE(height, 8);
	return Buffer.concat([head, Buffer.alloc(extra || 0)]);
}

test('ReadImageFile keeps a small picture and rejects the wrong type', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-img-'));
	const file = path.join(dir, 'dot.png');
	fs.writeFileSync(file, PNG);
	const img = await ReadImageFile(file);
	assert.equal(img.media_type, 'image/png');
	assert.equal(img.name, 'dot.png');
	assert.equal(img.data, PNG.toString('base64'));
	fs.writeFileSync(path.join(dir, 'nope.png'), Buffer.from('not a png'));
	await assert.rejects(() => ReadImageFile(path.join(dir, 'nope.png')), /not a PNG image/);
	await assert.rejects(() => ReadImageFile(path.join(dir, 'dot.bmp')), /PNG, JPEG, GIF, or WebP/);
	assert.throws(() => NormalizeImages([img, img, img, img, img]), /4 images/);
	fs.writeFileSync(path.join(dir, 'odd.gif'), Gif(640, 480, 2 * 1024 * 1024));
	const gif = await ReadImageFile(path.join(dir, 'odd.gif'));
	assert.equal(gif.media_type, 'image/gif');
	fs.writeFileSync(path.join(dir, 'huge.gif'), Gif(4000, 3000));
	await assert.rejects(() => ReadImageFile(path.join(dir, 'huge.gif')), /Save it as PNG or JPEG/);
	fs.writeFileSync(path.join(dir, 'heavy.gif'), Gif(640, 480, MAX_IMAGE_BYTES));
	await assert.rejects(() => ReadImageFile(path.join(dir, 'heavy.gif')), /too large/);
});

test('a screenshot keeps a small picture and refuses a bad path', async () => {
	assert.equal(ScreenEdge(undefined), 512);
	assert.equal(ScreenEdge(50), 128);
	assert.equal(ScreenEdge(5000), 1024);
	assert.throws(() => ScreenEdge('big'), /whole number/);
	assert.deepEqual(FitBox(1920, 1080, 512), { width: 512, height: 288 });
	assert.deepEqual(FitBox(100, 80, 512), { width: 100, height: 80 });
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-screen-'));
	const file = path.join(dir, 'shot.png');
	fs.writeFileSync(file, PNG);
	const shot = await PrepareScreen(file, 512);
	assert.equal(shot.width, 1);
	assert.equal(shot.height, 1);
	assert.equal(shot.image.name, 'shot.png');
	assert.equal(shot.image.data, PNG.toString('base64'));
	await assert.rejects(() => PrepareScreen('shot.png', 512), /absolute/);
	await assert.rejects(() => PrepareScreen(path.join(dir, 'missing.png'), 512), /missing/);
	fs.writeFileSync(path.join(dir, 'note.png'), Buffer.from('not a png'));
	await assert.rejects(() => PrepareScreen(path.join(dir, 'note.png'), 512), /PNG, JPEG, GIF, or WebP/);
});
