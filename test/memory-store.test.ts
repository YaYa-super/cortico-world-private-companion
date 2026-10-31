import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MemoryStore, tokenize } from '../src/memory-store.ts';

function tempStore(): { store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'companion-mem-'));
  return { store: new MemoryStore(dir), dir };
}

test('tokenize 切出 CJK 2-gram 与拉丁词', () => {
  const tokens = tokenize('主人对花生过敏 peanut');
  assert.ok(tokens.includes('花生'));
  assert.ok(tokens.includes('过敏'));
  assert.ok(tokens.includes('peanut'));
});

test('写入去重：完全重复与近似重复都不重复入库', () => {
  const { store, dir } = tempStore();
  try {
    const first = store.add({ kind: 'fact', text: '主人对花生过敏' });
    assert.equal(first.added, true);
    const dup = store.add({ kind: 'fact', text: ' 主人对花生过敏。 ' });
    assert.equal(dup.added, false);
    assert.equal(dup.duplicateOf, first.id);
    assert.equal(store.stats().records, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('检索按相关性返回，笔记与最近列表分开', () => {
  const { store, dir } = tempStore();
  try {
    store.add({ kind: 'fact', text: '主人对花生过敏，点菜要注意' });
    store.add({ kind: 'episode', text: '今天一起看了《海上钢琴师》' });
    store.add({ kind: 'rule', text: '不要在凌晨主动找人' });
    store.appendEvent({ text: '爸爸说周末想去爬山', scope: 'qq:1', ts: new Date().toISOString() });

    const hits = store.search('花生', { limit: 3 });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].kind, 'fact');
    assert.match(hits[0].text, /花生/);

    const eventHits = store.search('爬山', { limit: 3 });
    assert.ok(eventHits.some((hit) => hit.kind === 'episode' && /爬山/.test(hit.text)));

    assert.equal(store.rules(5).length, 1);
    assert.ok(store.recent(3).every((record) => record.kind !== 'rule'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('导出/导入 roundtrip 且重复导入幂等', () => {
  const { store, dir } = tempStore();
  const { store: target, dir: targetDir } = tempStore();
  try {
    store.add({ kind: 'rule', text: '重要笔记一' });
    store.add({ kind: 'fact', text: '事实一', scope: 'qq:9' });
    const bundle = store.exportBundle({ system: 'test' }, { includeRules: true });
    assert.equal(bundle.schema, 'companion-memory/2');

    const first = target.importBundle(bundle);
    assert.deepEqual(first, { added: 2, duplicates: 0, invalid: 0 });
    const second = target.importBundle(bundle);
    assert.deepEqual(second, { added: 0, duplicates: 2, invalid: 0 });
    assert.equal(target.stats().records, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('裁剪过期原始事件，记录不受影响', () => {
  const { store, dir } = tempStore();
  try {
    store.appendEvent({ text: '很久以前的事', ts: '2020-01-01T00:00:00.000Z' });
    store.appendEvent({ text: '刚刚的事', ts: new Date().toISOString() });
    store.add({ kind: 'fact', text: '一条记录' });
    const removed = store.prune(30);
    assert.equal(removed, 1);
    assert.equal(store.stats().events, 1);
    assert.equal(store.stats().records, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('持久化：重开实例还能读到', () => {
  const { store, dir } = tempStore();
  try {
    store.add({ kind: 'thread', text: '答应周末陪他爬山' });
    const again = new MemoryStore(dir);
    assert.equal(again.stats().records, 1);
    assert.equal(again.search('爬山', { limit: 2 })[0].kind, 'thread');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
