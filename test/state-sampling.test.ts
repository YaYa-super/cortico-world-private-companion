import assert from 'node:assert/strict';
import { test } from 'node:test';

import { companionDefaults } from '../src/config.ts';
import { advance, createInitialState } from '../src/state.ts';

test('短间隔采样按真实时长，不会把 60s 当成 15 分钟', () => {
  const cfg = companionDefaults();
  const now = new Date('2026-10-30T12:00:00+08:00');
  const state = createInitialState(now, 'Asia/Shanghai', cfg);
  state.energy = 72;
  state.updatedAt = new Date(now.getTime() - 60_000).toISOString();
  advance(state, now, 'Asia/Shanghai', cfg);
  // 醒着 1 分钟：2.5/h → 约掉 0.0417，而不是 0.625。
  assert.ok(state.energy > 71.9 && state.energy < 72, `energy=${state.energy}`);
});
