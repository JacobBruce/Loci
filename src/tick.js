import { ListHouses } from './house.js';
import { MatchAlarms, MinuteKey } from './alarms.js';
import { DropEvents, MatchEvents } from './events.js';
import { ConsumeAlarmMinute, HouseAlarmsPaused } from './world.js';

/**
 * Scan enabled houses once. Matching lines in the same minute are a single wake.
 * Skip houses that are in a turn or paused without consuming the minute, so a
 * later tick (including when a turn ends) can still fire due events.
 * @param {string} root
 * @param {Date|number} now
 * @param {{ isWorking?: (slug: string) => boolean, enqueue?: (house: object, matches: object[]) => boolean }} [ctl]
 */
export function RunAlarmTick(root, now, ctl) {
	const at = now instanceof Date ? now : new Date();
	const key = MinuteKey(at);
	const busy = ctl && typeof ctl.isWorking === 'function' ? ctl.isWorking : () => false;
	const enqueue = ctl && typeof ctl.enqueue === 'function' ? ctl.enqueue : () => false;
	const fired = [];
	for (const house of ListHouses(root)) {
		if (house.enabled === false) continue;
		const alarmMatches = MatchAlarms(house.path, at);
		const eventMatches = MatchEvents(house.path, at);
		if (!alarmMatches.length && !eventMatches.length) continue;
		if (busy(house.slug)) continue;
		if (HouseAlarmsPaused(house.path, house)) continue;
		if (!ConsumeAlarmMinute(house.path, key)) continue;
		const matches = alarmMatches.concat(eventMatches);
		if (!enqueue(house, matches)) continue;
		if (eventMatches.length) DropEvents(house.path, eventMatches);
		fired.push({ slug: house.slug, matches });
	}
	return fired;
}
