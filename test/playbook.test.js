import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CreateHouse } from '../src/house.js';
import { BuildSystemPrompt } from '../src/prompt.js';
import { AddPlaybookItem, ListPlaybook, PLAYBOOK_ENABLE_CAP, PLAYBOOK_HUGE_BYTES, RemovePlaybookItem, SetPlaybookEnabled } from '../src/playbook.js';
import { CallTool } from '../src/tools.js';

function TempRoot() {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-playbook-')), 'houses');
}

function House(root, slug) {
	const houseDir = path.join(root, 'houses', slug);
	fs.mkdirSync(houseDir, { recursive: true });
	fs.writeFileSync(path.join(houseDir, 'SYSTEM.md'), '# System\n\nStanding.\n', 'utf8');
	return {
		path: houseDir,
		slug,
		name: slug,
		housesRoot: path.join(root, 'houses'),
		lociHome: path.join(root, 'loci'),
		workspaces: []
	};
}

function Ctx(house) {
	return {
		houseDir: house.path,
		housesRoot: path.dirname(house.path),
		slug: house.slug,
		lociHome: house.lociHome,
		workspaces: []
	};
}

test('loci-skills is read-only and does not open the rest of ~/.loci', async () => {
	const root = TempRoot();
	const house = House(root, 'maple');
	const ctx = Ctx(house);
	const skills = path.join(house.lociHome, 'skills', 'widget');
	fs.mkdirSync(skills, { recursive: true });
	fs.writeFileSync(path.join(skills, 'SKILL.md'), '---\nname: Widget\ndescription: When widgets\n---\n\nBody\n', 'utf8');
	fs.writeFileSync(path.join(skills, 'examples.md'), 'an example\n', 'utf8');
	fs.writeFileSync(path.join(house.lociHome, 'mcp.json'), '{}\n', 'utf8');
	fs.mkdirSync(path.join(house.lociHome, 'rules'), { recursive: true });
	fs.writeFileSync(path.join(house.lociHome, 'rules', 'secret.md'), 'nope\n', 'utf8');

	const skill = await CallTool(ctx, 'read_file', { path: 'loci-skills/widget/SKILL.md' });
	assert.equal(skill.ok, true);
	assert.match(skill.text, /name: Widget/);
	assert.match(skill.text, /Body/);
	const sibling = await CallTool(ctx, 'read_file', { path: 'loci-skills/widget/examples.md' });
	assert.equal(sibling.ok, true);
	assert.match(sibling.text, /example/);

	const write = await CallTool(ctx, 'write_file', { path: 'loci-skills/widget/SKILL.md', text: 'no\n' });
	assert.equal(write.ok, false);
	assert.match(write.error, /read-only/);

	const escape = await CallTool(ctx, 'read_file', { path: 'loci-skills/../mcp.json' });
	assert.equal(escape.ok, false);
	const rules = await CallTool(ctx, 'read_file', { path: 'loci-rules/secret.md' });
	assert.equal(rules.ok, true);
	assert.match(rules.text, /nope/);
	const ruleWrite = await CallTool(ctx, 'write_file', { path: 'loci-rules/secret.md', text: 'no\n' });
	assert.equal(ruleWrite.ok, false);
	assert.match(ruleWrite.error, /read-only/);
	const ruleEscape = await CallTool(ctx, 'read_file', { path: 'loci-rules/../mcp.json' });
	assert.equal(ruleEscape.ok, false);
	const abs = await CallTool(ctx, 'read_file', { path: path.join(house.lociHome, 'skills', 'widget', 'SKILL.md') });
	assert.equal(abs.ok, false);

	const found = await CallTool(ctx, 'search_files', { path: 'loci-skills/widget', mode: 'glob', pattern: '*.md' });
	assert.equal(found.ok, true);
	assert.ok(found.matches.some((hit) => hit.path === 'loci-skills/widget/examples.md'));
});

test('house rules and skills can be created and edited, not nested rules', async () => {
	const root = TempRoot();
	const ctx = Ctx(House(root, 'maple'));
	const created = await CallTool(ctx, 'write_file', { path: 'rules/quiet.md', text: 'Be quiet.\n' });
	assert.equal(created.ok, true);
	const edited = await CallTool(ctx, 'write_file', { path: 'rules/quiet.md', text: 'Be quieter.\n' });
	assert.equal(edited.ok, true);
	const nested = await CallTool(ctx, 'write_file', { path: 'rules/nested/no.md', text: 'no\n' });
	assert.equal(nested.ok, false);
	const skill = await CallTool(ctx, 'write_file', { path: 'skills/focus/SKILL.md', text: 'Focus.\n' });
	assert.equal(skill.ok, true);
	const beside = await CallTool(ctx, 'write_file', { path: 'skills/focus/notes.md', text: 'notes\n' });
	assert.equal(beside.ok, true);
	const read = await CallTool(ctx, 'read_file', { path: 'rules/quiet.md' });
	assert.match(read.text, /quieter/);
});

test('playbook defaults: a written house file stays off; Add turns on only here', () => {
	const root = TempRoot();
	const maple = House(root, 'maple');
	const birch = House(root, 'birch');
	AddPlaybookItem(Ctx(maple), {
		kind: 'rule',
		scope: 'global',
		name: 'Shared',
		description: 'Always',
		body: 'Shared rule body.'
	});
	fs.mkdirSync(path.join(maple.path, 'rules'), { recursive: true });
	fs.writeFileSync(path.join(maple.path, 'rules', 'local.md'), '---\nname: Local\n---\n\nHouse only.\n', 'utf8');

	const here = ListPlaybook(Ctx(maple));
	const shared = here.rules.find((row) => row.path === 'loci-rules/shared.md');
	const local = here.rules.find((row) => row.path === 'rules/local.md');
	assert.equal(shared.enabled, true);
	assert.equal(local.enabled, false);

	const there = ListPlaybook(Ctx(birch));
	assert.equal(there.rules.find((row) => row.path === 'loci-rules/shared.md').enabled, false);
	assert.equal(there.rules.some((row) => row.path === 'rules/local.md'), false);

	SetPlaybookEnabled(Ctx(maple), 'loci-rules/shared.md', false);
	assert.equal(ListPlaybook(Ctx(maple)).rules.find((row) => row.path === 'loci-rules/shared.md').enabled, false);
});

test('prompt injects enabled rules and a skills catalog, not disabled bodies', () => {
	const root = TempRoot();
	const house = House(root, 'maple');
	const ctx = Ctx(house);
	AddPlaybookItem(ctx, { kind: 'rule', scope: 'house', name: 'Brief', description: 'Stay short', body: 'Use few words.' });
	AddPlaybookItem(ctx, { kind: 'rule', scope: 'house', name: 'Quiet', description: 'Keep it down', body: 'Speak softly.' });
	AddPlaybookItem(ctx, { kind: 'skill', scope: 'global', name: 'Widget', description: 'When widgets', body: 'Secret skill body.' });
	SetPlaybookEnabled(ctx, 'rules/brief.md', false);
	SetPlaybookEnabled(ctx, 'rules/quiet.md', false);
	fs.mkdirSync(path.join(house.lociHome, 'rules'), { recursive: true });
	fs.writeFileSync(path.join(house.lociHome, 'rules', 'off.md'), 'Do not inject this.\n', 'utf8');

	const prompt = BuildSystemPrompt(house);
	assert.match(prompt, /^# Skills$/m);
	assert.match(prompt, /loci-skills\/widget\.md/);
	assert.match(prompt, /When widgets/);
	assert.doesNotMatch(prompt, /Secret skill body/);
	assert.doesNotMatch(prompt, /Speak softly/);
	assert.doesNotMatch(prompt, /Use few words/);
	assert.doesNotMatch(prompt, /Do not inject this/);

	SetPlaybookEnabled(ctx, 'rules/brief.md', true);
	SetPlaybookEnabled(ctx, 'rules/quiet.md', true);
	const on = BuildSystemPrompt(house);
	const briefCat = on.indexOf('- **Brief** (`rules/brief.md`): Stay short');
	const quietCat = on.indexOf('- **Quiet** (`rules/quiet.md`): Keep it down');
	const firstBreak = on.indexOf('\n---\n');
	const briefBody = on.indexOf('Use few words.');
	const secondBreak = on.indexOf('\n---\n', firstBreak + 1);
	const quietBody = on.indexOf('Speak softly.');
	assert.ok(briefCat !== -1 && briefCat < quietCat);
	assert.ok(quietCat < firstBreak && firstBreak < briefBody);
	assert.ok(briefBody < secondBreak && secondBreak < quietBody);
	assert.match(on, /^# Rules$/m);
	assert.doesNotMatch(on, /name: Quiet/);
});

test('a rule with no frontmatter is labeled from its filename', () => {
	const root = TempRoot();
	const house = House(root, 'maple');
	const ctx = Ctx(house);
	fs.mkdirSync(path.join(house.path, 'rules'), { recursive: true });
	fs.writeFileSync(path.join(house.path, 'rules', 'my-rule.md'), 'Speak plainly.\n', 'utf8');
	SetPlaybookEnabled(ctx, 'rules/my-rule.md', true);
	const listed = ListPlaybook(ctx).rules.find((row) => row.path === 'rules/my-rule.md');
	assert.equal(listed.name, 'my rule');
	const prompt = BuildSystemPrompt(house);
	assert.match(prompt, /- \*\*my rule\*\* \(`rules\/my-rule\.md`\)\n/);
	assert.match(prompt, /Speak plainly\./);
});

test('enabled rules inject the body only, including a large file', () => {
	const root = TempRoot();
	const house = House(root, 'maple');
	const ctx = Ctx(house);
	fs.mkdirSync(path.join(house.path, 'rules'), { recursive: true });
	const big = 'B'.repeat(PLAYBOOK_HUGE_BYTES + 50);
	fs.writeFileSync(path.join(house.path, 'rules', 'big.md'), '---\nname: Big\ndescription: Huge\n---\n\n' + big + '\n', 'utf8');
	const warned = SetPlaybookEnabled(ctx, 'rules/big.md', true);
	assert.match(warned.warning, /KB/);
	const prompt = BuildSystemPrompt(house);
	assert.match(prompt, /B{20}/);
	assert.doesNotMatch(prompt, /name: Big/);
	assert.doesNotMatch(prompt, /truncated/);
});

test('enabling stops at the playbook cap', () => {
	const root = TempRoot();
	const house = House(root, 'maple');
	const ctx = Ctx(house);
	fs.mkdirSync(path.join(house.path, 'rules'), { recursive: true });
	for (let i = 0; i < PLAYBOOK_ENABLE_CAP; i++) {
		fs.writeFileSync(path.join(house.path, 'rules', 'r' + i + '.md'), 'rule ' + i + '\n', 'utf8');
		SetPlaybookEnabled(ctx, 'rules/r' + i + '.md', true);
	}
	fs.writeFileSync(path.join(house.path, 'rules', 'extra.md'), 'extra\n', 'utf8');
	assert.throws(() => SetPlaybookEnabled(ctx, 'rules/extra.md', true), /At most/);
});

test('remove deletes the file and refuses the skills root', () => {
	const root = TempRoot();
	const house = House(root, 'maple');
	const ctx = Ctx(house);
	AddPlaybookItem(ctx, { kind: 'skill', scope: 'house', name: 'Focus', body: 'Focus.' });
	const abs = path.join(house.path, 'skills', 'focus.md');
	assert.equal(fs.existsSync(abs), true);
	RemovePlaybookItem(ctx, 'skills/focus.md');
	assert.equal(fs.existsSync(abs), false);
	assert.equal(fs.existsSync(path.join(house.path, 'skills')), true);
});

test('a new user library is seeded once and those files start off', () => {
	const root = TempRoot();
	const house = House(root, 'maple');
	const listed = ListPlaybook(Ctx(house));
	const rule = listed.rules.find((row) => row.path === 'loci-rules/coding-guidelines.md');
	const skill = listed.skills.find((row) => row.path === 'loci-skills/create-skill.md');
	assert.equal(rule.enabled, false);
	assert.equal(skill.enabled, false);
	assert.equal(fs.existsSync(path.join(house.lociHome, 'rules', 'coding-guidelines.md')), true);
	const prompt = BuildSystemPrompt(house);
	assert.doesNotMatch(prompt, /Coding Guidelines/);
	fs.unlinkSync(path.join(house.lociHome, 'rules', 'coding-guidelines.md'));
	const again = ListPlaybook(Ctx(house));
	assert.equal(again.rules.some((row) => row.path === 'loci-rules/coding-guidelines.md'), false);
});

test('new houses skip GUESTS.md and seed rules and skills', () => {
	const root = TempRoot();
	const houses = path.join(root, 'houses');
	const created = CreateHouse(houses, { name: 'Maple' });
	assert.equal(fs.existsSync(path.join(created.path, 'GUESTS.md')), false);
	assert.equal(fs.existsSync(path.join(created.path, 'rules')), true);
	assert.equal(fs.existsSync(path.join(created.path, 'skills')), true);
	const system = fs.readFileSync(path.join(created.path, 'SYSTEM.md'), 'utf8');
	assert.doesNotMatch(system, /standing house rules/);
	assert.match(system, /loci-skills/);
});
