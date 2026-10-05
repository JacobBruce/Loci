import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { htmlToMarkdown } from '@mdream/js';
import { withMinimalPreset } from '@mdream/js/preset/minimal';

const require = createRequire(import.meta.url);
const LOCI_VERSION = require('../package.json').version || '1.0';
const HTTP_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
const PAGE_READ_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_TEXT_MAX_BYTES = 64 * 1024;
const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 99;
const DATA_URI_RE = /data:[^\s"'<>]*;base64,[A-Za-z0-9+/=\s]+/gi;

function UserAgent() {
	const osName = process.platform || 'Unknown';
	const runtime = process.versions.electron
		? 'Electron ' + process.versions.electron
		: 'Node ' + process.versions.node;
	return 'Loci/' + LOCI_VERSION + ' (' + osName + '; ' + runtime + ')';
}

function MappedToV4(rest) {
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) return rest;
	const parts = String(rest || '').split(':');
	if (parts.length !== 2) return '';
	const hi = parseInt(parts[0], 16);
	const lo = parseInt(parts[1], 16);
	if (!Number.isFinite(hi) || !Number.isFinite(lo)) return '';
	return ((hi >> 8) & 255) + '.' + (hi & 255) + '.' + ((lo >> 8) & 255) + '.' + (lo & 255);
}

function IPv4Local(host) {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return false;
	const p = [m[1], m[2], m[3], m[4]].map(Number);
	if (p.some((n) => n > 255)) return false;
	const a = p[0];
	const b = p[1];
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	return false;
}

function IsLocalUrl(url) {
	let host = String(url && url.hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*/, '');
	if (!host) return false;
	if (host === 'localhost' || host.endsWith('.localhost')) return true;
	const mapped = /^::ffff:(.+)$/.exec(host);
	if (mapped) {
		const v4 = MappedToV4(mapped[1]);
		return v4 ? IPv4Local(v4) : false;
	}
	if (host === '::' || host === '::1') return true;
	if (IPv4Local(host)) return true;
	const first = parseInt(host.split(':')[0] || '0', 16);
	if (!Number.isFinite(first)) return false;
	if (first >= 0xfe80 && first <= 0xfebf) return true;
	if ((first & 0xfe00) === 0xfc00) return true;
	return false;
}

function IsStop(err) {
	return !!(err && err.name === 'AbortError');
}

function StopError() {
	const err = new Error('Stopped.');
	err.name = 'AbortError';
	return err;
}

function WithTurn(start, signal) {
	if (signal && signal.aborted) return Promise.reject(StopError());
	const promise = start();
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(StopError());
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}

function RequestSignal(outer) {
	const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
	if (outer && typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, outer]);
	return outer || timeout;
}

function ScrapeShouldFallback(err) {
	const status = err && err.status;
	if (status === 401 || status === 402 || status === 403) return false;
	const msg = String(err && err.message || '');
	if (/api key|unauthori[sz]ed|authentication|forbidden/i.test(msg)) return false;
	return true;
}

function WebError(message) {
	const err = new Error(message);
	err.name = 'ToolError';
	return err;
}

function ParseObject(raw, hint) {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
	const src = String(raw || '').trim();
	if (!src) throw WebError(hint);
	let obj;
	try {
		obj = JSON.parse(src);
	} catch {
		throw WebError(hint);
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw WebError(hint);
	return obj;
}

function HttpUrl(raw) {
	const text = String(raw || '').trim();
	if (!text) throw WebError('url is required.');
	let url;
	try {
		url = new URL(text);
	} catch {
		throw WebError('url is not valid.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw WebError('url must be http or https.');
	}
	return url;
}

function CapText(text, maxBytes) {
	const src = String(text || '').replace(DATA_URI_RE, '[omitted data URI]');
	const encoded = Buffer.from(src, 'utf8');
	if (encoded.length <= maxBytes) return { text: src, truncated: false };
	const cut = encoded.subarray(0, maxBytes).toString('utf8');
	return {
		text: cut + '\n\n[truncated: showing ' + maxBytes + ' of ' + encoded.length + ' bytes]',
		truncated: true
	};
}

function Field(row, camel, snake) {
	if (!row || typeof row !== 'object') return '';
	const value = row[camel] != null ? row[camel] : row[snake];
	return value == null ? '' : String(value);
}

function SearchRows(results, key) {
	if (!results || typeof results !== 'object') return [];
	if (Array.isArray(results[key])) return results[key];
	if (results.data && Array.isArray(results.data[key])) return results.data[key];
	return [];
}

function FormatSearch(results, mode) {
	if (typeof results === 'string') throw WebError(results);
	const rows = SearchRows(results, mode);
	const out = [];
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const item = {
			url: Field(row, 'url', 'url'),
			title: Field(row, 'title', 'title')
		};
		if (mode === 'news') {
			item.snippet = Field(row, 'snippet', 'snippet');
			item.date = Field(row, 'date', 'date');
		} else if (mode === 'images') {
			item.image_url = Field(row, 'imageUrl', 'image_url');
			const width = row.imageWidth != null ? row.imageWidth : row.image_width;
			const height = row.imageHeight != null ? row.imageHeight : row.image_height;
			if (width != null) item.image_width = width;
			if (height != null) item.image_height = height;
		} else {
			item.description = Field(row, 'description', 'description');
		}
		out.push(item);
	}
	return out;
}

function SearchLimit(raw) {
	if (raw == null || raw === '') return SEARCH_LIMIT_DEFAULT;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) throw WebError('limit must be a positive integer.');
	return Math.min(n, SEARCH_LIMIT_MAX);
}

/**
 * Firecrawl search. A Settings key raises the rate limit; without one, search uses the free tier.
 * @param {string|object} payload
 * @param {{ apiKey?: string, search?: Function }} [opts]
 */
export async function SearchWeb(payload, opts) {
	const hint = 'payload must be JSON: {"query":"…","search_mode":"web","category":"","location":"","limit":10}';
	const obj = ParseObject(payload, hint);
	const query = String(obj.query || '').trim();
	if (!query) throw WebError('query is required.');
	const mode = String(obj.search_mode || obj.mode || 'web').trim().toLowerCase();
	if (mode !== 'web' && mode !== 'news' && mode !== 'images') {
		throw WebError('search_mode must be web, news, or images.');
	}
	const category = String(obj.category || '').trim().toLowerCase();
	if (category && category !== 'research' && category !== 'github') {
		throw WebError('category must be research or github.');
	}
	const location = String(obj.location || '').trim();
	const limit = SearchLimit(obj.limit != null ? obj.limit : obj.max_results);
	const apiKey = String(opts && opts.apiKey || '').trim();
	const kwargs = { limit, highlights: false };
	if (category) {
		kwargs.categories = [category];
	} else {
		kwargs.sources = [mode];
		if (location) kwargs.location = location;
	}
	const search = opts && opts.search ? opts.search : await DefaultSearch(apiKey);
	let results;
	try {
		results = await WithTurn(() => search(query, kwargs), opts && opts.signal);
	} catch (err) {
		if (IsStop(err)) throw err;
		throw WebError('Search failed: ' + (err && err.message ? err.message : err));
	}
	const bucket = category ? 'web' : mode;
	return {
		query,
		search_mode: category ? 'web' : mode,
		category,
		results: FormatSearch(results, bucket)
	};
}

async function FirecrawlClient(apiKey) {
	const { Firecrawl } = await import('firecrawl');
	const key = String(apiKey || '').trim();
	const opts = { timeoutMs: HTTP_TIMEOUT_MS + 5000, maxRetries: 1 };
	return key ? new Firecrawl({ apiKey: key, ...opts }) : new Firecrawl(opts);
}

async function DefaultSearch(apiKey) {
	const client = await FirecrawlClient(apiKey);
	return (query, kwargs) => client.search(query, { ...kwargs, timeout: HTTP_TIMEOUT_MS });
}

async function DefaultScrape(apiKey) {
	const client = await FirecrawlClient(apiKey);
	return (url, format) => client.scrape(url, {
		formats: [format],
		timeout: HTTP_TIMEOUT_MS,
		autoResume: false
	});
}

function ScrapeText(doc, format) {
	if (!doc || typeof doc !== 'object') return '';
	if (typeof doc === 'string') return doc;
	if (format === 'html') return String(doc.html || (doc.data && doc.data.html) || '');
	return String(doc.markdown || (doc.data && doc.data.markdown) || '');
}

async function ReadHttp(url, maxBytes, fetchImpl, signal) {
	if (signal && signal.aborted) throw StopError();
	const fetchFn = fetchImpl || globalThis.fetch;
	let res;
	try {
		res = await fetchFn(url, {
			redirect: 'follow',
			signal: RequestSignal(signal),
			headers: { 'User-Agent': UserAgent(), Accept: '*/*' }
		});
	} catch (err) {
		if (signal && signal.aborted) throw StopError();
		const name = err && err.name;
		if (name === 'TimeoutError' || name === 'AbortError') {
			throw WebError('Request timed out after 30 seconds.');
		}
		throw WebError('Request failed: ' + (err && err.message ? err.message : err));
	}
	const finalUrl = String(res.url || url);
	let parsed;
	let original;
	try {
		parsed = new URL(finalUrl);
		original = new URL(url);
	} catch {
		throw WebError('url is not valid.');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw WebError('url must be http or https.');
	}
	if (IsLocalUrl(parsed) && !IsLocalUrl(original)) {
		throw WebError('Refusing to follow a redirect to a local address.');
	}
	if (!res.ok) throw WebError('HTTP ' + res.status + ' for ' + url);
	if (!res.body) throw WebError('Empty response from ' + url);
	const reader = res.body.getReader();
	const chunks = [];
	let n = 0;
	while (true) {
		const step = await reader.read();
		if (step.done) break;
		n += step.value.byteLength;
		if (n > maxBytes) {
			await reader.cancel();
			throw WebError('Response exceeded ' + maxBytes + ' bytes.');
		}
		chunks.push(Buffer.from(step.value));
	}
	return { bytes: Buffer.concat(chunks), finalUrl };
}

/**
 * Page text. Public pages go through Firecrawl (free tier without a key).
 * A direct fetch is the fallback, and the only path for local addresses.
 * @param {string|object} payload
 * @param {{ apiKey?: string, scrape?: Function, fetch?: Function, signal?: AbortSignal, maxTextBytes?: number }} [opts]
 */
export async function GetWebPage(payload, opts) {
	const hint = 'payload must be JSON: {"url":"https://…","format":"markdown"}';
	const obj = ParseObject(payload, hint);
	const url = HttpUrl(obj.url);
	const format = String(obj.format || 'markdown').trim().toLowerCase();
	if (format !== 'markdown' && format !== 'html') {
		throw WebError('format must be markdown or html.');
	}
	const maxText = opts && opts.maxTextBytes ? opts.maxTextBytes : PAGE_TEXT_MAX_BYTES;
	const apiKey = String(opts && opts.apiKey || '').trim();
	const signal = opts && opts.signal;
	let scrapeError = null;
	if (!IsLocalUrl(url)) {
		try {
			const scrape = opts && opts.scrape ? opts.scrape : await DefaultScrape(apiKey);
			const doc = await WithTurn(() => scrape(url.href, format), signal);
			const scraped = typeof doc === 'string' ? doc : ScrapeText(doc, format);
			if (scraped) {
				const capped = CapText(scraped, maxText);
				return { url: url.href, format, text: capped.text, truncated: capped.truncated };
			}
		} catch (err) {
			if (IsStop(err)) throw err;
			if (!ScrapeShouldFallback(err) || (opts && opts.scrape && !opts.fetch)) {
				throw WebError('Page fetch failed: ' + (err && err.message ? err.message : err));
			}
			scrapeError = err;
		}
	}
	let got;
	try {
		got = await ReadHttp(url.href, PAGE_READ_MAX_BYTES, opts && opts.fetch, signal);
	} catch (err) {
		if (IsStop(err)) throw err;
		if (!scrapeError) throw err;
		const direct = err && err.message ? err.message : err;
		const scrapeMsg = scrapeError && scrapeError.message ? scrapeError.message : scrapeError;
		throw WebError('Page fetch failed: ' + scrapeMsg + ' Direct fetch failed: ' + direct);
	}
	const raw = got.bytes.toString('utf8');
	if (format === 'html') {
		const capped = CapText(raw, maxText);
		return { url: got.finalUrl, format, text: capped.text, truncated: capped.truncated };
	}
	let markdown = raw;
	try {
		markdown = htmlToMarkdown(raw, withMinimalPreset({ origin: url.origin }));
	} catch (err) {
		throw WebError('Could not convert that page to markdown: ' + (err && err.message ? err.message : err));
	}
	const capped = CapText(markdown, maxText);
	return { url: got.finalUrl, format, text: capped.text, truncated: capped.truncated };
}

function DownloadName(url, requested) {
	const given = String(requested || '').trim();
	const fromUrl = path.posix.basename(url.pathname);
	const base = path.basename(given || fromUrl || 'download');
	if (!base || base === '.' || base === '..') return 'download';
	if (base.includes('\0')) throw WebError('filename is not valid.');
	return base;
}

/**
 * Save an http(s) file under artifacts/. Returns the palace path.
 * @param {string} houseDir
 * @param {string|object} payload
 * @param {{ fetch?: Function, maxBytes?: number }} [opts]
 */
export async function DownloadFile(houseDir, payload, opts) {
	const hint = 'payload must be JSON: {"url":"https://…","filename":"optional"}';
	const obj = ParseObject(payload, hint);
	const url = HttpUrl(obj.url);
	const filename = DownloadName(url, obj.filename);
	const maxBytes = opts && opts.maxBytes ? opts.maxBytes : DOWNLOAD_MAX_BYTES;
	const got = await ReadHttp(url.href, maxBytes, opts && opts.fetch, opts && opts.signal);
	const dir = path.join(houseDir, 'artifacts');
	fs.mkdirSync(dir, { recursive: true });
	const dest = path.join(dir, filename);
	fs.writeFileSync(dest, got.bytes);
	return {
		path: 'artifacts/' + filename,
		filename,
		size_bytes: got.bytes.length,
		url: got.finalUrl
	};
}
