import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceRoots } from './tools.js';
import { GroupMembers } from './agpi.js';
import { LocalTimeZone } from './world.js';
import { LoadHouseConfig } from './house-config.js';
import { PacksFromConfig, PackToolEnabled } from './tool-packs.js';
import { PromptPlaybook } from './playbook.js';

export function ToolContextFromHouse(house, extra) {
	const housesRoot = house.path ? path.dirname(house.path) : '';
	const runtime = (housesRoot && house.slug) ? LoadHouseConfig(housesRoot, house.slug) : null;
	const packs = PacksFromConfig(runtime, house);
	return {
		houseDir: house.path,
		housesRoot,
		workspaces: house.workspaces || [],
		tool_packs: packs,
		run_command: PackToolEnabled(packs, 'loci', 'run_command'),
		command_timeout: runtime ? runtime.command_timeout : 0,
		command_timeout_max: runtime ? runtime.command_timeout_max : 0,
		name: house.name || '',
		slug: house.slug || '',
		group: house.group || '',
		description: house.description || '',
		agent_alarms: house.agent_alarms !== false,
		agent_events: house.agent_events !== false,
		agent_web: house.agent_web !== false,
		project_manager: house.project_manager === true,
		max_turns: house.max_turns || 0,
		turn_started_at: extra && extra.turn_started_at ? extra.turn_started_at : 0,
		firecrawl_api_key: extra && extra.firecrawl_api_key ? String(extra.firecrawl_api_key) : '',
		signal: extra && extra.signal ? extra.signal : null,
		wake_house: extra && typeof extra.wake_house === 'function' ? extra.wake_house : null,
		house_busy: extra && typeof extra.house_busy === 'function' ? extra.house_busy : null,
		gaming: !!(extra && extra.gaming),
		forward_game: extra && typeof extra.forward_game === 'function' ? extra.forward_game : null,
		lociHome: house.lociHome || ''
	};
}

/**
 * SYSTEM.md plus name, optional description/group, absolute house/workspace paths, and host timezone.
 * Tool schemas are sent via the API `tools=` field, not repeated here.
 * @param {object} house
 */
export function BuildSystemPrompt(house) {
	const ctx = ToolContextFromHouse(house);
	const systemPath = path.join(house.path, 'SYSTEM.md');
	let body = '';
	if (fs.existsSync(systemPath)) {
		body = fs.readFileSync(systemPath, 'utf8').trimEnd();
	}
	const lines = ['', '# Runtime', ''];
	const name = String(house.name || house.slug || '').trim() || 'assistant';
	const slug = String(house.slug || '').trim();
	lines.push('Agent name: ' + name);
	const desc = String(house.description || '').trim();
	if (desc) lines.push('Description: ' + desc);
	const zone = LocalTimeZone();
	lines.push('Timezone: ' + zone.timezone + ' (UTC' + zone.utc_offset + ')');
	lines.push('House: `' + path.resolve(house.path) + '`');
	const workspaces = WorkspaceRoots(ctx);
	if (workspaces.length) {
		lines.push('Workspaces:');
		for (const ws of workspaces) lines.push('- `' + ws + '`');
	} else {
		lines.push('Workspaces: none');
	}
	const group = String(house.group || '').trim();
	if (group) {
		lines.push('Group: ' + group);
		const members = GroupMembers({
			housesRoot: house.path ? path.dirname(house.path) : '',
			group,
			slug: house.slug
		});
		lines.push('Members:');
		for (const member of members) lines.push(MemberLine(member));
		lines.push('- You' + (slug ? ' (`' + slug + '`)' : ''));
	}
	lines.push('');
	const playbook = PromptPlaybook(ctx);
	const parts = [];
	if (body) parts.push(body);
	const team = TeamSection(house, group);
	if (team) parts.push(team);
	if (playbook) parts.push(playbook.trim());
	parts.push(lines.join('\n').trim());
	return parts.join('\n\n') + '\n';
}

function TemplateText(name) {
	try {
		return fs.readFileSync(path.join(import.meta.dirname, 'templates', name), 'utf8').trim();
	} catch {
		return '';
	}
}

/**
 * One standing file, chosen from the house as it is now.
 * A project manager gets team-manager.md instead of team-group.md.
 */
function TeamSection(house, group) {
	const file = !group
		? 'team-solitary.md'
		: (house.project_manager === true ? 'team-manager.md' : 'team-group.md');
	return TemplateText(file).replaceAll('{{group}}', group);
}

function MemberLine(member) {
	const tags = [];
	if (member.project_manager) tags.push('project manager');
	if (member.enabled === false) tags.push('disabled');
	let line = '- ' + (member.name || member.slug) + ' (`' + member.slug + '`)';
	if (tags.length) line += ', ' + tags.join(', ');
	return line;
}
