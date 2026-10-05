import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js';

const md = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: false,
	highlight(str, lang) {
		if (lang && hljs.getLanguage(lang)) {
			try {
				return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
			} catch {
				// fall through to default escaping
			}
		}
		return '';
	}
});
md.use(taskLists, { enabled: false });

const Fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
	tokens[idx].attrJoin('class', 'hljs');
	return Fence(tokens, idx, options, env, slf);
};

function SplitFrontmatter(src) {
	const text = String(src || '').replace(/\r\n/g, '\n');
	if (!text.startsWith('---\n')) return { meta: {}, body: text };
	const rest = text.slice(4);
	const end = rest.indexOf('\n---');
	if (end < 0) return { meta: {}, body: text };
	const raw = rest.slice(0, end);
	let body = rest.slice(end + 4);
	if (body.startsWith('\n')) body = body.slice(1);
	const meta = {};
	for (const line of raw.split('\n')) {
		const i = line.indexOf(':');
		if (i < 0) continue;
		const key = line.slice(0, i).trim().toLowerCase();
		const value = line.slice(i + 1).trim();
		if (key) meta[key] = value;
	}
	return { meta, body };
}

export function TitleFromRel(rel) {
	const name = String(rel || '').replace(/\\/g, '/').split('/').pop() || '';
	const stem = name.replace(/\.md$/i, '');
	return stem.replace(/-/g, ' ') || name;
}

export function RenderMarkdown(src) {
	return md.render(String(src || ''));
}

export function MarkdownPage(src, fallbackTitle) {
	const { meta, body } = SplitFrontmatter(src);
	const title = String(meta.title || fallbackTitle || '').trim();
	return {
		title,
		html: RenderMarkdown(body)
	};
}
