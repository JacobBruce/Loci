import assert from 'node:assert/strict';
import test from 'node:test';
import { ThemeName } from '../src/themes.js';

test('an unknown theme falls back to brass', () => {
	assert.equal(ThemeName('blue'), 'blue');
	assert.equal(ThemeName('brass'), 'brass');
	assert.equal(ThemeName('nope'), 'brass');
	assert.equal(ThemeName(undefined), 'brass');
});
