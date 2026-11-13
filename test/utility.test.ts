import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeUtility, outcomeOf, rankCandidates, updateReplyRate,
} from '../src/utility.ts';

test('高价值话头能过阈值，低价值天气过不了', () => {
  const thread = computeUtility({ source: 'thread', salience: 0.8 });
  const weather = computeUtility({ source: 'weather', salience: 0.3 });
  assert.equal(thread.ok, true);
  assert.ok(thread.score > 0.4, `thread score ${thread.score}`);
  assert.equal(weather.ok, false);
  assert.ok(weather.score < 0, `weather score ${weather.score}`);
});

test('忙只加成本，不硬拦高价值由头', () => {
  const normal = computeUtility({ source: 'thread', salience: 0.8 });
  const busy = computeUtility({ source: 'thread', salience: 0.8, busy: true });
  assert.ok(busy.score < normal.score);
  assert.ok(busy.cost > normal.cost);
  const socialBusy = computeUtility({ source: 'social', salience: 0.55, busy: true });
  assert.equal(socialBusy.ok, false);
});

test('刚聊完、刚主动过、未回应都会提高成本', () => {
  const base = computeUtility({ source: 'memory', salience: 0.8 });
  const justChat = computeUtility({ source: 'memory', salience: 0.8, minutesSinceUser: 3 });
  const justSent = computeUtility({ source: 'memory', salience: 0.8, hoursSinceProactive: 1 });
  const onceIgnored = computeUtility({ source: 'memory', salience: 0.8, unanswered: 1 });
  assert.ok(justChat.score < base.score);
  assert.ok(justSent.score < base.score);
  assert.ok(onceIgnored.score < base.score);
});

test('未回应≥2、重复、休息时段直接拦', () => {
  const ignored = computeUtility({ source: 'thread', salience: 0.95, unanswered: 2 });
  assert.equal(ignored.ok, false);
  assert.equal(ignored.code, 'unanswered');
  const repeated = computeUtility({ source: 'thread', salience: 0.95, repeated: true });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.code, 'duplicate');
  const quiet = computeUtility({ source: 'thread', salience: 0.95, quiet: true });
  assert.equal(quiet.ok, false);
  assert.equal(quiet.code, 'quiet');
});

test('回复率高时打扰更便宜，总被忽略时更贵', () => {
  const neutral = computeUtility({ source: 'social', salience: 0.6 });
  const liked = computeUtility({ source: 'social', salience: 0.6, replyRate: 0.9 });
  const disliked = computeUtility({ source: 'social', salience: 0.6, replyRate: 0.1 });
  assert.ok(liked.cost < neutral.cost);
  assert.ok(disliked.cost > neutral.cost);
  assert.ok(liked.score > neutral.score);
});

test('terms 的贡献之和约等于 score', () => {
  for (const input of [
    { source: 'thread', salience: 0.8 },
    { source: 'social', salience: 0.55, busy: true, minutesSinceUser: 10 },
    { source: 'weather', salience: 0.3, unanswered: 1 },
    { source: 'memory', salience: 0.65, replyRate: 0.2, hoursSinceProactive: 2 },
  ]) {
    const result = computeUtility(input);
    const sum = result.terms.reduce((total, term) => total + term.value, 0);
    assert.ok(Math.abs(sum - result.score) < 0.005, `${input.source}: ${sum} vs ${result.score}`);
  }
});

test('候选排序把放行的、分数高的排前面', () => {
  const ranked = rankCandidates([
    { key: 'weather', source: 'weather', salience: 0.3 },
    { key: 'thread', source: 'thread', salience: 0.8 },
    { key: 'social', source: 'social', salience: 0.6 },
  ], {});
  assert.equal(ranked[0].candidate.key, 'thread');
  assert.equal(ranked[0].result.ok, true);
  assert.equal(ranked[ranked.length - 1].candidate.key, 'weather');
});

test('黏人度只放大由头值，不动打扰成本', () => {
  const shy = computeUtility({ source: 'social', salience: 0.55, clinginess: 0.5 });
  const clingy = computeUtility({ source: 'social', salience: 0.55, clinginess: 2 });
  assert.equal(shy.cost, clingy.cost);
  assert.ok(clingy.benefit > shy.benefit);
  assert.ok(clingy.score > shy.score);
  assert.equal(shy.ok, false);
  assert.equal(clingy.ok, true);
});

test('记忆类由头绕过刚聊过成本', () => {
  const normal = computeUtility({ source: 'memory', salience: 0.8, minutesSinceUser: 5 });
  const bypass = computeUtility({ source: 'memory', salience: 0.8, minutesSinceUser: 5, bypassRecentChat: true });
  assert.equal(normal.cost, 0.44);
  assert.equal(bypass.cost, 0.16);
  assert.ok(bypass.score > normal.score);
});

test('结果分类与回复率更新', () => {
  assert.equal(outcomeOf({ delivered: false, minutesSinceSend: 1 }), 'silent');
  assert.equal(outcomeOf({ delivered: true, replied: true, minutesSinceSend: 4 }), 'replied');
  assert.equal(outcomeOf({ delivered: true, minutesSinceSend: 10 }), 'pending');
  assert.equal(outcomeOf({ delivered: true, minutesSinceSend: 200 }), 'ignored');

  const up = updateReplyRate(0.5, 'replied');
  const down = updateReplyRate(0.5, 'ignored');
  assert.ok(up > 0.5 && up < 1);
  assert.ok(down < 0.5 && down >= 0);
  assert.equal(updateReplyRate(0.5, 'silent'), 0.5);
});
