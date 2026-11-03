import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { create, defaults } from '../src/index.ts';

test('proactive 回执：有可见正文才算 spoken', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-tap-'));
  const w = create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, proactiveEnabled: false, memoryCapture: false },
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
  } as never) as never as {
    start(host: unknown): Promise<void>;
    stop(): Promise<void>;
    tools(): Array<{ name: string; handler: (a: Record<string, unknown>, c: unknown) => Promise<unknown> }>;
    outputTap(): { onEvent(e: unknown): void };
    onTurnEnded(): void;
    state: { sentTexts: Array<{ text: string }> };
  };
  const host = {
    pushEvent: async () => ({ cursor: 1, contextDelivery: 'deliver' }),
    pushDeferred: () => {},
    store: {
      range: () => [], latestCursor: () => 0, get: () => undefined,
      around: () => [], grep: () => [],
    },
    withdrawPending: async () => true,
    modelFacts: {},
    blob: () => null,
    reportUsage: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  await w.start(host);
  const tool = w.tools().find((item) => item.name === 'companion_proactive');
  assert.ok(tool);
  const out = await tool.handler({ action: 'trigger' }, {});
  assert.match(String(out), /唤醒/);
  w.outputTap().onEvent({ type: 'response.output_text.delta', delta: '我在。' });
  w.onTurnEnded();
  assert.equal(w.state.sentTexts.at(-1)?.text, '我在。');
  const mind = readFileSync(join(dataDir, 'private-companion', 'mind.jsonl'), 'utf8');
  assert.match(mind, /spoken/);
  await w.stop();
});


test('proactive 回执：没有可见正文只记 silent，不写 sentTexts', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-tap-silent-'));
  const w = create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, proactiveEnabled: false, memoryCapture: false },
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
  } as never) as never as {
    start(host: unknown): Promise<void>;
    stop(): Promise<void>;
    tools(): Array<{ name: string; handler: (a: Record<string, unknown>, c: unknown) => Promise<unknown> }>;
    outputTap(): { onEvent(e: unknown): void };
    onTurnEnded(): void;
    state: { sentTexts: Array<{ text: string }> };
  };
  const host = {
    pushEvent: async () => ({ cursor: 1, contextDelivery: 'deliver' }),
    pushDeferred: () => {},
    store: {
      range: () => [], latestCursor: () => 0, get: () => undefined,
      around: () => [], grep: () => [],
    },
    withdrawPending: async () => true,
    modelFacts: {},
    blob: () => null,
    reportUsage: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  await w.start(host);
  const tool = w.tools().find((item) => item.name === 'companion_proactive');
  assert.ok(tool);
  await tool.handler({ action: 'trigger' }, {});
  w.outputTap().onEvent({ type: 'response.output_item.added', item: { type: 'function_call' } });
  w.onTurnEnded();
  assert.equal(w.state.sentTexts.length, 0);
  const mind = readFileSync(join(dataDir, 'private-companion', 'mind.jsonl'), 'utf8');
  assert.match(mind, /silent/);
  await w.stop();
});
