import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// loop.js reaches Electron through settings.js. Stand in a tiny `app` whose userData
// folder is set per test, so the loop runs under plain Node.
const ELECTRON_STUB = 'export const app = { getPath: () => process.env.LOCI_TEST_USER_DATA, isPackaged: false };';
register('data:text/javascript,' + encodeURIComponent(
	'export async function resolve(specifier, context, next) {' +
	'\tif (specifier === "electron") return { url: "data:text/javascript," + encodeURIComponent(' + JSON.stringify(ELECTRON_STUB) + '), shortCircuit: true };' +
	'\treturn next(specifier, context);' +
	'}'
));

const { EnqueueChat } = await import('../src/loop.js');
const { CreateHouse } = await import('../src/house.js');
const { PatchHouseConfig } = await import('../src/house-config.js');
const { LoadSession } = await import('../src/session.js');

/** A chat.completions endpoint that asks for a tool on every round unless tool_choice is none. */
function FakeModel() {
	const requests = [];
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => { raw += chunk; });
		req.on('end', () => {
			const body = JSON.parse(raw);
			requests.push(body);
			const n = requests.length;
			const message = body.tool_choice === 'none'
				? { role: 'assistant', content: 'Wrapping up: examined the clock.' }
				: {
					role: 'assistant',
					content: '',
					tool_calls: [{ id: 'call_' + n, type: 'function', function: { name: 'list_objects', arguments: '{}' } }]
				};
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({
				id: 'r' + n,
				object: 'chat.completion',
				created: 0,
				model: body.model,
				choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
			}));
		});
	});
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve({
			requests,
			url: 'http://127.0.0.1:' + server.address().port + '/v1',
			close: () => new Promise((done) => server.close(done))
		}));
	});
}

function RunChat(root, slug, text) {
	const events = [];
	return new Promise((resolve) => {
		EnqueueChat(root, slug, text, (event) => {
			events.push(event);
			if (event.type === 'working' && event.working === false) resolve(events);
		});
	});
}

test('at the tool round limit the agent is told, then gets one reply without tools', async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loci-loop-'));
	const root = path.join(tmp, 'houses');
	const model = await FakeModel();
	try {
		process.env.LOCI_TEST_USER_DATA = path.join(tmp, 'user-data');
		fs.mkdirSync(process.env.LOCI_TEST_USER_DATA);
		fs.writeFileSync(path.join(process.env.LOCI_TEST_USER_DATA, 'config.json'), JSON.stringify({
			provider: 'openai',
			model: 'fake',
			openai_api_key: 'test',
			openai_base_url: model.url
		}), 'utf8');
		const house = CreateHouse(root, { name: 'Maple' });
		PatchHouseConfig(root, house.slug, { max_tool_rounds: 2, compact_at: 0 });

		const events = await RunChat(root, house.slug, 'Look around.');

		// Two tool rounds, then a wrap-up request that forbids tools.
		assert.equal(model.requests.length, 3);
		assert.equal(model.requests[0].tool_choice, 'auto');
		assert.equal(model.requests[2].tool_choice, 'none');
		assert.ok(model.requests[2].tools.length > 0);

		const tools = LoadSession(house.path).filter((row) => row.role === 'tool');
		assert.equal(tools.length, 2);
		assert.equal(JSON.parse(tools[0].content).round_limit, undefined);
		assert.match(JSON.parse(tools[1].content).round_limit, /tool round 2 of 2/);

		assert.ok(events.some((e) => e.type === 'speech' && /Wrapping up/.test(e.text)));
		assert.ok(events.some((e) => e.type === 'error' && /limit of 2 tool rounds/.test(e.text)));
	} finally {
		await model.close();
	}
});
