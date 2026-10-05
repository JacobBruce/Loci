import fs from 'node:fs';
import path from 'node:path';

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ATTACH_EDGE = 1568;
export const SCREEN_EDGE_DEFAULT = 512;
export const SCREEN_EDGE_MIN = 128;
export const SCREEN_EDGE_MAX = 1024;

const SOURCE_MAX = 32 * 1024 * 1024;
// Past this, a PNG is stored as JPEG. Every stored image is resent on each request.
const KEEP_BYTES = 1536 * 1024;
// Claude rejects any side over 2000 px once a request holds more than 20 images.
const UNSCALED_EDGE_MAX = 2000;

const TYPES = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp'
};

function MatchesType(buf, media) {
	if (media === 'image/png') return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
	if (media === 'image/jpeg') return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
	if (media === 'image/gif') return buf.length >= 6 && buf.subarray(0, 4).toString('ascii') === 'GIF8';
	if (media === 'image/webp') {
		return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
	}
	return false;
}

function MediaFromMagic(buf) {
	for (const media of Object.values(TYPES)) {
		if (MatchesType(buf, media)) return media;
	}
	return '';
}

function JpegSize(buf) {
	let i = 2;
	while (i + 8 < buf.length) {
		if (buf[i] !== 0xff) return null;
		const marker = buf[i + 1];
		if (marker === 0xff) {
			i += 1;
			continue;
		}
		if (marker === 0xd8 || marker === 0xd9) return null;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2;
			continue;
		}
		const len = buf.readUInt16BE(i + 2);
		if (len < 2) return null;
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
		}
		i += 2 + len;
	}
	return null;
}

function WebpSize(buf) {
	if (buf.length < 30) return null;
	const chunk = buf.toString('ascii', 12, 16);
	if (chunk === 'VP8 ') {
		return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
	}
	if (chunk === 'VP8L' && buf[20] === 0x2f) {
		const bits = buf.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	if (chunk === 'VP8X') {
		return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
	}
	return null;
}

function ImageSize(buf, media) {
	let size = null;
	if (media === 'image/png' && buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
		size = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
	} else if (media === 'image/gif' && buf.length >= 10) {
		size = { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
	} else if (media === 'image/jpeg') {
		size = JpegSize(buf);
	} else if (media === 'image/webp') {
		size = WebpSize(buf);
	}
	return size && size.width > 0 && size.height > 0 ? size : null;
}

/**
 * Fit inside a square of `edge` pixels. The shape stays the same.
 * @param {number} width
 * @param {number} height
 * @param {number} edge
 */
export function FitBox(width, height, edge) {
	const w = Math.max(1, Math.floor(Number(width) || 0));
	const h = Math.max(1, Math.floor(Number(height) || 0));
	const max = Math.max(1, Math.floor(Number(edge) || 0));
	if (w <= max && h <= max) return { width: w, height: h };
	const scale = max / Math.max(w, h);
	return {
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale))
	};
}

/**
 * Longest side for a game screenshot. Blank uses 512. Out of range clamps to 128–1024.
 * @param {unknown} raw
 */
export function ScreenEdge(raw) {
	if (raw == null || raw === '') return SCREEN_EDGE_DEFAULT;
	const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
	if (!Number.isFinite(n)) throw new Error('size must be a whole number of pixels.');
	return Math.min(SCREEN_EDGE_MAX, Math.max(SCREEN_EDGE_MIN, Math.round(n)));
}

async function LoadNative(buf) {
	let nativeImage = null;
	try {
		nativeImage = (await import('electron')).nativeImage;
	} catch {
		nativeImage = null;
	}
	if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
		throw new Error('Could not resize that image.');
	}
	const image = nativeImage.createFromBuffer(buf);
	if (!image || image.isEmpty()) throw new Error('Could not read that image.');
	return image;
}

/**
 * Shrink so neither side passes `edge`. A picture that already fits and is small
 * enough is kept byte for byte. PNG and JPEG can be scaled; GIF and WebP cannot.
 * @param {Buffer} buf
 * @param {string} name
 * @param {number} edge
 * @returns {Promise<{ width: number, height: number, image: { name: string, media_type: string, data: string } }>}
 */
async function FitImage(buf, name, edge) {
	const media = MediaFromMagic(buf);
	if (!media) throw new Error('Use a PNG, JPEG, GIF, or WebP image.');
	const known = ImageSize(buf, media);
	const keep = (size) => ({
		width: size.width,
		height: size.height,
		image: { name, media_type: media, data: buf.toString('base64') }
	});
	if (known) {
		const box = FitBox(known.width, known.height, edge);
		if (box.width === known.width && box.height === known.height && buf.length <= KEEP_BYTES) return keep(known);
	}
	if (media === 'image/gif' || media === 'image/webp') {
		const long = known ? Math.max(known.width, known.height) : 0;
		if (known && long <= UNSCALED_EDGE_MAX && buf.length <= MAX_IMAGE_BYTES) return keep(known);
		throw new Error('That ' + media.slice(6).toUpperCase() + ' is too large. Save it as PNG or JPEG so Loci can shrink it.');
	}
	const image = await LoadNative(buf);
	const size = image.getSize();
	const box = FitBox(size.width, size.height, edge);
	const scaled = box.width === size.width && box.height === size.height
		? image
		: image.resize({ width: box.width, height: box.height, quality: 'best' });
	let out = media === 'image/png' ? scaled.toPNG() : scaled.toJPEG(85);
	let outMedia = media;
	if (out.length > KEEP_BYTES && media === 'image/png') {
		out = scaled.toJPEG(85);
		outMedia = 'image/jpeg';
	}
	if (!out || !out.length || out.length > MAX_IMAGE_BYTES) throw new Error('Could not shrink that image enough.');
	const got = scaled.getSize();
	return {
		width: got.width || box.width,
		height: got.height || box.height,
		image: { name, media_type: outMedia, data: out.toString('base64') }
	};
}

function ReadSource(abs, label) {
	let st;
	try {
		st = fs.statSync(abs);
	} catch {
		throw new Error('The ' + label + ' file is missing.');
	}
	if (!st.isFile()) throw new Error('The ' + label + ' path is not a file.');
	if (!st.size) throw new Error('That ' + label + ' is empty.');
	if (st.size > SOURCE_MAX) throw new Error('That ' + label + ' is larger than 32 MB.');
	return fs.readFileSync(abs);
}

/**
 * A picture the user picked for a chat message. Scaled to 1568 px on the long side.
 * @param {string} filePath
 */
export async function ReadImageFile(filePath) {
	const abs = String(filePath || '');
	const media = TYPES[path.extname(abs).toLowerCase()];
	if (!media) throw new Error('Use a PNG, JPEG, GIF, or WebP image.');
	const buf = ReadSource(abs, 'image');
	if (!MatchesType(buf, media)) throw new Error('That file is not a ' + media.slice(6).toUpperCase() + ' image.');
	return (await FitImage(buf, path.basename(abs).slice(0, 120), ATTACH_EDGE)).image;
}

/**
 * Read a screenshot the game already saved and scale it to `edge`.
 * The returned bytes are what later requests send again.
 * @param {string} filePath
 * @param {number} edge
 */
export async function PrepareScreen(filePath, edge) {
	const abs = String(filePath || '').trim();
	if (!path.isAbsolute(abs)) throw new Error('The screenshot path must be absolute.');
	const buf = ReadSource(abs, 'screenshot');
	return FitImage(buf, path.basename(abs).slice(0, 120) || 'screen.png', edge);
}

/**
 * Check images sent over IPC from the renderer.
 * @param {unknown} raw
 */
export function NormalizeImages(raw) {
	const list = Array.isArray(raw) ? raw : [];
	if (!list.length) return [];
	if (list.length > MAX_IMAGES) throw new Error('You can attach up to 4 images.');
	return list.map((img) => {
		const media = String(img && img.media_type || '');
		if (!Object.values(TYPES).includes(media)) throw new Error('Use a PNG, JPEG, GIF, or WebP image.');
		const data = String(img && img.data || '');
		if (!data) throw new Error('That image is empty.');
		const buf = Buffer.from(data, 'base64');
		if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new Error('That image is larger than 4 MB.');
		if (!MatchesType(buf, media)) throw new Error('That file is not a ' + media.slice(6).toUpperCase() + ' image.');
		return {
			name: String(img.name || 'image').slice(0, 120),
			media_type: media,
			data
		};
	});
}
