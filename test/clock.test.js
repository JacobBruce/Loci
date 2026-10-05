import assert from 'node:assert/strict';
import test from 'node:test';
import { AdvanceDeg, ClockDigital, ClockHands, ClockZone, FormatElapsed } from '../src/clock.js';

test('ClockHands match a known civil time', () => {
	const at = new Date(2026, 8, 19, 15, 30, 45, 0);
	const hands = ClockHands(at);
	assert.equal(hands.second, 270);
	assert.equal(hands.minute, 184.5);
	assert.equal(hands.hour, 105.375);
	assert.equal(ClockDigital(at), '15:30:45');
});

test('Clock helpers fall back to now for an Invalid Date', () => {
	const bad = new Date(NaN);
	const hands = ClockHands(bad);
	assert.ok(Number.isFinite(hands.hour) && Number.isFinite(hands.minute) && Number.isFinite(hands.second));
	assert.match(ClockDigital(bad), /^\d{2}:\d{2}:\d{2}$/);
	assert.match(ClockZone(bad).utc_offset, /^[+-]\d{2}:\d{2}$/);
});

test('AdvanceDeg ticks forward across 12 o’clock', () => {
	assert.equal(AdvanceDeg(354, 0), 360);
	assert.equal(AdvanceDeg(360, 6), 366);
	assert.equal(AdvanceDeg(0, 6), 6);
});

test('ClockZone reports an IANA name and UTC offset', () => {
	const zone = ClockZone(new Date());
	assert.ok(zone.timezone);
	assert.match(zone.utc_offset, /^[+-]\d{2}:\d{2}$/);
});

test('FormatElapsed stays compact and never says due', () => {
	assert.equal(FormatElapsed(0), '0s');
	assert.equal(FormatElapsed(47), '47s');
	assert.equal(FormatElapsed(90), '1m 30s');
	assert.equal(FormatElapsed(3600), '1h');
	assert.equal(FormatElapsed(5400), '1h 30m');
});
