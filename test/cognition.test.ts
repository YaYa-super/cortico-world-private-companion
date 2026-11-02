import assert from 'node:assert/strict';
import { test } from 'node:test';

import { think } from '../src/cognition.ts';

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

test('背景念头：没有明显念头时返回 null', () => {
  const thought = think({ ...base, hour: 14, lastUserAt: Date.now(), journalToday: true, threads: [] });
  assert.equal(thought, null);
});
