/**
 * Shared by main (house.js) and the renderer. `{{name}}` is filled when a house is created.
 * `{{team}}` is only filled if a file still contains it; current templates do not.
 * The live group and project-manager text is added when the prompt is built.
 * @param {string} text
 * @param {{ name?: string, group?: string, teamAlone?: string, teamGroup?: string }} vars
 */
export function ApplyTemplate(text, vars) {
	const name = String(vars && vars.name || '').trim() || 'Agent';
	const group = String(vars && vars.group || '').trim();
	const teamAlone = String(vars && vars.teamAlone || '').trim();
	const teamGroup = String(vars && vars.teamGroup || '').trim();
	const team = group ? teamGroup.replaceAll('{{group}}', group) : teamAlone;
	return String(text || '').replaceAll('{{name}}', name).replaceAll('{{team}}', team);
}
