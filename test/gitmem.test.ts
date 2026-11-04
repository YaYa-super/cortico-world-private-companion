import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildGitmemProjection, searchGitmem, writeGitmemProjection } from '../src/gitmem.ts';
import type { MemoryRecord } from '../src/memory-store.ts';

function record(kind: MemoryRecord['kind'], text: string, ts = '2026-11-04T10:00:00+08:00'): MemoryRecord {
  return {
    id: `${kind}-${text}`,
    kind,
    text,
    scope: 'main',
    ts,
    createdAt: ts,
    confidence: 0.8,
    importance: 0.6,
    source: 'test',
    tags: [],
    trust: 'owner',
    reviewStatus: 'approved',
    useCount: 0,
    archived: false,
  };
}

test('GitMem 投影包含 self/thread，且不包含归档记录', () => {
  const archived = { ...record('episode', '旧事'), archived: true };
  const projection = buildGitmemProjection([
    record('self', '我越来越直接'),
    record('thread', '视频插件还没做完'),
    archived,
  ]);
  assert.match(projection.files['SELF.md'], /我越来越直接/);
  assert.match(projection.files['THREADS.md'], /视频插件/);
  assert.doesNotMatch(JSON.stringify(projection.files), /旧事/);
});

test('GitMem 投影写入只读目录，读穿能查到 notes 且跳过 companion', () => {
  const root = mkdtempSync(join(tmpdir(), 'companion-gitmem-'));
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, 'notes', 'a.md'), '今天看了视频插件\n还有别的事\n', 'utf8');
  writeFileSync(join(root, 'generated-copy.md'), '视频插件 companion generated\n', 'utf8');
  const projection = buildGitmemProjection([record('thread', '视频插件还没做完')]);
  writeGitmemProjection(root, 'companion', projection);
  assert.match(readFileSync(join(root, 'companion', 'THREADS.md'), 'utf8'), /视频插件/);
  const hits = searchGitmem(root, '视频插件', 5);
  assert.equal(hits.some((hit) => hit.path.includes('notes')), true);
  assert.equal(hits.some((hit) => hit.path.startsWith('companion')), false);
});
