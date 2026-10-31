import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { create, defaults } from '../src/index.ts';
import { MemoryStore } from '../src/memory-store.ts';

test('世界层：捕获情绪 → 上下文出现“今天”和情绪回声', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-world-echo-'));
  const memory = new MemoryStore(join(dataDir, 'private-companion', 'memory'));
  const past = memory.add({
    kind: 'episode',
    text: '他说连续加班三天，回家累得不想说话',
    scope: 'qq:1021036873',
    importance: 0.8,
    details: { userEmotion: { label: '疲惫', cause: '连续加班', intensity: 0.8 } },
  });
  const record = memory.entries().find((item) => item.id === past.id)!;
  record.ts = new Date(Date.now() - 3 * 86_400_000).toISOString();
  memory.add({ kind: 'episode', text: '今天一起看了海', scope: 'qq:1021036873', importance: 0.7 });

  const event = {
    type: 'message',
    ts: new Date().toISOString(),
    origin: 'external',
    source: 'onebot',
    senderKey: '1021036873',
    text: '今天累死了，又加班',
    meta: {},
  };
  const pushed: Array<{ type: string; text: string }> = [];
  let cursor = 0;
  const host = {
    pushEvent: async (e: { type: string; text: string }) => {
      pushed.push({ type: e.type, text: e.text });
      cursor += 1;
      return { cursor };
    },
    pushDeferred: () => {},
    store: {
      range: () => [event],
      latestCursor: () => 1,
      get: (index: number) => (index === 1 ? event : undefined),
      around: () => [],
      grep: () => [],
    },
    withdrawPending: async () => true,
    modelFacts: {},
    blob: () => null,
    reportUsage: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  const world = create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, memoryCapture: true },
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
  } as never);
  await world.start(host as never);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const before = pushed.filter((item) => item.type === 'companion.context').length;
  const internal = world as unknown as {
    tick: (force: boolean) => void;
    state: { surfacedMemories: Record<string, string> };
  };
  internal.tick(false);
  internal.tick(false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const after = pushed.filter((item) => item.type === 'companion.context').length;
  assert.equal(after, before, '同一人类事件不应因回声每 tick 重推 context');
  assert.equal(Object.keys(internal.state.surfacedMemories).length, 1);

  const panel = world as unknown as {
    invokeMemoryPanel: (panel: string, method: string, args: unknown[]) => Promise<Record<string, unknown>>;
  };
  const overview = await panel.invokeMemoryPanel('memory', 'overview', []);
  assert.ok(Number(overview.records) >= 2);
  assert.equal(overview.error, null);
  const search = await panel.invokeMemoryPanel('memory', 'search', ['海', '*', 5]) as { hits: unknown[] };
  assert.ok(search.hits.length >= 1);
  const merges = await panel.invokeMemoryPanel('memory', 'merges', []) as { merges: unknown[] };
  assert.ok(Array.isArray(merges.merges));
  const recent = await panel.invokeMemoryPanel('memory', 'recent', []) as { recent: unknown[] };
  assert.ok(recent.recent.length >= 2);
  const mind = await panel.invokeMemoryPanel('memory', 'mind', [50, '']) as { events: Array<{ type: string }> };
  assert.ok(mind.events.some((event) => event.type === 'echo'));

  const tools = world as unknown as {
    toolRemember: (args: Record<string, unknown>) => Promise<unknown>;
  };
  await tools.toolRemember({
    kind: 'episode',
    text: '今天累死了，又加班',
    scope: 'main',
    importance: 0.7,
  });
  const recent2 = await panel.invokeMemoryPanel('memory', 'recent', []) as {
    recent: Array<{ text: string; emotion: string }>;
  };
  const tagged = recent2.recent.find((row) => row.text.includes('今天累死了'));
  assert.ok(tagged);
  assert.equal(tagged.emotion, '疲惫');

  await world.stop();

  const context = pushed.filter((item) => item.type === 'companion.context').map((item) => item.text).join('\n');
  assert.match(context, /今天：/);
  assert.match(context, /一起看了海/);
  assert.match(context, /情绪回声/);
  assert.match(context, /连续加班/);
});

test('世界层：空闲超过阈值会触发一次 musing（白天）', async (t) => {
  const hour = new Date().getHours();
  if (hour < 8 || hour >= 23) {
    t.skip('夜间不跑这条，musing 只在 8-23 点触发');
    return;
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-world-muse-'));
  const event = {
    type: 'message',
    ts: new Date(Date.now() - 10 * 3_600_000).toISOString(),
    origin: 'external',
    source: 'onebot',
    senderKey: '1021036873',
    text: '先去忙了',
    meta: {},
  };
  const pushed: Array<{ type: string; text: string }> = [];
  let cursor = 0;
  const host = {
    pushEvent: async (e: { type: string; text: string }) => {
      pushed.push({ type: e.type, text: e.text });
      cursor += 1;
      return { cursor };
    },
    pushDeferred: () => {},
    store: {
      range: () => [event],
      latestCursor: () => 0,
      get: () => undefined,
      around: () => [],
      grep: () => [],
    },
    withdrawPending: async () => true,
    modelFacts: {},
    blob: () => null,
    reportUsage: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  const world = create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, memoryCapture: false },
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
  } as never);
  await world.start(host as never);
  await world.stop();
  const muse = pushed.filter((item) => item.type === 'companion.muse');
  assert.equal(muse.length, 1);
  assert.match(muse[0].text, /胡思乱想/);
  assert.match(muse[0].text, /musing/);
});

