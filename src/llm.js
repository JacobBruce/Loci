import { createHash } from 'node:crypto';
import { AssistantText, AssistantToolCalls, UserImages } from './session.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MAX_TOKENS = 32768;
const MIN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
	'HTTP-Referer': 'https://bitfreak.info/?page=loci',
	'X-OpenRouter-Title': 'Loci'
};

/** Anthropic's SDK throws unless timeout is set when max_tokens implies >10 minutes. */
function RequestTimeoutMs(maxTokens) {
	const n = Number(maxTokens) || DEFAULT_MAX_TOKENS;
	const scaled = Math.ceil((MAX_TIMEOUT_MS * n) / 128000);
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, scaled));
}

function OfficialOpenAI(baseUrl) {
	const host = String(baseUrl || '').trim().toLowerCase();
	if (!host) return true;
	return host.includes('openai.com') || host.includes('api.openai');
}

function IsOpenRouterHost(baseUrl) {
	return String(baseUrl || '').toLowerCase().includes('openrouter.ai');
}

function UsesOpenRouter(opts) {
	return opts.provider === 'openrouter' || IsOpenRouterHost(opts.baseUrl);
}

function OpenAIBaseURL(opts, openRouter) {
	if (opts.provider === 'openrouter') return OPENROUTER_BASE;
	if (openRouter) return NormalizeOpenAIBase(opts.baseUrl);
	if (OfficialOpenAI(opts.baseUrl)) return undefined;
	return NormalizeOpenAIBase(opts.baseUrl);
}

function OfficialAnthropic(baseUrl) {
	const host = String(baseUrl || '').trim().toLowerCase();
	return !host || host.includes('api.anthropic.com');
}

function NormalizeOpenAIBase(baseUrl) {
	const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
	return raw || undefined;
}

function NormalizeAnthropicBase(baseUrl) {
	let raw = String(baseUrl || '').trim().replace(/\/+$/, '');
	if (!raw) return undefined;
	if (raw.endsWith('/v1')) raw = raw.slice(0, -3).replace(/\/+$/, '');
	return raw || undefined;
}

/**
 * @param {object[]} specs OpenAI-style tool list from ToolSpecs()
 */
export function ToolsForAnthropic(specs) {
	return (specs || []).map((s) => {
		const fn = s && s.function ? s.function : s;
		return {
			name: fn.name,
			description: fn.description || '',
			input_schema: fn.parameters || { type: 'object', properties: {} }
		};
	});
}

function ScreenshotUser(img) {
	return {
		role: 'user',
		content: [
			{ type: 'text', text: 'System message: Screenshot is attached.' },
			{
				type: 'image_url',
				image_url: { url: 'data:' + img.media_type + ';base64,' + img.data }
			}
		]
	};
}

/**
 * Session rows → OpenAI chat.completions messages (no system).
 * @param {object[]} session
 */
export function OpenAIMessages(session) {
	const out = [];
	const shots = [];
	const flushShots = () => {
		for (const img of shots) out.push(ScreenshotUser(img));
		shots.length = 0;
	};
	for (const m of session || []) {
		if (!m || !m.role) continue;
		if (m.role === 'tool') {
			out.push({
				role: 'tool',
				tool_call_id: m.tool_call_id,
				content: String(m.content || '')
			});
			// Tool messages are text only. The picture follows the whole tool group.
			for (const img of UserImages(m)) shots.push(img);
			continue;
		}
		flushShots();
		if (m.role === 'compact' || m._loci_compact) continue;
		if (m.role === 'assistant') {
			const text = AssistantText(m);
			const calls = AssistantToolCalls(m);
			const msg = { role: 'assistant', content: text || null };
			if (calls.length) {
				msg.tool_calls = calls.map((tc) => ({
					id: tc.id,
					type: 'function',
					function: {
						name: tc.name,
						arguments: typeof tc.arguments === 'string'
							? tc.arguments
							: JSON.stringify(tc.arguments || {})
					}
				}));
			}
			out.push(msg);
			continue;
		}
		if (m.role === 'user') {
			const images = UserImages(m);
			const text = String(m.content || '');
			if (!images.length) {
				out.push({ role: 'user', content: text });
				continue;
			}
			const parts = [];
			if (text) parts.push({ type: 'text', text });
			for (const img of images) {
				parts.push({
					type: 'image_url',
					image_url: { url: 'data:' + img.media_type + ';base64,' + img.data }
				});
			}
			out.push({ role: 'user', content: parts });
		}
	}
	flushShots();
	return out;
}

function ParseArgs(raw) {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function PushAnthropicUser(out, content) {
	const last = out[out.length - 1];
	if (last && last.role === 'user') {
		const prev = last.content;
		const blocks = Array.isArray(prev)
			? prev.slice()
			: [{ type: 'text', text: String(prev || '') }];
		if (typeof content === 'string') blocks.push({ type: 'text', text: content });
		else if (Array.isArray(content)) blocks.push(...content);
		last.content = blocks;
		return;
	}
	out.push({ role: 'user', content });
}

/**
 * Session rows → Anthropic messages.create messages (no system).
 * Consecutive user turns are merged so the wire still alternates.
 * @param {object[]} session
 */
export function AnthropicMessages(session) {
	const out = [];
	let pending = [];
	const flush = () => {
		if (!pending.length) return;
		PushAnthropicUser(out, pending);
		pending = [];
	};
	for (const m of session || []) {
		if (!m || !m.role) continue;
		if (m.role === 'tool') {
			const images = UserImages(m);
			const text = String(m.content || '');
			if (!images.length) {
				pending.push({
					type: 'tool_result',
					tool_use_id: m.tool_call_id,
					content: text
				});
				continue;
			}
			const blocks = [];
			if (text) blocks.push({ type: 'text', text });
			for (const img of images) {
				blocks.push({
					type: 'image',
					source: { type: 'base64', media_type: img.media_type, data: img.data }
				});
			}
			pending.push({
				type: 'tool_result',
				tool_use_id: m.tool_call_id,
				content: blocks
			});
			continue;
		}
		if (m.role === 'compact' || m._loci_compact) continue;
		flush();
		if (m.role === 'user') {
			const images = UserImages(m);
			if (!images.length) {
				PushAnthropicUser(out, String(m.content || ''));
				continue;
			}
			const blocks = [];
			const text = String(m.content || '');
			if (text) blocks.push({ type: 'text', text });
			for (const img of images) {
				blocks.push({
					type: 'image',
					source: { type: 'base64', media_type: img.media_type, data: img.data }
				});
			}
			PushAnthropicUser(out, blocks);
			continue;
		}
		if (m.role !== 'assistant') continue;
		const stored = CloneBlocks(m.content_blocks);
		if (stored.length) {
			out.push({ role: 'assistant', content: stored });
			continue;
		}
		const blocks = [];
		if (m.content) blocks.push({ type: 'text', text: String(m.content) });
		for (const tc of m.tool_calls || []) {
			blocks.push({
				type: 'tool_use',
				id: tc.id,
				name: tc.name,
				input: ParseArgs(tc.arguments)
			});
		}
		if (blocks.length) out.push({ role: 'assistant', content: blocks });
	}
	flush();
	return out;
}

function ParseOpenAIToolCalls(msg) {
	const calls = [];
	for (const tc of msg && msg.tool_calls || []) {
		const fn = tc.function || {};
		calls.push({
			id: tc.id,
			name: fn.name,
			arguments: ParseArgs(fn.arguments)
		});
	}
	return calls;
}

function CloneBlocks(blocks) {
	if (!Array.isArray(blocks) || !blocks.length) return [];
	try {
		return JSON.parse(JSON.stringify(blocks)).filter((b) => b && typeof b === 'object' && b.type);
	} catch {
		return [];
	}
}

function ParseAnthropicToolCalls(content) {
	const calls = [];
	let text = '';
	const contentBlocks = CloneBlocks(content);
	for (const block of contentBlocks) {
		if (block.type === 'text' && block.text) text += block.text;
		if (block.type === 'tool_use') {
			calls.push({
				id: block.id,
				name: block.name,
				arguments: ParseArgs(block.input)
			});
		}
	}
	return { text, toolCalls: calls, contentBlocks };
}

/**
 * One model round (not the full tool loop).
 * @param {object} opts
 * @returns {Promise<{ text: string, toolCalls: { id: string, name: string, arguments: object }[] }>}
 */
export async function CompleteRound(opts) {
	const provider = opts.provider === 'anthropic'
		? 'anthropic'
		: (opts.provider === 'openrouter' ? 'openrouter' : 'openai');
	const model = String(opts.model || '').trim();
	if (!model) throw new Error('Set a model on this house, or add one under Models.');
	const tools = opts.tools || [];
	const maxTokens = Number(opts.maxTokens) || DEFAULT_MAX_TOKENS;
	const signal = opts.signal;
	if (provider === 'anthropic') {
		return CompleteAnthropic({ ...opts, provider, model, tools, maxTokens, signal });
	}
	return CompleteOpenAI({ ...opts, provider, model, tools, maxTokens, signal });
}

async function CompleteOpenAI(opts) {
	const apiKey = String(opts.apiKey || '').trim();
	const openRouter = UsesOpenRouter(opts);
	if (!apiKey) {
		throw new Error(openRouter
			? 'Set an OpenRouter API key in Settings.'
			: 'Set an OpenAI API key in Settings.');
	}
	const official = !openRouter && OfficialOpenAI(opts.baseUrl);
	const baseURL = OpenAIBaseURL(opts, openRouter);
	const clientOpts = { apiKey, baseURL };
	if (openRouter) clientOpts.defaultHeaders = OPENROUTER_HEADERS;
	const client = new OpenAI(clientOpts);
	const messages = [
		{ role: 'system', content: opts.system },
		...OpenAIMessages(opts.session)
	];
	const body = {
		model: opts.model,
		messages
	};
	if (opts.tools && opts.tools.length) {
		body.tools = opts.tools;
		body.tool_choice = opts.toolChoice === 'none' ? 'none' : 'auto';
	}
	if (official) {
		body.max_completion_tokens = opts.maxTokens;
	} else {
		body.max_tokens = opts.maxTokens;
		body.temperature = 0.7;
	}
	ApplyOpenAIThinking(body, opts.reasoningEffort, official);
	ApplyOpenAICache(body, opts.promptCache, baseURL || opts.baseUrl, opts.system);
	const resp = await client.chat.completions.create(body, {
		signal: opts.signal,
		timeout: RequestTimeoutMs(opts.maxTokens)
	});
	const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
	if (!msg) throw new Error('The model returned an empty reply.');
	return {
		text: String(msg.content || ''),
		toolCalls: ParseOpenAIToolCalls(msg),
		contextTokens: OpenAIContextTokens(resp && resp.usage)
	};
}

/** Prompt plus the reply as it will be replayed. Reasoning tokens are not sent back on chat completions. */
function OpenAIContextTokens(usage) {
	if (!usage) return 0;
	const prompt = Number(usage.prompt_tokens) || 0;
	const reply = Number(usage.completion_tokens) || 0;
	const details = usage.completion_tokens_details || {};
	const reasoning = Number(details.reasoning_tokens) || 0;
	return prompt + Math.max(0, reply - reasoning);
}

/** Everything the next request will resend: fresh, cached, and cache-written input plus this reply. */
function AnthropicContextTokens(usage) {
	if (!usage) return 0;
	return (Number(usage.input_tokens) || 0)
		+ (Number(usage.cache_creation_input_tokens) || 0)
		+ (Number(usage.cache_read_input_tokens) || 0)
		+ (Number(usage.output_tokens) || 0);
}

async function CompleteAnthropic(opts) {
	const apiKey = String(opts.apiKey || '').trim();
	if (!apiKey) throw new Error('Set an Anthropic API key in Settings.');
	const official = OfficialAnthropic(opts.baseUrl);
	const clientOpts = official
		? { apiKey }
		: { apiKey, authToken: apiKey };
	const baseURL = NormalizeAnthropicBase(opts.baseUrl);
	if (baseURL) clientOpts.baseURL = baseURL;
	const client = new Anthropic(clientOpts);
	const body = {
		model: opts.model,
		max_tokens: opts.maxTokens,
		system: opts.system,
		messages: AnthropicMessages(opts.session)
	};
	if (opts.tools && opts.tools.length) {
		body.tools = ToolsForAnthropic(opts.tools);
		body.tool_choice = opts.toolChoice === 'none' ? { type: 'none' } : { type: 'auto' };
	}
	ApplyAnthropicThinking(body, opts.reasoningEffort);
	ApplyAnthropicCache(body, opts.promptCache);
	const req = {
		signal: opts.signal,
		timeout: RequestTimeoutMs(opts.maxTokens)
	};
	if (body.thinking && body.thinking.type && body.thinking.type !== 'disabled') {
		req.headers = { 'anthropic-beta': 'thinking-binding-controls-2026-08-01' };
	}
	const resp = await client.messages.create(body, req);
	return {
		...ParseAnthropicToolCalls(resp && resp.content),
		contextTokens: AnthropicContextTokens(resp && resp.usage)
	};
}

function NormalizeEffort(raw) {
	const v = String(raw == null ? 'off' : raw).trim().toLowerCase();
	if (v === 'false' || v === '0') return 'off';
	if (v === 'minimal') return 'low';
	if (v === 'max') return 'xhigh';
	return v;
}

function ApplyOpenAIThinking(body, effort, official) {
	const e = NormalizeEffort(effort);
	if (!e || e === 'off' || e === 'auto') return;
	let v = e;
	if (official && v === 'xhigh') v = 'high';
	body.reasoning_effort = v;
}

function PromptCacheKey(system) {
	return createHash('sha256').update(String(system || '')).digest('hex');
}

export function ApplyOpenAICache(body, promptCache, baseUrl, system) {
	const host = String(baseUrl || '').trim().toLowerCase();
	if (promptCache === false) {
		delete body.cache_control;
		delete body.prompt_cache_key;
		return;
	}
	const official = !host || host.includes('openai.com') || host.includes('api.openai');
	if (official || IsOpenRouterHost(host)) {
		// Same key each turn so the growing prefix stays on one cache.
		// Official OpenAI already places an implicit breakpoint on that prefix.
		body.prompt_cache_key = PromptCacheKey(system);
	}
	if (IsOpenRouterHost(host)) {
		body.cache_control = { type: 'ephemeral' };
	}
}

function ApplyAnthropicThinking(body, effort) {
	const e = NormalizeEffort(effort);
	if (!e || e === 'off') return;
	if (e === 'none') {
		body.thinking = { type: 'disabled' };
		return;
	}
	body.thinking = {
		type: 'adaptive',
		display: 'summarized',
		block_binding: { prefix_mismatch_behavior: 'drop_block' }
	};
	if (e !== 'auto') {
		body.output_config = { ...(body.output_config || {}), effort: e };
	}
}

export function ApplyAnthropicCache(body, promptCache) {
	if (promptCache === false) {
		delete body.cache_control;
		return;
	}
	// Top-level marker: the API parks the breakpoint on the last cacheable block
	// and moves it forward as the conversation grows. A marker on system alone
	// leaves every message billed as fresh input.
	body.cache_control = { type: 'ephemeral' };
}

export function IsAbortError(err) {
	if (!err) return false;
	const name = err.name || '';
	if (name === 'AbortError' || name === 'APIUserAbortError') return true;
	return /aborted|cancelled/i.test(String(err.message || ''));
}
