/**
 * 整理 2026-10-29 21:48 误触发的 5 条 consolidate 记录：
 * - 全部归档到 memory/archive/consolidate-*.jsonl；
 * - 删掉重复的 person 记录（它让 people()[0] 指向了错误对象）；
 * - 其余 4 条经人工复核后以 manual:review 重新入库（内容有效，只是触发时机错了）；
 * - 顺便补一条直播间房间号事实。
 *
 * 只应在 Coopanion 停止时运行。
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryStore } from '../src/memory-store.ts';

const DATA = process.argv.includes('--data')
  ? process.argv[process.argv.indexOf('--data') + 1]
  : 'D:/Coopanion/data/home/companion/data';
const MEM = join(DATA, 'private-companion', 'memory');
const store = new MemoryStore(MEM, undefined, { lock: true });

const targets = store.entries().filter((record) => record.source === 'consolidate');
if (!targets.length) {
  console.log('没有需要整理的 consolidate 记录。');
  process.exit(0);
}

const dir = join(MEM, 'archive');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const archive = join(dir, `consolidate-${stamp}.jsonl`);
appendFileSync(archive, `${targets.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

const removed = store.removeIds(targets.map((record) => record.id));
const keep = targets.filter((record) => record.kind !== 'person');
let added = 0;
for (const record of keep) {
  const result = store.add({
    kind: record.kind,
    text: record.text,
    scope: record.scope,
    ts: record.ts,
    details: record.details,
    importance: record.importance,
    confidence: record.confidence,
    source: 'manual:review',
    tags: [...record.tags.filter((tag) => tag !== 'consolidate'), 'reviewed'],
  });
  if (result.added) added += 1;
}

const roomFact = '直播间房间号是 1881085676（B 站），标题是「大肥鱼玩文明六（测试）」。';
const room = store.add({
  kind: 'fact',
  text: roomFact,
  scope: 'main',
  importance: 0.7,
  source: 'manual:review',
  tags: ['bilibili', 'room'],
});

console.log(JSON.stringify({
  archived: archive,
  removed,
  reAdded: added,
  droppedPerson: true,
  roomFact: room.added,
  stats: store.stats(),
}, null, 2));
