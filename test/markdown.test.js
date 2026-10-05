import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownPage, RenderMarkdown, TitleFromRel } from '../src/markdown.js';

test('RenderMarkdown leaves raw HTML as text', () => {
	const html = RenderMarkdown('Hello <script>alert(1)</script> world');
	assert.match(html, /&lt;script&gt;/);
	assert.equal(/<script>/i.test(html), false);
});

test('RenderMarkdown does not turn javascript URLs into links', () => {
	const html = RenderMarkdown('[go](javascript:alert(1))');
	assert.equal(/href\s*=/i.test(html), false);
});

test('RenderMarkdown renders disabled task list boxes', () => {
	const html = RenderMarkdown('- [x] done\n- [ ] todo\n');
	assert.match(html, /task-list-item-checkbox/);
	assert.match(html, /disabled/);
	assert.match(html, /checked/);
});

test('RenderMarkdown highlights a fenced language', () => {
	const html = RenderMarkdown('```javascript\nconst n = 1;\n```\n');
	assert.match(html, /class="hljs/);
	assert.match(html, /hljs-/);
	assert.match(html, /const/);
});

test('MarkdownPage strips frontmatter and uses the title', () => {
	const page = MarkdownPage('---\ntitle: Shelf rebuild\nat: 2026-09-19\n---\n\n# Steps\n\nCut oak.\n', 'fallback');
	assert.equal(page.title, 'Shelf rebuild');
	assert.match(page.html, /<h1>Steps<\/h1>/);
	assert.equal(/title: Shelf rebuild/.test(page.html), false);
});

test('RenderMarkdown turns pipe rows into a table', () => {
	const html = RenderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
	assert.match(html, /<table>/);
	assert.match(html, /<th>A<\/th>/);
});

test('TitleFromRel humanizes the file stem', () => {
	assert.equal(TitleFromRel('plans/shelf-rebuild.md'), 'shelf rebuild');
	assert.equal(TitleFromRel('NOTES.md'), 'NOTES');
});
