import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	BuildWireSession,
	ChatHistory,
	CompactIfNeeded,
	DeriveKeepStart,
	EstimatePromptTokens,
	FindKeepTailStart,
	HiddenHistoryMessages,
	LoadCompactPrompt,
	PrefixHasReasoningArtifacts,
	ShouldCompact,
	SummarizerPrefix,
	WIRE_IMAGE_MAX,
	WireImageBytes
} from '../src/compact.js';
import { NormalizeHouseConfig } from '../src/house-config.js';
import { ApplyAnthropicCache, ApplyOpenAICache, OpenAIMessages } from '../src/llm.js';
import { IsCompactNotice, LoadSession, SpeechFromSession, TruncateToLastUser, WriteSession } from '../src/session.js';

function TempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'loci-compact-'));
}

test('compact_at defaults to 128K; 0 is off', () => {
	const cfg = NormalizeHouseConfig({});
	assert.equal(cfg.compact_at, 131072);
	assert.equal(cfg.summary_max, 16384);
	assert.equal(NormalizeHouseConfig({ compact_at: 180000 }).compact_at, 180000);
	assert.equal(NormalizeHouseConfig({ compact_at: 0 }).compact_at, 0);
	assert.equal(ShouldCompact(100, 50, 0), false);
	assert.equal(ShouldCompact(100, 50, 200), false);
	assert.equal(ShouldCompact(100, 50, 140), true);
	assert.equal(ShouldCompact(100000, 32768, 131072), true);
	assert.equal(ShouldCompact(80000, 32768, 131072), false);
});

test('keep-tail: first compact leaves the latest user on the wire', () => {
	const raw = [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' }
	];
	assert.equal(FindKeepTailStart(raw), 2);
	assert.equal(DeriveKeepStart(raw), 0);
	const wire = BuildWireSession(raw);
	assert.deepEqual(wire.map((m) => m.content), ['U1', 'A1', 'U2']);
	assert.deepEqual(SummarizerPrefix(wire).map((m) => m.content), ['U1', 'A1']);
});

test('keep-tail: later compact folds the prior summary plus U2 A2', () => {
	const raw = [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' },
		{ role: 'compact', content: 'folded U1 A1', _loci_compact: true, compact_count: 1, keep_back: 1 },
		{ role: 'assistant', content: 'A2' },
		{ role: 'user', content: 'U3' }
	];
	assert.equal(DeriveKeepStart(raw), 2);
	const wire = BuildWireSession(raw);
	assert.equal(wire[0]._loci_summary, true);
	assert.match(wire[0].content, /folded U1 A1/);
	assert.deepEqual(wire.slice(1).map((m) => m.content), ['U2', 'A2', 'U3']);
	assert.deepEqual(SummarizerPrefix(wire).map((m) => m.content || ''), [
		wire[0].content,
		'U2',
		'A2'
	]);
});

test('LoadCompactPrompt reads the templates copy', () => {
	const text = LoadCompactPrompt(TempDir());
	assert.match(text, /Context compaction was triggered/);
	assert.match(text, /already in this request/);
});

test('CompactIfNeeded is a continuation and does not store the summarizer reply', async () => {
	const dir = TempDir();
	WriteSession(dir, [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' }
	]);
	let asked = null;
	const ok = await CompactIfNeeded({
		houseDir: dir,
		compactAt: 20,
		maxTokens: 100,
		system: 'sys',
		tools: [{ type: 'function', function: { name: 'read_file' } }],
		complete: async (extra) => {
			asked = extra;
			return { text: 'User asked U1. Assistant answered A1.' };
		}
	});
	assert.equal(ok, true);
	assert.equal(asked.toolChoice, 'none');
	assert.equal(asked.reasoningEffort, 'off');
	assert.ok(asked.maxTokens <= 16384);
	const prefix = asked.session.slice(0, -1).map((m) => m.content);
	assert.deepEqual(prefix, ['U1', 'A1']);
	assert.match(asked.session.at(-1).content, /Write the compaction summary now/);
	assert.equal(asked.session.some((m) => m.content === 'U2'), false);

	const saved = LoadSession(dir);
	assert.equal(saved.length, 4);
	assert.equal(IsCompactNotice(saved[3]), true);
	assert.equal(saved[3].keep_back, 1);
	assert.equal(saved.some((m) => /Write the compaction summary now/.test(m.content || '')), false);

	const wire = BuildWireSession(saved);
	assert.equal(wire.length, 2);
	assert.equal(wire[0]._loci_summary, true);
	assert.match(wire[0].content, /User asked U1/);
	assert.equal(wire[1].content, 'U2');
});

test('many stored image bytes compact even when the token estimate is low', async () => {
	const dir = TempDir();
	const big = 'A'.repeat(WIRE_IMAGE_MAX + 4);
	WriteSession(dir, [
		{ role: 'user', content: 'U1', images: [{ name: 'a.png', media_type: 'image/png', data: big }] },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' }
	]);
	assert.equal(WireImageBytes(LoadSession(dir)), big.length);
	let asked = null;
	const ok = await CompactIfNeeded({
		houseDir: dir,
		compactAt: 1000000000,
		maxTokens: 100,
		system: 'sys',
		complete: async (extra) => {
			asked = extra;
			return { text: 'User sent a picture. Assistant answered A1.' };
		}
	});
	assert.equal(ok, true);
	assert.ok(asked);
	const wire = BuildWireSession(LoadSession(dir));
	assert.equal(WireImageBytes(wire), 0);
});

test('summarizer output cap is summary_max', async () => {
	const dir = TempDir();
	WriteSession(dir, [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' }
	]);
	let asked = null;
	await CompactIfNeeded({
		houseDir: dir,
		compactAt: 20,
		maxTokens: 32768,
		system: 'sys',
		complete: async (extra) => {
			asked = extra;
			return { text: 'folded' };
		}
	});
	assert.equal(asked.maxTokens, 16384);
	const dir2 = TempDir();
	WriteSession(dir2, [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' }
	]);
	asked = null;
	await CompactIfNeeded({
		houseDir: dir2,
		compactAt: 20,
		maxTokens: 32768,
		summaryMax: 4000,
		system: 'sys',
		complete: async (extra) => {
			asked = extra;
			return { text: 'folded' };
		}
	});
	assert.equal(asked.maxTokens, 4000);
});

test('second compact asks from summary + U2 + A2 and keeps U3', async () => {
	const dir = TempDir();
	WriteSession(dir, [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' },
		{ role: 'compact', content: 'folded U1 A1', _loci_compact: true, compact_count: 1, keep_back: 1 },
		{ role: 'assistant', content: 'A2' },
		{ role: 'user', content: 'U3' }
	]);
	let asked = null;
	const ok = await CompactIfNeeded({
		houseDir: dir,
		compactAt: 20,
		maxTokens: 100,
		system: 'sys',
		complete: async (extra) => {
			asked = extra;
			return { text: 'Prior summary plus U2 and A2.' };
		}
	});
	assert.equal(ok, true);
	const contents = asked.session.slice(0, -1).map((m) => m.content);
	assert.match(contents[0], /folded U1 A1/);
	assert.deepEqual(contents.slice(1), ['U2', 'A2']);
	assert.equal(contents.includes('U3'), false);

	const wire = BuildWireSession(LoadSession(dir));
	assert.equal(wire.length, 2);
	assert.match(wire[0].content, /Prior summary plus U2 and A2/);
	assert.equal(wire[1].content, 'U3');
});

test('compact_at 0 never calls the model', async () => {
	const dir = TempDir();
	WriteSession(dir, [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' }
	]);
	let called = 0;
	const ok = await CompactIfNeeded({
		houseDir: dir,
		compactAt: 0,
		maxTokens: 100,
		complete: async () => {
			called += 1;
			return { text: 'nope' };
		}
	});
	assert.equal(ok, false);
	assert.equal(called, 0);
	assert.equal(LoadSession(dir).length, 3);
});

test('OpenAI caching pins a stable key and does not mark only the system prompt', () => {
	const official = { messages: [] };
	ApplyOpenAICache(official, true, 'https://api.openai.com/v1', 'same system');
	const again = {};
	ApplyOpenAICache(again, true, '', 'same system');
	assert.equal(official.prompt_cache_key, again.prompt_cache_key);
	assert.equal(official.cache_control, undefined);
	const router = {};
	ApplyOpenAICache(router, true, 'https://openrouter.ai/api/v1', 'same system');
	assert.equal(router.prompt_cache_key, official.prompt_cache_key);
	assert.deepEqual(router.cache_control, { type: 'ephemeral' });
	const off = { prompt_cache_key: 'x', cache_control: { type: 'ephemeral' } };
	ApplyOpenAICache(off, false, 'https://api.openai.com/v1', 'same system');
	assert.equal(off.prompt_cache_key, undefined);
	assert.equal(off.cache_control, undefined);
});

test('Anthropic caching marks the request, not only the system prompt', () => {
	const on = { system: 'Stay put.' };
	ApplyAnthropicCache(on, true);
	assert.deepEqual(on.cache_control, { type: 'ephemeral' });
	assert.equal(on.system, 'Stay put.');
	const off = { system: 'Stay put.', cache_control: { type: 'ephemeral' } };
	ApplyAnthropicCache(off, false);
	assert.equal(off.cache_control, undefined);
	assert.equal(off.system, 'Stay put.');
});

test('OpenAIMessages drops compact notices', () => {
	const out = OpenAIMessages([
		{ role: 'user', content: 'U1' },
		{ role: 'compact', content: 'folded', _loci_compact: true },
		{ role: 'user', content: 'U2' }
	]);
	assert.deepEqual(out, [
		{ role: 'user', content: 'U1' },
		{ role: 'user', content: 'U2' }
	]);
});

test('SpeechFromSession skips compact notices', () => {
	const log = SpeechFromSession([
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'compact', content: 'folded U1 A1', _loci_compact: true },
		{ role: 'user', content: 'U2' }
	]);
	assert.deepEqual(log.map((m) => m.text), ['U1', 'A1', 'U2']);
});

test('TruncateToLastUser keeps the compact notice after the last user', () => {
	const dir = TempDir();
	WriteSession(dir, [
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' },
		{ role: 'user', content: 'U2' },
		{ role: 'compact', content: 'folded', _loci_compact: true, compact_count: 1, keep_back: 1 },
		{ role: 'assistant', content: 'A2' }
	]);
	const last = TruncateToLastUser(dir);
	assert.equal(last.content, 'U2');
	const rows = LoadSession(dir);
	assert.equal(rows.length, 4);
	assert.equal(IsCompactNotice(rows[3]), true);
});

test('EstimatePromptTokens counts thinking blocks', () => {
	const speech = EstimatePromptTokens([
		{
			role: 'assistant',
			content: 'A1',
			content_blocks: [{ type: 'text', text: 'A1' }]
		}
	], '', []);
	const withThink = EstimatePromptTokens([
		{
			role: 'assistant',
			content: 'A1',
			content_blocks: [
				{ type: 'thinking', thinking: 'x'.repeat(400) },
				{ type: 'text', text: 'A1' }
			]
		}
	], '', []);
	assert.ok(withThink > speech);
});

test('EstimatePromptTokens starts from the last counted reply', () => {
	const rows = [
		{ role: 'user', content: 'x'.repeat(4000) },
		{ role: 'assistant', content: 'A1', context_tokens: 50000 },
		{ role: 'user', content: 'y'.repeat(400) }
	];
	const n = EstimatePromptTokens(rows, 'sys'.repeat(1000), [{ name: 'read_file' }]);
	assert.equal(n, 50000 + 4 + 100);
});

test('a tool call left without a result gets a stopped result on the wire', () => {
	const wire = BuildWireSession([
		{ role: 'user', content: 'U1' },
		{
			role: 'assistant',
			content_blocks: [
				{ type: 'tool_use', id: 't1', name: 'get_state', input: {} },
				{ type: 'tool_use', id: 't2', name: 'list_actions', input: {} }
			]
		},
		{ role: 'tool', tool_call_id: 't1', name: 'get_state', content: '{"ok":true}' },
		{ role: 'user', content: 'U2' }
	]);
	assert.deepEqual(wire.map((m) => m.role), ['user', 'assistant', 'tool', 'tool', 'user']);
	assert.equal(wire[3].tool_call_id, 't2');
	assert.match(wire[3].content, /Stopped before this tool ran/);
});

test('EstimatePromptTokens grows with session text', () => {
	const small = EstimatePromptTokens([{ role: 'user', content: 'hi' }], 'sys', []);
	const large = EstimatePromptTokens(
		[{ role: 'user', content: 'U1' }, { role: 'assistant', content: 'A'.repeat(400) }, { role: 'user', content: 'U2' }],
		'sys',
		[{ name: 'read_file' }]
	);
	assert.ok(large > small);
});

test('summarizer keeps thinking when the prefix has thinking blocks', async () => {
	const dir = TempDir();
	WriteSession(dir, [
		{ role: 'user', content: 'U1' },
		{
			role: 'assistant',
			content: 'A1',
			content_blocks: [
				{ type: 'thinking', thinking: 'hmm', signature: 'sig' },
				{ type: 'text', text: 'A1' }
			]
		},
		{ role: 'user', content: 'U2' }
	]);
	assert.equal(PrefixHasReasoningArtifacts(LoadSession(dir)), true);
	let asked = null;
	await CompactIfNeeded({
		houseDir: dir,
		compactAt: 20,
		maxTokens: 100,
		system: 'sys',
		complete: async (extra) => {
			asked = extra;
			return { text: 'folded with thinking in the prefix' };
		}
	});
	assert.equal(asked.reasoningEffort, undefined);
});

test('chat_history reads the folded region with negative indices', () => {
	const raw = [
		{ role: 'user', content: 'U1 about maple', at: '2026-01-01T00:00:00.000Z' },
		{ role: 'assistant', content: 'A1', at: '2026-01-01T00:00:01.000Z' },
		{ role: 'user', content: 'U2' },
		{ role: 'compact', content: 'folded', _loci_compact: true, compact_count: 1, keep_back: 1 },
		{ role: 'assistant', content: 'A2' }
	];
	assert.deepEqual(HiddenHistoryMessages(raw).map((m) => m.content), ['U1 about maple', 'A1']);
	const probe = ChatHistory(raw, {});
	assert.equal(probe.hidden, 2);
	assert.deepEqual(probe.index_range, { start: -2, end: -1 });
	assert.deepEqual(probe.messages, []);

	const one = ChatHistory(raw, { start: -1 });
	assert.equal(one.messages.length, 1);
	assert.equal(one.messages[0].index, -1);
	assert.equal(one.messages[0].role, 'assistant');
	assert.equal(one.messages[0].content, 'A1');

	const catalog = ChatHistory(raw, { start: -2, end: -1, catalog: true });
	assert.equal(catalog.messages[0].content, undefined);
	assert.equal(catalog.messages[0].chars, 'U1 about maple'.length);

	const hit = ChatHistory(raw, { query: 'maple' });
	assert.equal(hit.matched, 1);
	assert.equal(hit.messages[0].content, 'U1 about maple');

	assert.throws(() => ChatHistory(raw, { start: -9 }), /out of range/);
});

test('chat_history is empty before anything is compacted', () => {
	const out = ChatHistory([
		{ role: 'user', content: 'U1' },
		{ role: 'assistant', content: 'A1' }
	], { start: -1 });
	assert.equal(out.hidden, 0);
	assert.deepEqual(out.messages, []);
});

test('runtime config defaults and clamps for tool rounds and command timeouts', () => {
	const cfg = NormalizeHouseConfig({});
	assert.equal(cfg.max_tool_rounds, 128);
	assert.equal(cfg.command_timeout, 600);
	assert.equal(cfg.command_timeout_max, 1800);
	assert.equal(NormalizeHouseConfig({ max_tool_rounds: 5000 }).max_tool_rounds, 1024);
	const low = NormalizeHouseConfig({ command_timeout_max: 120 });
	assert.equal(low.command_timeout, 120);
	assert.equal(NormalizeHouseConfig({ command_timeout: 9000, command_timeout_max: 3600 }).command_timeout, 3600);
});
