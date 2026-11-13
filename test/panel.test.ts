import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { create, defaults } from '../src/index.ts';

function world(extraCfg: Record<string, unknown> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-panel-'));
  return create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, ...extraCfg },
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
    memoryStore: { add: (input: Record<string, unknown>) => unknown };
    invokeMemoryPanel: (panel: string, method: string, args: unknown[]) => Promise<Record<string, unknown>>;
    decideProactive: (...args: unknown[]) => Record<string, unknown>;
    webUi: () => { panels: Array<{ id: string; title: string }> };
    invokeQqPanel: (method: string, args: unknown[]) => Promise<Record<string, unknown>>;
    invokeBiliPanel: (method: string, args: unknown[]) => Promise<Record<string, unknown>>;
    tools: () => Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<{ text?: string; failed?: boolean }> }>;
  };
}

const person = {
  kind: 'person',
  text: '爸爸（父女）：称呼：主人；偏好：喜欢安静。',
  details: { personId: 'main', relationLabel: '父女', preferences: ['喜欢安静'], closeness: 0.8 },
  importance: 0.9,
};
const episode = {
  kind: 'episode',
  text: '今天一起看了《五分钟学会做白饭》。',
  details: { userEmotion: { label: '开心', intensity: 0.7 } },
  importance: 0.7,
};

test('dashboard 返回此刻/关系/模型/时间线', async () => {
  const w = world();
  w.memoryStore.add(person);
  w.memoryStore.add(episode);
  const dash = await w.invokeMemoryPanel('life', 'dashboard', []);
  assert.equal((dash.now as Record<string, unknown>).date.length, 10);
  assert.ok((dash.relationship as Record<string, unknown>).daysTogether >= 1);
  assert.ok(Array.isArray(dash.model));
  assert.ok((dash.model as unknown[]).length >= 1);
  assert.ok(Array.isArray(dash.timeline));
  assert.ok(Array.isArray(dash.mind));
  assert.equal((dash.memory as Record<string, unknown>).records, 2);
});

test('constellation 返回节点/边，并且包含人物节点', async () => {
  const w = world();
  w.memoryStore.add(person);
  w.memoryStore.add(episode);
  w.memoryStore.add({ ...episode, text: '第二件事', details: {}, tags: ['日常'] });
  const graph = await w.invokeMemoryPanel('life', 'constellation', []);
  const nodes = graph.nodes as Array<Record<string, unknown>>;
  const edges = graph.edges as Array<Record<string, unknown>>;
  assert.equal(nodes.length, 3);
  assert.ok(nodes.some((node) => node.kind === 'person'));
  assert.ok(Array.isArray(edges));
  assert.equal(graph.total, 3);
});

test('search 全库返回全文/标签/重要度，供新面板展示', async () => {
  const w = world();
  w.memoryStore.add({ ...episode, text: '今天一起加班到很晚，他说有点累。', tags: ['工作', '加班'], importance: 0.82 });
  const result = await w.invokeMemoryPanel('life', 'search', ['加班', '*', 50]);
  const hits = result.hits as Array<Record<string, unknown>>;
  assert.equal(hits.length, 1);
  assert.match(String(hits[0].text), /加班/);
  assert.equal(hits[0].importance, 0.82);
  assert.deepEqual(hits[0].tags, ['工作', '加班']);
});

test('merges 返回合并摘要，供新面板撤销', async () => {
  const w = world();
  const added = w.memoryStore.add({
    ...episode,
    text: '两条原文合并成的一条摘要。',
    tags: ['merge'],
    details: { merged: true, mergedCount: 2, mergedFrom: ['a', 'b'] },
  }) as { id: string };
  const result = await w.invokeMemoryPanel('life', 'merges', []);
  const merges = result.merges as Array<Record<string, unknown>>;
  assert.equal(merges.length, 1);
  assert.equal(merges[0].id, added.id);
  assert.equal(merges[0].count, 2);
});

test('QQ/B站面板和工具默认关闭，打开可选开关后才出现', async () => {
  const off = world();
  assert.deepEqual(off.webUi().panels.map((panel) => panel.id), ['life']);
  assert.equal(off.tools().some((tool) => tool.name.startsWith('qq_')), false);
  const offRecent = await off.tools().find((tool) => tool.name === 'qq_recent')?.handler({});
  assert.equal(offRecent, undefined);
  const on = world({ qqChannelEnabled: true, biliChannelEnabled: true });
  assert.deepEqual(on.webUi().panels.map((panel) => panel.id), ['life', 'qq', 'bili']);
  const onNames = on.tools().map((tool) => tool.name);
  assert.ok(onNames.includes('qq_status'));
  assert.ok(onNames.includes('qq_recent'));
  assert.ok(onNames.includes('bili_search'));
  assert.ok(onNames.includes('bili_info'));
  assert.ok(onNames.includes('qq_view_image'));
  assert.ok(onNames.includes('qq_media_note'));
  assert.ok(onNames.includes('qq_actions'));
  assert.ok(onNames.includes('qq_call'));
  assert.ok(onNames.includes('qq_receive'));
  const catalog = await on.tools().find((tool) => tool.name === 'qq_actions')?.handler({ query: '群', limit: 5 });
  assert.match(String(catalog), /群/);
  const blocked = await on.tools().find((tool) => tool.name === 'qq_call')?.handler({ action: 'set_restart', confirm: true });
  assert.match(String(blocked), /禁用/);
  const qqStatus = await on.tools().find((tool) => tool.name === 'qq_status')?.handler({});
  assert.match(String(qqStatus), /QQ/);
  const qq = await on.invokeQqPanel('status', []);
  assert.equal((qq.status as Record<string, unknown>).state, 'disabled');
  assert.ok(Array.isArray(qq.recent));
  const bili = await on.invokeBiliPanel('status', []);
  const design = bili.design as Record<string, unknown>;
  assert.equal(design.phase, 'readonly');
  assert.equal((design.capabilities as unknown[]).length, 6);
});

test('decideProactive 返回效用 terms 和 threshold', () => {
  const w = world();
  const result = w.decideProactive(
    { key: 'thread', text: '答应过的事', salience: 0.8, source: 'thread' },
    new Date('2026-11-10T15:00:00+08:00'),
    { busy: false, minutesSinceUser: 300 },
  );
  assert.equal(result.mode, 'utility');
  assert.ok(Array.isArray(result.terms));
  assert.ok((result.terms as unknown[]).length >= 2);
  assert.equal(typeof result.threshold, 'number');
});
