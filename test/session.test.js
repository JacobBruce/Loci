import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeechFromSession, StampTurnTime, StripTurnTime } from '../src/session.js';
import { AnthropicMessages, OpenAIMessages } from '../src/llm.js';

test('StampTurnTime prefixes local time once', () => {
	assert.equal(StampTurnTime('Hello', '14:32:01'), '[14:32:01]\nHello');
	assert.equal(StampTurnTime('[14:32:01]\nHello', '15:00:00'), '[14:32:01]\nHello');
	assert.equal(StampTurnTime('Hello', 'bad'), 'Hello');
	assert.equal(StripTurnTime('[14:32:01]\nHello'), 'Hello');
	assert.equal(StripTurnTime('Hello'), 'Hello');
	assert.equal(StripTurnTime('See [14:32:01]\nlater'), 'See [14:32:01]\nlater');
	assert.equal(StripTurnTime('[14:32:01]\nHello [14:32:01]\nthere'), 'Hello [14:32:01]\nthere');
});

test('SpeechFromSession hides the turn-time stamp on user lines', () => {
	const log = SpeechFromSession([
		{ role: 'user', content: '[14:32:01]\nHello' },
		{ role: 'assistant', content: 'Hi' }
	]);
	assert.deepEqual(log, [
		{ role: 'user', text: 'Hello' },
		{ role: 'assistant', text: 'Hi' }
	]);
});

test('a game or alarm wake shows as a note, not as the user', () => {
	const log = SpeechFromSession([
		{ role: 'user', content: '[21:22:07]\nThe game says (battle_start): Go.', from: 'game' },
		{ role: 'user', content: 'Hi' }
	]);
	assert.deepEqual(log, [
		{ role: 'user', text: 'The game says (battle_start): Go.', from: 'game' },
		{ role: 'user', text: 'Hi' }
	]);
});

test('assistant speech and tool calls come from content_blocks', () => {
	const row = {
		role: 'assistant',
		content_blocks: [
			{ type: 'thinking', thinking: 'look first', signature: 'sig' },
			{ type: 'text', text: 'On it.' },
			{ type: 'tool_use', id: 't1', name: 'get_state', input: {} }
		]
	};
	const log = SpeechFromSession([row]);
	assert.deepEqual(log, [{ role: 'assistant', text: 'On it.' }]);
	const wire = OpenAIMessages([row]);
	assert.equal(wire[0].content, 'On it.');
	assert.equal(wire[0].tool_calls[0].function.name, 'get_state');
	assert.equal(JSON.stringify(wire[0]).includes('look first'), false);
});

test('an attached image is sent once, text first, in each provider shape', () => {
	const row = {
		role: 'user',
		content: 'What is this?',
		images: [{ name: 'cat.png', media_type: 'image/png', data: 'AAAA' }]
	};
	const openai = OpenAIMessages([row])[0].content;
	assert.equal(openai[0].type, 'text');
	assert.equal(openai[0].text, 'What is this?');
	assert.equal(openai[1].type, 'image_url');
	assert.equal(openai[1].image_url.url, 'data:image/png;base64,AAAA');
	const claude = AnthropicMessages([row])[0].content;
	assert.equal(claude[0].type, 'text');
	assert.equal(claude[1].type, 'image');
	assert.deepEqual(claude[1].source, { type: 'base64', media_type: 'image/png', data: 'AAAA' });
	const log = SpeechFromSession([{ role: 'user', content: '[12:00:00]\n', images: row.images }]);
	assert.equal(log[0].text, '');
	assert.equal(log[0].images[0].name, 'cat.png');
});

test('a screenshot stays on its tool result and does not rewrite the earlier turn', () => {
	const earlier = {
		role: 'assistant',
		content_blocks: [
			{ type: 'thinking', thinking: 'look first', signature: 'sig' },
			{ type: 'tool_use', id: 't1', name: 'get_state', input: {} },
			{ type: 'tool_use', id: 't2', name: 'get_screen', input: {} }
		]
	};
	const rows = [
		earlier,
		{ role: 'tool', tool_call_id: 't1', name: 'get_state', content: '{"ok":true}' },
		{
			role: 'tool',
			tool_call_id: 't2',
			name: 'get_screen',
			content: '{"ok":true,"width":1,"height":1}',
			images: [{ name: 'shot.png', media_type: 'image/png', data: 'AAAA' }]
		}
	];
	const claude = AnthropicMessages(rows);
	assert.deepEqual(claude[0].content, earlier.content_blocks);
	assert.equal(claude[1].role, 'user');
	assert.equal(claude[1].content[0].type, 'tool_result');
	assert.equal(claude[1].content[0].content, '{"ok":true}');
	assert.equal(claude[1].content[1].type, 'tool_result');
	assert.equal(claude[1].content[1].content[0].text, '{"ok":true,"width":1,"height":1}');
	assert.equal(claude[1].content[1].content[1].type, 'image');
	assert.equal(claude[1].content[1].content[1].source.data, 'AAAA');
	assert.equal(JSON.stringify(claude).includes('Screenshot is attached'), false);
	const openai = OpenAIMessages(rows);
	assert.equal(openai[0].role, 'assistant');
	assert.equal(openai[1].role, 'tool');
	assert.equal(openai[1].content, '{"ok":true}');
	assert.equal(openai[2].role, 'tool');
	assert.equal(typeof openai[2].content, 'string');
	assert.equal(openai[2].content.includes('AAAA'), false);
	assert.equal(openai[3].role, 'user');
	assert.equal(openai[3].content[0].text, 'System message: Screenshot is attached.');
	assert.equal(openai[3].content[1].image_url.url, 'data:image/png;base64,AAAA');
});
