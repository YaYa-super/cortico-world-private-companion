import assert from 'node:assert/strict';
import test from 'node:test';

import { companionDefaults } from '../src/config.ts';
import {
  advance, agendaText, createInitialState, currentItem, generateAgenda, nextDueAt,
  upcomingItem,
} from '../src/state.ts';
import { localParts } from '../src/time.ts';

const TZ = 'Asia/Shanghai';
const cfg = { ...companionDefaults(), enabled: true };

test('节目单按日期确定性生成，时间递增', () => {
  const a = generateAgenda('2026-10-29');
  const b = generateAgenda('2026-10-29');
  assert.deepEqual(a, b);
  assert.equal(a.length, 6);
  const minutes = a.map((item) => Number(item.time.slice(0, 2)) * 60 + Number(item.time.slice(3)));
  assert.deepEqual(minutes, [...minutes].sort((x, y) => x - y));
  assert.notDeepEqual(generateAgenda('2026-10-30'), a);
});

test('当前项与下一项', () => {
  const agenda = generateAgenda('2026-10-29');
  assert.equal(currentItem(agenda, 7 * 60), null);
  assert.equal(currentItem(agenda, 9 * 60)?.time, '08:10');
  assert.equal(upcomingItem(agenda, 9 * 60)?.time, '10:30');
  assert.match(agendaText(agenda, localParts(new Date('2026-10-29T12:00:00+08:00'), TZ)), /现在/);
});

test('跨天：换日、精力回升、日程重排', () => {
  const late = new Date('2026-10-29T23:50:00+08:00');
  const state = createInitialState(late, TZ, cfg);
  state.energy = 20;
  state.updatedAt = late.toISOString();
  const next = new Date('2026-10-30T08:10:00+08:00');
  const { state: after, changed } = advance(state, next, TZ, cfg);
  assert.equal(changed, true);
  assert.equal(after.day, '2026-10-30');
  assert.ok(after.energy > 20, `精力应回升，实际 ${after.energy}`);
  assert.equal(after.agenda.length, 6);
  assert.equal(after.sleeping, false);
  assert.equal(after.activity, after.agenda[0].title);
});

test('睡觉时段：精力回升、活动是睡觉', () => {
  const night = new Date('2026-10-29T03:00:00+08:00');
  const state = createInitialState(new Date('2026-10-29T02:00:00+08:00'), TZ, cfg);
  state.energy = 40;
  state.updatedAt = new Date('2026-10-29T02:00:00+08:00').toISOString();
  advance(state, night, TZ, cfg);
  assert.equal(state.sleeping, true);
  assert.equal(state.activity, '睡觉');
  assert.equal(state.location, '床');
  assert.ok(state.energy > 40);
});

test('关闭日程后不再自动生成，但保留已有安排', () => {
  const now = new Date('2026-10-29T09:00:00+08:00');
  const state = createInitialState(now, TZ, cfg);
  const before = state.agenda.length;
  const off = { ...cfg, agendaEnabled: false };
  advance(state, new Date('2026-10-30T09:00:00+08:00'), TZ, off);
  assert.equal(state.agenda.length, before);
});

test('nextDueAt 遵守间隔与抖动范围', () => {
  const from = new Date('2026-10-29T09:00:00+08:00');
  const noJitter = { ...cfg, proactiveMinGapMin: 30, proactiveJitterMin: 0 };
  assert.equal(
    new Date(nextDueAt(from, noJitter, 1)).getTime() - from.getTime(),
    30 * 60_000,
  );
  const jitter = { ...cfg, proactiveMinGapMin: 30, proactiveJitterMin: 20 };
  for (const seed of [1, 999, 123456]) {
    const delta = new Date(nextDueAt(from, jitter, seed)).getTime() - from.getTime();
    assert.ok(delta >= 30 * 60_000 && delta <= 50 * 60_000, `delta=${delta}`);
  }
});
