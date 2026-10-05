import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallAgpi } from '../src/agpi.js';
import { BumpTurns, WorldTurns } from '../src/world.js';
import { DownloadFile, GetWebPage, SearchWeb } from '../src/web.js';

function TempHouse() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-web-'));
	fs.writeFileSync(path.join(dir, 'BOOT.md'), '# Boot\n', 'utf8');
	return dir;
}

function Ctx(houseDir, extra) {
	return {
		houseDir,
		name: 'Maple',
		slug: 'maple',
		workspaces: [],
		...extra
	};
}

function Listen(handler) {
	return new Promise((resolve, reject) => {
		const server = http.createServer(handler);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			resolve({
				port: addr.port,
				close: () => new Promise((done) => server.close(done))
			});
		});
		server.on('error', reject);
	});
}

test('search_web uses Firecrawl without a key and formats the hits', async () => {
	const houseDir = TempHouse();
	const listed = await CallAgpi(Ctx(houseDir, { agent_web: false }), 'list_actions', { target: 'pc' });
	assert.equal(listed.actions.some((row) => row.action === 'search_web'), false);
	const refused = await CallAgpi(Ctx(houseDir, { agent_web: false }), 'send_action', {
		action: 'search_web',
		target: 'pc',
		payload: JSON.stringify({ query: 'loci' })
	});
	assert.equal(refused.ok, false);
	assert.match(refused.error, /disabled/);

	const open = await SearchWeb({ query: 'loci' }, {
		search: async () => ({ web: [{ url: 'https://ex.test', title: 'T', description: 'd' }] })
	});
	assert.equal(open.results[0].title, 'T');

	const news = await SearchWeb({ query: 'loci', search_mode: 'news', limit: 2 }, {
		apiKey: 'test',
		search: async (query, kwargs) => {
			assert.equal(query, 'loci');
			assert.deepEqual(kwargs.sources, ['news']);
			assert.equal(kwargs.location, undefined);
			assert.equal(kwargs.limit, 2);
			return {
				news: [{ url: 'https://ex.test/a', title: 'A', snippet: 's', date: 'today' }]
			};
		}
	});
	assert.equal(news.search_mode, 'news');
	assert.equal(news.results[0].snippet, 's');
	assert.equal(news.results[0].date, 'today');

	const github = await SearchWeb({
		query: 'loci',
		search_mode: 'news',
		category: 'github',
		location: 'Australia'
	}, {
		apiKey: 'test',
		search: async (_query, kwargs) => {
			assert.deepEqual(kwargs.categories, ['github']);
			assert.equal(kwargs.sources, undefined);
			assert.equal(kwargs.location, undefined);
			return {
				web: [{ url: 'https://github.com/x', title: 'X', description: 'd' }]
			};
		}
	});
	assert.equal(github.search_mode, 'web');
	assert.equal(github.category, 'github');
	assert.equal(github.results[0].description, 'd');

	await assert.rejects(
		() => SearchWeb({ query: 'loci', limit: 0 }, { apiKey: 'test', search: async () => ({}) }),
		/limit/
	);
});

test('get_web_page fetches markdown without a key and rejects other schemes', async () => {
	let seenAgent = '';
	const server = await Listen((req, res) => {
		seenAgent = String(req.headers['user-agent'] || '');
		res.setHeader('Content-Type', 'text/html');
		res.end('<html><body><main><h1>Hello</h1><p>From the page.</p></main></body></html>');
	});
	try {
		const page = await GetWebPage({
			url: 'http://127.0.0.1:' + server.port + '/note'
		});
		assert.match(seenAgent, /^Loci\/\d+\.\d+\.\d+ \([^;]+; /);
		assert.equal(page.format, 'markdown');
		assert.match(page.text, /Hello/);
		assert.match(page.text, /From the page/);
		assert.equal(page.truncated, false);

		const html = await GetWebPage({
			url: 'http://127.0.0.1:' + server.port + '/note',
			format: 'html'
		});
		assert.match(html.text, /<h1>Hello<\/h1>/);

		await assert.rejects(
			() => GetWebPage({ url: 'file:///etc/passwd' }),
			/http or https/
		);

		const scraped = await GetWebPage({ url: 'https://example.com/a' }, {
			scrape: async (url, format) => {
				assert.equal(url, 'https://example.com/a');
				assert.equal(format, 'markdown');
				return { markdown: '# From Firecrawl' };
			}
		});
		assert.match(scraped.text, /From Firecrawl/);

		let scrapedLocal = false;
		const local = await GetWebPage({ url: 'http://[::ffff:127.0.0.1]/note' }, {
			scrape: async () => {
				scrapedLocal = true;
				return { markdown: 'no' };
			},
			fetch: async () => ({
				ok: true,
				status: 200,
				url: 'http://[::ffff:127.0.0.1]/note',
				body: Reader('<h1>Local</h1>')
			})
		});
		assert.equal(scrapedLocal, false);
		assert.match(local.text, /Local/);

		let fetchedAuth = false;
		await assert.rejects(
			() => GetWebPage({ url: 'https://example.com/secret' }, {
				scrape: async () => {
					const err = new Error('Invalid API key');
					err.status = 401;
					throw err;
				},
				fetch: async () => {
					fetchedAuth = true;
					return { ok: true, status: 200, url: 'https://example.com/secret', body: Reader('x') };
				}
			}),
			/Invalid API key/
		);
		assert.equal(fetchedAuth, false);

		await assert.rejects(
			() => GetWebPage({ url: 'https://example.com/go' }, {
				scrape: async () => {
					throw new Error('Firecrawl down');
				},
				fetch: async () => ({
					ok: true,
					status: 200,
					url: 'http://127.0.0.1/secret',
					body: Reader('nope')
				})
			}),
			/local address/
		);

		const stopped = new AbortController();
		stopped.abort();
		await assert.rejects(
			() => GetWebPage({ url: 'https://example.com/a' }, {
				signal: stopped.signal,
				scrape: async () => ({ markdown: 'late' })
			}),
			(err) => err && err.name === 'AbortError'
		);
	} finally {
		await server.close();
	}
});

function Reader(text) {
	const bytes = Buffer.from(text);
	let done = false;
	return {
		getReader() {
			return {
				read: async () => {
					if (done) return { done: true, value: undefined };
					done = true;
					return { done: false, value: bytes };
				},
				cancel: async () => {}
			};
		}
	};
}

test('download_file writes artifacts and keeps the basename', async () => {
	const houseDir = TempHouse();
	const server = await Listen((_req, res) => {
		res.end('hello');
	});
	try {
		const out = await CallAgpi(Ctx(houseDir), 'send_action', {
			action: 'download_file',
			target: 'pc',
			payload: JSON.stringify({
				url: 'http://127.0.0.1:' + server.port + '/files/a.txt',
				filename: '../notes.txt'
			})
		});
		assert.equal(out.ok, true);
		assert.equal(out.path, 'artifacts/notes.txt');
		assert.equal(fs.readFileSync(path.join(houseDir, 'artifacts', 'notes.txt'), 'utf8'), 'hello');
		assert.equal(fs.existsSync(path.join(houseDir, 'notes.txt')), false);

		await assert.rejects(
			() => DownloadFile(houseDir, { url: 'http://127.0.0.1:' + server.port + '/big', filename: 'big.bin' }, { maxBytes: 4 }),
			/exceeded/
		);
		assert.equal(fs.existsSync(path.join(houseDir, 'artifacts', 'big.bin')), false);
	} finally {
		await server.close();
	}
});

test('a web action does not write back a world loaded before it awaited', async () => {
	const houseDir = TempHouse();
	// The world changes while the download is in flight (another writer bumps the turn count).
	const server = await Listen((_req, res) => {
		BumpTurns(houseDir);
		res.end('hello');
	});
	try {
		const out = await CallAgpi(Ctx(houseDir), 'send_action', {
			action: 'download_file',
			target: 'pc',
			payload: JSON.stringify({ url: 'http://127.0.0.1:' + server.port + '/a.txt' })
		});
		assert.equal(out.ok, true);
		assert.equal(WorldTurns(houseDir), 1);
	} finally {
		await server.close();
	}
});
