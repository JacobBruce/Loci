import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CreateHouse, ReadHouse } from '../src/house.js';
import { CallAgpi } from '../src/agpi.js';
import { BuildSystemPrompt, ToolContextFromHouse } from '../src/prompt.js';
import {
	AddNotice,
	BoardForHouse,
	BoardNudge,
	CastVote,
	ClosePoll,
	OpenPoll,
	SetNoticesPathForTest,
	TakeClosedPolls
} from '../src/notices.js';

function World() {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loci-poll-')), 'houses');
	SetNoticesPathForTest(path.join(root, 'notices.db'));
	const maple = CreateHouse(root, { name: 'Maple', group: 'grove', project_manager: true });
	const cedar = CreateHouse(root, { name: 'Cedar', group: 'grove' });
	const birch = CreateHouse(root, { name: 'Birch', group: 'grove' });
	return { root, maple, cedar, birch };
}

test('a house votes once and the choices stay hidden until the poll closes', () => {
	const { root, maple, cedar } = World();
	const opened = OpenPoll(root, maple, { question: 'Which path?', choices: ['East', 'West'], in: '2h' }, maple.slug);
	assert.equal(opened.status, 'open');
	assert.equal(opened.opened_by, 'Maple');
	assert.equal(opened.tally, undefined);
	assert.match(BoardNudge(root, cedar), /Which path/);
	const voted = CastVote(root, cedar, { choice: 'east' });
	assert.equal(voted.your_choice, 'East');
	assert.deepEqual(voted.voters, ['Cedar']);
	assert.equal(voted.tally, undefined);
	assert.throws(() => CastVote(root, cedar, { choice: 'West' }), /already voted/);
	assert.throws(() => CastVote(root, maple, { choice: 'North' }), /one of: East, West/);
	assert.doesNotMatch(BoardNudge(root, cedar), /Which path/);
	assert.throws(() => OpenPoll(root, maple, { question: 'Again?', choices: ['Yes', 'No'], in: '1h' }, maple.slug), /already has an open poll/);
	assert.throws(() => OpenPoll(root, maple, { question: 'Same?', choices: ['Yes', 'yes'], in: '1h' }, maple.slug), /two different choices/);
	const closed = ClosePoll(root, maple, { byManager: true });
	assert.equal(closed.tally.East, 1);
	assert.equal(closed.tally.West, 0);
	assert.deepEqual(closed.absent.sort(), ['Birch', 'Maple']);
	assert.throws(() => CastVote(root, cedar, { choice: 'East' }), /no open poll/);
});

test('a vote may be the choice number or text; the user board sees a live count', () => {
	const { root, maple, cedar, birch } = World();
	OpenPoll(root, maple, { question: 'Pick?', choices: ['East', 'West', '1'], in: '1h' }, maple.slug);
	assert.match(BoardNudge(root, cedar), /1\. East, 2\. West, 3\. 1/);
	assert.equal(CastVote(root, cedar, { choice: 2 }).your_choice, 'West');
	assert.throws(() => CastVote(root, birch, { choice: 'a' }), /number from 1 to 3/);
	assert.equal(CastVote(root, birch, { choice: 'East' }).your_choice, 'East');
	assert.equal(CastVote(root, maple, { choice: '1' }).your_choice, '1');
	assert.equal(BoardForHouse(root, maple).open.tally, undefined);
	const live = BoardForHouse(root, maple, { live: true }).open;
	assert.deepEqual(live.tally, { East: 1, West: 1, 1: 1 });
	assert.deepEqual(live.voters_by_choice, { East: ['Birch'], West: ['Cedar'], 1: ['Maple'] });
	assert.equal(BoardForHouse(root, maple).open.voters_by_choice, undefined);
	assert.equal(live.numbered, '1. East, 2. West, 3. 1');
	const fresh = World();
	OpenPoll(fresh.root, fresh.maple, { question: 'Q?', choices: ['Yes', 'No'], in: '1h' }, 'user');
	assert.throws(() => CastVote(fresh.root, fresh.cedar, { choice: 3 }), /number from 1 to 2/);
	assert.throws(() => CastVote(fresh.root, fresh.cedar, { choice: 'b' }), /number from 1 to 2/);
	assert.equal(CastVote(fresh.root, fresh.cedar, { choice: '2.' }).your_choice, 'No');
});

test('a vote after the deadline is refused even before the tick closes the poll', () => {
	const { root, maple, cedar } = World();
	OpenPoll(root, maple, { question: 'Now?', choices: ['Yes', 'No'], in: '1m' }, maple.slug);
	const realNow = Date.now;
	Date.now = () => realNow() + 2 * 60 * 1000;
	try {
		assert.throws(() => CastVote(root, cedar, { choice: 'Yes' }), /has closed/);
		assert.doesNotMatch(BoardNudge(root, cedar), /open poll/);
	} finally {
		Date.now = realNow;
	}
});

test('the deadline posts the result and wakes only the managers, not during a game', () => {
	const { root, maple, cedar } = World();
	OpenPoll(root, maple, { question: 'Now?', choices: ['Yes', 'No'], in: '1m' }, maple.slug);
	const later = new Date(Date.now() + 2 * 60 * 1000);
	assert.deepEqual(TakeClosedPolls(root, later, { gaming: true }), []);
	assert.equal(BoardForHouse(root, maple).open, null);
	const wakes = TakeClosedPolls(root, later, { gaming: false });
	assert.equal(wakes.length, 1);
	assert.equal(wakes[0].slug, maple.slug);
	assert.match(wakes[0].text, /Poll closed: "Now\?"/);
	assert.deepEqual(TakeClosedPolls(root, later), []);
	assert.match(BoardNudge(root, cedar), /1 unread group notice/);
	assert.doesNotMatch(BoardNudge(root, maple), /unread/);
});

test('a notice is unread for each other house until that house examines the board', () => {
	const { root, maple, cedar, birch } = World();
	const notice = AddNotice(root, maple, { text: 'We ship on Friday.' }, maple.slug);
	assert.equal(notice.author, 'Maple');
	assert.equal(BoardNudge(root, maple), '');
	assert.match(BoardNudge(root, cedar), /1 unread group notice/);
	const seen = BoardForHouse(root, cedar, { reader: true, markRead: true });
	assert.equal(seen.notices[0].text, 'We ship on Friday.');
	assert.equal(seen.notices[0].unread, true);
	assert.equal(BoardNudge(root, cedar), '');
	assert.equal(BoardForHouse(root, cedar, { reader: true }).notices[0].unread, false);
	assert.match(BoardNudge(root, birch), /1 unread/);
	AddNotice(root, maple, { text: 'From the user.' }, 'user');
	assert.match(BoardNudge(root, maple), /1 unread/);
	assert.match(BoardNudge(root, birch), /2 unread group notices/);
	assert.throws(() => AddNotice(root, maple, { text: '' }, 'user'), /text is required/);
	const solo = CreateHouse(root, { name: 'Solo' });
	assert.throws(() => AddNotice(root, solo, { text: 'Hi' }, 'user'), /not in a group/);
	assert.equal(BoardNudge(root, solo), '');
});

test('only a project manager agent can open polls and post notices', async () => {
	const { root, maple, cedar } = World();
	const pm = ToolContextFromHouse(ReadHouse(root, maple.slug));
	const member = ToolContextFromHouse(ReadHouse(root, cedar.slug));
	const refused = await CallAgpi(member, 'send_action', {
		action: 'open_poll',
		target: 'notice_board',
		payload: '{"question":"Q?","choices":["A","B"],"in":"1h"}'
	});
	assert.equal(refused.ok, false);
	assert.match(refused.error, /project manager/);
	const listed = await CallAgpi(member, 'list_actions', { target: 'notice_board' });
	assert.deepEqual(listed.actions.map((a) => a.action), ['examine', 'vote']);
	const opened = await CallAgpi(pm, 'send_action', {
		action: 'open_poll',
		payload: '{"question":"Q?","choices":["A","B"],"in":"1h"}'
	});
	assert.equal(opened.ok, true);
	const voted = await CallAgpi(member, 'send_action', {
		action: 'vote',
		target: 'notice_board',
		payload: '{"choice":"B"}'
	});
	assert.equal(voted.ok, true);
	const posted = await CallAgpi(pm, 'send_action', {
		action: 'add_notice',
		target: 'notice_board',
		payload: '{"text":"Read the plan."}'
	});
	assert.equal(posted.ok, true);
	const seen = await CallAgpi(member, 'send_action', { action: 'examine', target: 'notice_board' });
	assert.equal(seen.board.notices[0].text, 'Read the plan.');
	assert.equal(seen.board.open.voted, true);
	assert.equal(BoardNudge(root, cedar), '');
});

test('only a project manager in a group gets the manager section', () => {
	const { root, maple, cedar } = World();
	const pm = BuildSystemPrompt(ReadHouse(root, maple.slug));
	assert.match(pm, /^# Project manager$/m);
	assert.doesNotMatch(pm, /^# Group$/m);
	assert.ok(pm.indexOf('# Project manager') < pm.indexOf('# Runtime'));
	assert.match(pm, /project manager for \*\*grove\*\*/);
	assert.match(pm, /open_poll/);
	assert.match(pm, /send_mail/);
	assert.match(pm, /^Agent name: Maple$/m);
	assert.match(pm, /^- Birch \(`birch`\)$/m);
	assert.match(pm, /^- Cedar \(`cedar`\)$/m);
	assert.doesNotMatch(pm, /^- Maple /m);
	assert.match(pm, /^- You \(`maple`\)$/m);
	const member = BuildSystemPrompt(ReadHouse(root, cedar.slug));
	assert.match(member, /^# Group$/m);
	assert.match(member, /belong to a community of agent houses called \*\*grove\*\*/);
	assert.doesNotMatch(member, /# Project manager/);
	assert.doesNotMatch(member, /open_poll/);
	assert.match(member, /^- Maple \(`maple`\), project manager$/m);
	assert.doesNotMatch(member, /^- Cedar /m);
	const solo = CreateHouse(root, { name: 'Solo', project_manager: true });
	const alone = BuildSystemPrompt(ReadHouse(root, solo.slug));
	assert.match(alone, /not in a group/);
	assert.doesNotMatch(alone, /# Project manager/);
	assert.doesNotMatch(alone, /^# Group$/m);
	assert.doesNotMatch(alone, /^Members:$/m);
	assert.ok(alone.indexOf('not in a group') < alone.indexOf('# Runtime'));
	assert.doesNotMatch(fs.readFileSync(path.join(maple.path, 'SYSTEM.md'), 'utf8'), /\{\{team\}\}/);
});

test('a user close wakes the managers; a manager close does not', () => {
	const { root, maple } = World();
	OpenPoll(root, maple, { question: 'A?', choices: ['Yes', 'No'], in: '1h' }, 'user');
	ClosePoll(root, maple);
	assert.equal(TakeClosedPolls(root, new Date()).length, 1);
	OpenPoll(root, maple, { question: 'B?', choices: ['Yes', 'No'], in: '1h' }, maple.slug);
	ClosePoll(root, maple, { byManager: true });
	assert.equal(TakeClosedPolls(root, new Date()).length, 0);
});
