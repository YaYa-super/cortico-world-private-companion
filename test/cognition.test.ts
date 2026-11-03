import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDuplicateSent, makeIntention, pickActionable, scoreThought, textSimilarity, think, thinkAll } from '../src/cognition.ts';

const base = {
  now: new Date('2026-11-02T20:00:00+08:00'),
  hour: 20,
  energy: 60,
  mood: 55,
  activity: '发呆',
  lastUserAt: null,
  journalToday: true,
  threads: [],
};

test('背景念头：低精力优先想休息', () => {
  const thought = think({ ...base, energy: 18, threads: [{ id: 't1', text: '插件还没做完' }] });
  assert.equal(thought?.action, 'rest');
  assert.equal(thought?.source, 'body');
});

test('背景念头：未完成话头会产生“想找他”的意图', () => {
  const thought = think({ ...base, threads: [{ id: 't1', text: '插件还没做完', what: '插件还没做完' }] });
  assert.equal(thought?.action, 'contact');
  assert.match(thought?.text ?? '', /上次没说完/);
});

test('背景念头：晚上没写日记会想记一句', () => {
  const thought = think({ ...base, journalToday: false, threads: [] });
  assert.equal(thought?.action, 'journal');
  assert.match(thought?.text ?? '', /日记/);
});

test('背景念头：刚想过的话头不会复读', () => {
  const input = { ...base, threads: [{ id: 't1', text: '插件还没做完', what: '插件还没做完' }] };
  assert.equal(think(input)?.action, 'contact');
  assert.equal(think(input, ['thread:t1']), null);
});

test('念头会变成有到期时间的意图', () => {
  const thought = think({ ...base, threads: [{ id: 't1', text: '插件还没做完', what: '插件还没做完' }] });
  assert.ok(thought);
  const intention = makeIntention(thought, base.now);
  assert.equal(intention.action, 'contact');
  assert.equal(intention.status, 'pending');
  assert.equal(Date.parse(intention.dueAt) - base.now.getTime(), 30 * 60_000);
});

test('同一段记忆不会用两种说法反复出现', () => {
  const input = {
    ...base,
    episodes: [{ id: 'e1', text: '昨晚一起看海' }],
    memories: [{ id: 'e1', text: '昨晚一起看海' }],
  };
  assert.equal(think(input)?.key, 'memory:e1');
  assert.equal(think(input, ['memory:e1']), null);
});

test('候选评分会被未回应和繁忙拉低', () => {
  const thought = think({ ...base, threads: [{ id: 't1', text: '插件还没做完', what: '插件还没做完' }] });
  assert.ok(thought);
  const fresh = scoreThought(thought, { unanswered: 0, busy: false });
  const tired = scoreThought(thought, { unanswered: 2, busy: true });
  assert.ok(tired < fresh, `${tired} < ${fresh}`);
});

test('发送前相似度能识别重复措辞', () => {
  assert.ok(textSimilarity('上次没说完的事：插件还没做完', '上次没说完的事：插件还没做完') > 0.9);
  assert.ok(textSimilarity('今天累死了', '明天天气不错') < 0.2);
});

test('thinkAll 不吞掉被 silent 压住的可行动候选', () => {
  const thoughts = thinkAll({
    ...base,
    mood: 80,
    episodes: [{ id: 'e1', text: '昨晚一起看海' }],
    threads: [],
  });
  assert.equal(thoughts[0]?.action, 'silent');
  const actionable = pickActionable(thoughts, { hour: 12, journalToday: true });
  assert.ok(actionable);
  assert.equal(actionable?.action, 'journal');
});

test('高显著 silent 在晚上转 journal，其他时间转 remember', () => {
  const thoughts = thinkAll({
    ...base,
    episodes: [{ id: 'e1', text: '昨晚一起看海' }],
    threads: [],
    journalToday: false,
  });
  assert.equal(thoughts[0]?.action, 'silent');
  assert.equal(pickActionable(thoughts, { hour: 20, journalToday: false })?.action, 'journal');
  const withoutJournal = thinkAll({
    ...base,
    episodes: [{ id: 'e1', text: '昨晚一起看海' }],
    threads: [],
    journalToday: true,
  });
  assert.equal(pickActionable(withoutJournal, { hour: 20, journalToday: true })?.action, 'remember');
});

test('24h 内说过相似内容会被去重', () => {
  const sent = [{ text: '上次没说完的事：视频插件', at: '2026-11-02T20:00:00+08:00' }];
  assert.equal(isDuplicateSent('上次没说完的事：视频插件', sent, new Date('2026-11-03T10:00:00+08:00').getTime()), true);
  assert.equal(isDuplicateSent('今天午饭吃什么', sent, new Date('2026-11-03T10:00:00+08:00').getTime()), false);
  assert.equal(isDuplicateSent('上次没说完的事：视频插件', sent, new Date('2026-11-04T10:00:00+08:00').getTime()), false);
});

test('背景念头：没有明显念头时返回 null', () => {
  const thought = think({ ...base, hour: 14, lastUserAt: Date.now(), journalToday: true, threads: [] });
  assert.equal(thought, null);
});
