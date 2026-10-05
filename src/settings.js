import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { DefaultHousesRoot } from './house.js';
import { ThemeName } from './themes.js';

const PROVIDERS = new Set(['openai', 'anthropic']);

export const DEFAULT_ANTHROPIC_MODELS = [
	'claude-opus-5-5',
	'claude-sonnet-5-5',
	'claude-fable-5-1',
	'claude-fable-5',
	'claude-opus-5',
	'claude-sonnet-5',
	'claude-haiku-4-5',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'claude-opus-4-6',
	'claude-sonnet-4-6',
	'claude-sonnet-4-5',
	'claude-opus-4-5'
];

export const DEFAULT_OPENAI_MODELS = [
	'gpt-5.5',
	'gpt-5.4',
	'gpt-5.4-mini',
	'gpt-5.4-nano',
	'gpt-5.2',
	'gpt-5.1',
	'gpt-5',
	'gpt-5-mini',
	'gpt-5-nano',
	'gpt-4.1',
	'gpt-4.1-mini',
	'gpt-4o',
	'gpt-4o-mini',
	'o3',
	'o4-mini'
];

export const DEFAULT_OPENROUTER_MODELS = [
	'openrouter/auto',
	'openrouter/free',
	'openai/gpt-chat-latest',
	'~openai/gpt-astra-latest',
	'~openai/gpt-sol-latest',
	'~openai/gpt-terra-latest',
	'~openai/gpt-luna-latest',
	'~anthropic/claude-fable-latest',
	'~anthropic/claude-opus-latest',
	'~anthropic/claude-sonnet-latest',
	'~anthropic/claude-haiku-latest',
	'~x-ai/grok-latest',
	'~z-ai/glm-latest',
	'~z-ai/glm-flash-latest',
	'~deepseek/deepseek-v4-flash-latest'
];

/**
 * @typedef {object} LociSettings
 * @property {'openai'|'anthropic'} provider
 * @property {string} model
 * @property {string} openai_api_key
 * @property {string} anthropic_api_key
 * @property {string} openrouter_api_key
 * @property {string} firecrawl_api_key
 * @property {string} openai_base_url
 * @property {string} anthropic_base_url
 * @property {string} houses_root
 * @property {string} last_house
 * @property {Record<string, string>} house_views
 * @property {string} house_sort
 * @property {string} house_show
 * @property {'brass'|'blue'} theme
 * @property {boolean} dev_mode
 * @property {string[]} openai_models
 * @property {string[]} anthropic_models
 * @property {string[]} openrouter_models
 * @property {boolean} models_seeded
 */

/** @returns {LociSettings} */
export function DefaultSettings() {
	return {
		provider: 'openai',
		model: '',
		openai_api_key: '',
		anthropic_api_key: '',
		openrouter_api_key: '',
		firecrawl_api_key: '',
		openai_base_url: '',
		anthropic_base_url: '',
		houses_root: '',
		last_house: '',
		house_views: {},
		house_sort: 'recent',
		house_show: '',
		theme: 'brass',
		dev_mode: false,
		openai_models: DEFAULT_OPENAI_MODELS.slice(),
		anthropic_models: DEFAULT_ANTHROPIC_MODELS.slice(),
		openrouter_models: DEFAULT_OPENROUTER_MODELS.slice(),
		models_seeded: false
	};
}

export function ConfigPath() {
	return path.join(app.getPath('userData'), 'config.json');
}

/**
 * Empty base URL is official (SDK default). AI UI treats empty as the HF router;
 * Loci does not.
 * @param {string} [baseUrl]
 */
export function IsOfficialOpenAI(baseUrl) {
	const host = String(baseUrl || '').trim().toLowerCase();
	if (!host) return true;
	return host.includes('openai.com') || host.includes('api.openai');
}

/**
 * @param {string} [baseUrl]
 */
export function IsOfficialAnthropic(baseUrl) {
	const host = String(baseUrl || '').trim().toLowerCase();
	return !host || host.includes('api.anthropic.com');
}

function NormalizeHouseViews(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [slug, at] of Object.entries(raw)) {
		const key = String(slug || '').trim();
		const when = String(at || '').trim();
		if (!key || !when) continue;
		out[key] = when;
	}
	return out;
}

function Normalize(raw) {
	const d = DefaultSettings();
	const src = (raw && typeof raw === 'object') ? raw : {};
	const provider = String(src.provider || d.provider).trim().toLowerCase();
	d.provider = PROVIDERS.has(provider) ? provider : 'openai';
	d.model = String(src.model || '').trim();
	d.openai_api_key = String(src.openai_api_key || '').trim();
	d.anthropic_api_key = String(src.anthropic_api_key || '').trim();
	d.openrouter_api_key = String(src.openrouter_api_key || '').trim();
	d.firecrawl_api_key = String(src.firecrawl_api_key || '').trim();
	const openaiBase = Object.prototype.hasOwnProperty.call(src, 'openai_base_url')
		? src.openai_base_url
		: src.base_url;
	d.openai_base_url = String(openaiBase || '').trim();
	d.anthropic_base_url = String(src.anthropic_base_url || '').trim();
	d.houses_root = String(src.houses_root || '').trim() || DefaultHousesRoot();
	d.last_house = String(src.last_house || '').trim();
	d.house_views = NormalizeHouseViews(src.house_views);
	d.house_sort = src.house_sort === 'name' ? 'name' : 'recent';
	d.house_show = src.house_show === 'enabled' || src.house_show === 'disabled' ? src.house_show : '';
	d.theme = ThemeName(src.theme);
	if (Object.prototype.hasOwnProperty.call(src, 'dev_mode')) {
		d.dev_mode = !!src.dev_mode;
	} else {
		d.dev_mode = !app.isPackaged;
	}
	d.openai_models = UniqueNames(src.openai_models);
	d.anthropic_models = UniqueNames(src.anthropic_models);
	d.openrouter_models = UniqueNames(src.openrouter_models);
	d.models_seeded = src.models_seeded === true;
	if (!d.models_seeded) {
		if (!d.openai_models.length) d.openai_models = DEFAULT_OPENAI_MODELS.slice();
		if (!d.anthropic_models.length) d.anthropic_models = DEFAULT_ANTHROPIC_MODELS.slice();
	}
	if (!Object.prototype.hasOwnProperty.call(src, 'openrouter_models')) {
		d.openrouter_models = DEFAULT_OPENROUTER_MODELS.slice();
	}
	return d;
}

function UniqueNames(raw) {
	const out = [];
	const seen = new Set();
	for (const item of Array.isArray(raw) ? raw : []) {
		const s = String(item || '').trim();
		if (!s || seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

export function LoadSettings() {
	const cfgPath = ConfigPath();
	if (!fs.existsSync(cfgPath)) {
		return Normalize({});
	}
	try {
		return Normalize(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
	} catch (err) {
		return Normalize({});
	}
}

/**
 * @param {object} payload
 * @returns {LociSettings}
 */
export function SaveSettings(payload) {
	const prev = LoadSettings();
	const next = Normalize({ ...prev, ...payload });
	const dir = path.dirname(ConfigPath());
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(ConfigPath(), JSON.stringify(next, null, '\t') + '\n', { encoding: 'utf8', mode: 0o600 });
	return next;
}
