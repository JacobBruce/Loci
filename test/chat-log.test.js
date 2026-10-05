import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_LOG_FIRST, CHAT_LOG_MORE, OlderChatRange } from '../src/chat-log.js';

test('the first page is the tail, then older slices walk backward', () => {
	assert.equal(CHAT_LOG_FIRST, 32);
	assert.equal(CHAT_LOG_MORE, 8);
	const total = 50;
	const first = OlderChatRange(total, 0, CHAT_LOG_FIRST);
	assert.deepEqual(first, { start: 18, count: 32 });
	let shown = first.count;
	const next = OlderChatRange(total, shown, CHAT_LOG_MORE);
	assert.deepEqual(next, { start: 10, count: 8 });
	shown += next.count;
	assert.deepEqual(OlderChatRange(total, shown, CHAT_LOG_MORE), { start: 2, count: 8 });
	shown += 8;
	assert.deepEqual(OlderChatRange(total, shown, CHAT_LOG_MORE), { start: 0, count: 2 });
	shown += 2;
	assert.deepEqual(OlderChatRange(total, shown, CHAT_LOG_MORE), { start: 0, count: 0 });
});

test('a short log shows everything and does not ask for more', () => {
	assert.deepEqual(OlderChatRange(3, 0, CHAT_LOG_FIRST), { start: 0, count: 3 });
	assert.deepEqual(OlderChatRange(3, 3, CHAT_LOG_MORE), { start: 0, count: 0 });
});
