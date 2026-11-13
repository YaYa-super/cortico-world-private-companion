import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { create, defaults } from '../src/index.ts';

function world(overrides: Record<string, unknown> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-trigger-'));
  return create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, proactiveEnabled: true, ...overrides },
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
    decideProactive: (
      candidate: { key: string; text: string; salience: number; source: string },
      now: Date,
      input: { busy: boolean; minutesSinceUser: number | null },
    ) => { ok: boolean; score: number; reason: string; code: string; mode: string };
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

const NOW = new Date('2026-11-02T15:00:00+08:00');

test('utility：空闲时话头放行、天气不放行', () => {
  const w = world({ proactiveDecision: 'utility', proactiveClinginess: 1.3 });
  const high = w.decideProactive(
    { key: 'thread', text: '音色的 bug 还没修', salience: 0.8, source: 'thread' },
    NOW,
    { busy: false, minutesSinceUser: 120 },
  );
  assert.equal(high.mode, 'utility');
  assert.equal(high.ok, true);
  const low = w.decideProactive(
    { key: 'weather', text: '下雨了', salience: 0.3, source: 'weather' },
    NOW,
    { busy: false, minutesSinceUser: 120 },
  );
  assert.equal(low.ok, false);
});

test('utility：忙只加成本，高价值仍可过线，低价值不过', () => {
  const w = world({ proactiveDecision: 'utility' });
  const thread = w.decideProactive(
    { key: 'thread', text: '答应过他的事还没做', salience: 0.8, source: 'thread' },
    NOW,
    { busy: true, minutesSinceUser: 300 },
  );
  assert.equal(thread.ok, true);
  const social = w.decideProactive(
    { key: 'social', text: '很久没说话', salience: 0.55, source: 'social' },
    NOW,
    { busy: true, minutesSinceUser: 300 },
  );
  assert.equal(social.ok, false);
});

test('gate 模式保持旧阈值', () => {
  const w = world({ proactiveDecision: 'gate' });
  const mid = w.decideProactive(
    { key: 'm', text: '随便一条', salience: 0.4, source: 'memory' },
    NOW,
    { busy: false, minutesSinceUser: 120 },
  );
  assert.equal(mid.ok, false);
  const high = w.decideProactive(
    { key: 'h', text: '重要的事', salience: 0.8, source: 'memory' },
    NOW,
    { busy: false, minutesSinceUser: 120 },
  );
  assert.equal(high.ok, true);
  assert.equal(high.mode, 'gate');
});

test('shadow 模式行为跟 gate，分数记效用', () => {
  const w = world({ proactiveDecision: 'shadow' });
  const result = w.decideProactive(
    { key: 'm', text: '随便一条', salience: 0.4, source: 'memory' },
    NOW,
    { busy: false, minutesSinceUser: 120 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'shadow');
  assert.match(result.reason, /^\[shadow\]/);
});

type DigestWorld = {
  memoryStore: { add: (input: Record<string, unknown>) => unknown };
  memoryDigest: () => { person?: string; model?: string };
};

function personRecord(): Record<string, unknown> {
  return {
    kind: 'person',
    text: '爸爸（父女）：称呼：主人；偏好：喜欢安静。',
    details: { personId: 'main', relationLabel: '父女', preferences: ['喜欢安静'] },
  };
}

test('utility：记忆由头绕过刚聊过成本', () => {
  const w = world({ proactiveDecision: 'utility' });
  const result = w.decideProactive(
    { key: 'm', text: '忽然想起一件事', salience: 0.8, source: 'memory' },
    NOW,
    { busy: false, minutesSinceUser: 5 },
  );
  // 不绕过时 cost = 0.16 + 0.28，score ≈ 0.34；绕过只剩 0.16，score ≈ 0.62。
  assert.ok(result.score > 0.45, String(result.score));
});

test('onebot_call 的 send_* 算真正说出的内容', () => {
  const w = world() as unknown as {
    wakeTools: Array<{ id: string; name: string; args: string }>;
    wakeToolSpeech: () => string[];
  };
  w.wakeTools = [
    {
      id: '1',
      name: 'onebot_call',
      args: JSON.stringify({
        action: 'send_private_msg',
        params: { message: [{ type: 'text', data: { text: '饭吃了没' } }, { type: 'image', data: { file: 'x.jpg' } }] },
      }),
    },
    { id: '2', name: 'onebot_call', args: JSON.stringify({ action: 'send_group_msg', params: { message: '群里说一句' } }) },
    { id: '3', name: 'onebot_call', args: JSON.stringify({ action: 'get_login_info', params: {} }) },
    { id: '4', name: 'pet_say', args: JSON.stringify({ script: '喵' }) },
  ];
  assert.deepEqual(w.wakeToolSpeech(), ['饭吃了没', '群里说一句', '喵']);
});

test('用户模型有内容时替代人物摘要', () => {
  const w = world() as unknown as DigestWorld;
  const before = w.memoryDigest();
  assert.equal(before.model, undefined);
  w.memoryStore.add(personRecord());
  const after = w.memoryDigest();
  assert.match(after.model ?? '', /【我对他的理解】/);
  assert.equal(after.person, undefined);
});

test('关掉用户模型后回退人物摘要', () => {
  const w = world({ userModelInPrompt: false }) as unknown as DigestWorld;
  w.memoryStore.add(personRecord());
  const digest = w.memoryDigest();
  assert.equal(digest.model, undefined);
  assert.match(digest.person ?? '', /^他：/);
});
