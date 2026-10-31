import assert from 'node:assert/strict';
import test from 'node:test';

import { companionDefaults } from '../src/config.ts';
import { evaluate, reasonFor } from '../src/proactive.ts';
import { createInitialState } from '../src/state.ts';

const TZ = 'Asia/Shanghai';
const cfg = { ...companionDefaults(), enabled: true };

function base(now: Date, patch: Partial<ReturnType<typeof createInitialState>> = {}) {
  return { ...createInitialState(now, TZ, cfg), ...patch };
}

test('总开关关闭时不开口', () => {
  const now = new Date('2026-10-29T15:00:00+08:00');
  const gate = evaluate({
    cfg: { ...cfg, proactiveEnabled: false }, state: base(now), now, tz: TZ,
    lastUserAt: null, countToday: 0,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'off');
});

test('睡觉与免打扰各自拦住', () => {
  const night = new Date('2026-10-29T03:00:00+08:00');
  assert.equal(evaluate({ cfg, state: base(night), now: night, tz: TZ, lastUserAt: null, countToday: 0 }).code, 'sleep');
  const late = new Date('2026-10-29T23:30:00+08:00');
  const s = base(late, { sleeping: false });
  assert.equal(evaluate({ cfg, state: s, now: late, tz: TZ, lastUserAt: null, countToday: 0 }).code, 'quiet');
});

test('日上限与刚聊完的静默窗口', () => {
  const now = new Date('2026-10-29T15:00:00+08:00');
  const state = base(now, { proactiveDueAt: null });
  assert.equal(
    evaluate({ cfg, state, now, tz: TZ, lastUserAt: null, countToday: 4 }).code,
    'cap',
  );
  assert.equal(
    evaluate({ cfg, state, now, tz: TZ, lastUserAt: now.getTime() - 60_000, countToday: 0 }).code,
    'idle',
  );
});

test('未到下一次时不开口；到点且无阻拦时放行', () => {
  const now = new Date('2026-10-29T15:00:00+08:00');
  const future = base(now, { proactiveDueAt: new Date(now.getTime() + 60_000).toISOString() });
  assert.equal(evaluate({ cfg, state: future, now, tz: TZ, lastUserAt: null, countToday: 0 }).code, 'due');
  const ready = base(now, { proactiveDueAt: new Date(now.getTime() - 60_000).toISOString() });
  assert.equal(evaluate({ cfg, state: ready, now, tz: TZ, lastUserAt: null, countToday: 0 }).ok, true);
});

test('由头来自状态而不是随机问候', () => {
  const now = new Date('2026-10-29T15:00:00+08:00');
  const tired = base(now, { energy: 20, mood: 30 });
  const reason = reasonFor({ state: tired, now, tz: TZ, sinceTalkMs: 4 * 3_600_000, seed: 7 });
  assert.ok(reason.length > 0);
  assert.ok(/累|心情|没怎么说话/.test(reason), reason);
  const night = new Date('2026-10-29T21:30:00+08:00');
  const evening = reasonFor({
    state: base(night, { sleeping: false }), now: night, tz: TZ, sinceTalkMs: null, seed: 11,
  });
  assert.ok(evening.length > 0);
});
