import assert from 'node:assert/strict';
import test from 'node:test';

import { hmToMinutes, humanSpan, inWindow, localParts, minutesToHm, startOfLocalDayMs } from '../src/time.ts';

test('hmToMinutes 解析合法时刻，拒绝非法值', () => {
  assert.equal(hmToMinutes('08:30'), 510);
  assert.equal(hmToMinutes('00:00'), 0);
  assert.equal(hmToMinutes('23:59'), 1439);
  assert.equal(hmToMinutes('24:00'), null);
  assert.equal(hmToMinutes('8:3'), null);
  assert.equal(hmToMinutes('abc'), null);
});

test('inWindow 支持跨零点，起止相同视为关闭', () => {
  assert.equal(inWindow(30, '23:00', '08:30'), true);   // 00:30
  assert.equal(inWindow(23 * 60 + 30, '23:00', '08:30'), true);
  assert.equal(inWindow(12 * 60, '23:00', '08:30'), false);
  assert.equal(inWindow(30, '08:30', '08:30'), false);
  assert.equal(inWindow(9 * 60, '08:30', '23:00'), true);
});

test('minutesToHm 归一化到 0-1439', () => {
  assert.equal(minutesToHm(0), '00:00');
  assert.equal(minutesToHm(1440), '00:00');
  assert.equal(minutesToHm(-10), '23:50');
});

test('humanSpan 用中文给时长', () => {
  assert.equal(humanSpan(0), '刚');
  assert.equal(humanSpan(60_000), '1 分钟');
  assert.equal(humanSpan(90_000), '2 分钟');
  assert.equal(humanSpan(3_600_000), '1 小时');
  assert.equal(humanSpan(90 * 60_000), '1 小时 30 分钟');
});

test('localParts 按部署时区换算', () => {
  const p = localParts(new Date('2026-10-29T11:30:00Z'), 'Asia/Shanghai');
  assert.equal(p.date, '2026-10-29');
  assert.equal(p.hour, 19);
  assert.equal(p.minute, 30);
  assert.equal(p.weekday, '周四');
  assert.equal(p.minutes, 19 * 60 + 30);
});

test('startOfLocalDayMs 按部署时区切自然日', () => {
  const start = startOfLocalDayMs(new Date('2026-11-05T09:00:00+08:00'), 'Asia/Shanghai');
  assert.equal(new Date(start).toISOString(), '2026-11-04T16:00:00.000Z');
  const before = startOfLocalDayMs(new Date('2026-11-05T00:01:00+08:00'), 'Asia/Shanghai');
  assert.equal(new Date(before).toISOString(), '2026-11-04T16:00:00.000Z');
});
