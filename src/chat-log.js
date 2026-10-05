export const CHAT_LOG_FIRST = 32;
export const CHAT_LOG_MORE = 8;

/**
 * The next older slice to prepend. `shown` counts messages already in the log,
 * taken from the end of the full list.
 * @param {number} total
 * @param {number} shown
 * @param {number} count
 */
export function OlderChatRange(total, shown, count) {
	const hidden = Math.max(0, total - shown);
	const n = Math.min(Math.max(0, count), hidden);
	return { start: hidden - n, count: n };
}
