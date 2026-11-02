import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { create, defaults } from '../src/index.ts';

function world() {
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-trigger-'));
  return create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, proactiveEnabled: true },
    timezone: 'Asia/Shanghai',
    botName: 'coo',
    botDir: dataDir,
    packageDir: dataDir,
    dataDir,
    repoRoot: dataDir,
    secret: () => '',
    storeSecret: () => {},
    persist: () => {},
    restart: async () => {},
  } as never) as unknown as {
    state: {
      energy: number;
      mood: number;
      sleeping: boolean;
      lastAgendaKey: string;
      lastSleeping: boolean;
      pendingTrigger: { key: string } | null;
    };
    scheduleProactiveTriggers: (now: Date) => void;
  };
}

test('没有计时器：低精力是事件触发出来的候选', () => {
  const w = world();
  w.state.energy = 20;
  w.state.mood = 55;
  w.state.sleeping = false;
  w.state.lastAgendaKey = '';
  w.state.lastSleeping = false;
  w.scheduleProactiveTriggers(new Date('2026-11-02T15:00:00+08:00'));
  assert.equal(w.state.pendingTrigger?.key, 'body:low-energy');
});

test('没有状态变化时不产生候选', () => {
  const w = world();
  w.state.energy = 60;
  w.state.mood = 55;
  w.state.sleeping = false;
  w.state.lastAgendaKey = '';
  w.state.lastSleeping = false;
  w.scheduleProactiveTriggers(new Date('2026-11-02T15:00:00+08:00'));
  assert.equal(w.state.pendingTrigger, null);
});
