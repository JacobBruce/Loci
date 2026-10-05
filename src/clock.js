/**
 * Analog-clock geometry and local zone copy. Safe for the renderer
 * (Date + Intl only).
 */

/** Use `now` when it is a valid Date, otherwise the current time (an Invalid Date would give NaN everywhere). */
function ToDate(now) {
	return now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
}

export function ClockHands(now) {
	const d = ToDate(now);
	const s = d.getSeconds();
	const m = d.getMinutes() + s / 60;
	const h = (d.getHours() % 12) + m / 60;
	return {
		hour: 30 * h,
		minute: 6 * m,
		second: 6 * s
	};
}

/** Keep rotation increasing so a 59s → 0s tick goes forward, not back. */
export function AdvanceDeg(prev, target) {
	const t = ((Number(target) % 360) + 360) % 360;
	if (!Number.isFinite(prev)) return t;
	const next = Math.floor(prev / 360) * 360 + t;
	return next < prev ? next + 360 : next;
}

export function ClockParts(now) {
	const d = ToDate(now);
	return {
		hh: String(d.getHours()).padStart(2, '0'),
		mm: String(d.getMinutes()).padStart(2, '0'),
		ss: String(d.getSeconds()).padStart(2, '0')
	};
}

export function ClockDigital(now) {
	const p = ClockParts(now);
	return p.hh + ':' + p.mm + ':' + p.ss;
}

export function ClockZone(now) {
	const d = ToDate(now);
	let timezone = '';
	try {
		timezone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim();
	} catch {
		timezone = '';
	}
	const minutes = -d.getTimezoneOffset();
	const sign = minutes >= 0 ? '+' : '-';
	const abs = Math.abs(minutes);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	return {
		timezone: timezone || 'local',
		utc_offset: sign + hh + ':' + mm
	};
}

export function FormatElapsed(seconds) {
	const n = Math.max(0, Math.floor(Number(seconds) || 0));
	if (n < 60) return n + 's';
	if (n < 3600) {
		const m = Math.floor(n / 60);
		const s = n % 60;
		return s ? m + 'm ' + s + 's' : m + 'm';
	}
	const h = Math.floor(n / 3600);
	const m = Math.floor((n % 3600) / 60);
	return m ? h + 'h ' + m + 'm' : h + 'h';
}
