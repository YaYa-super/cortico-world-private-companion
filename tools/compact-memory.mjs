/**
 * 记忆清淤（一次性）：
 * 1. 把 `# 交接笔记` 这类超长会话转录压成 ≤300 字摘要，原文归档到 memory/archive/；
 * 2. 原始事件层只保留人话，去掉遥测、通知、系统提示与重复项。
 *
 * 只应在 Coopanion 停止时运行（运行中的进程持有内存副本，会覆盖结果）。
 * 用法：node tools/compact-memory.mjs [--data "D:/Coopanion/data/home/companion/data"] [--dry]
 */
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { MemoryStore } from '../src/memory-store.ts';

const args = process.argv.slice(2);
const dataArg = args.includes('--data') ? args[args.indexOf('--data') + 1] : null;
const dry = args.includes('--dry');
const DATA = dataArg || 'D:/Coopanion/data/home/companion/data';
const MEM = join(DATA, 'private-companion', 'memory');

if (!existsSync(join(MEM, 'records.json'))) {
  console.error('没有找到 records.json，先确认 --data 路径。');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const archiveDir = join(MEM, 'archive');
mkdirSync(archiveDir, { recursive: true });
if (!dry) {
  copyFileSync(join(MEM, 'records.json'), join(archiveDir, `records-before-compact-${stamp}.json`));
  if (existsSync(join(MEM, 'events.jsonl'))) {
    copyFileSync(join(MEM, 'events.jsonl'), join(archiveDir, `events-before-compact-${stamp}.jsonl`));
  }
}

const store = new MemoryStore(MEM, undefined, { lock: !dry });
if (store.error) {
  console.error(store.error);
  process.exit(1);
}
const before = store.stats();

const NOISE_LINE = /^\[?(调用|回执|工具|system)\]?|已折叠|#\d{6,}|^\[?(notice|request|meta_event)\//;
const HEADER = /^#?\s*交接笔记[^ ]*\s*/;

function summarize(text, ts, offset = 0) {
  const body = String(text)
    .replace(/^#+\s*交接笔记\s*/, '')
    .replace(/·\s*(更早|最近)的一段\([^)]*\)\s*/, '')
    .replace(/这一段(?:已经过去了|紧接着现在)[^。]*。/g, ' ')
    .replace(/里面是[^。]*。|同一项状态读数[^。]*。/g, ' ')
    .replace(/#{1,3}\s*\d{1,2}:\d{2}/g, ' ')
    .replace(/\[[^\]]{0,60}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = String(text).replace(/\s+/g, ' ').trim();
  const source = body.length >= 20 ? body : fallback;
  const picked = source.slice(offset, offset + 240);
  const day = String(ts).slice(0, 10);
  const lead = offset > 0 ? '…' : '';
  return `${day} 交接摘要：${lead}${picked}${source.length > offset + 240 ? '…' : ''}`;
}

const handoff = store.entries().filter((record) => record.text.startsWith('# 交接笔记'));
const compacted = [];
const archiveLines = [];
const seenSummaries = new Set();
for (const record of handoff) {
  archiveLines.push(JSON.stringify({ archivedAt: new Date().toISOString(), reason: 'handoff', original: record }));
  let summary = '';
  for (const offset of [0, 240, 480, 720, 960, 1200]) {
    const candidate = summarize(record.text, record.ts, offset);
    if (!seenSummaries.has(candidate)) {
      summary = candidate;
      break;
    }
  }
  if (!summary) continue;
  seenSummaries.add(summary);
  compacted.push({
    kind: 'episode',
    text: summary,
    scope: 'main',
    ts: record.ts,
    importance: 0.4,
    source: 'compact:handoff',
    tags: ['handoff-summary'],
    confidence: 0.7,
  });
}

// 原始事件：只留人话，按 scope+text 去重。
let eventsKept = 0;
let eventsDropped = 0;
if (existsSync(join(MEM, 'events.jsonl'))) {
  const seen = new Set();
  const kept = [];
  for (const line of readFileSync(join(MEM, 'events.jsonl'), 'utf8').split('\n')) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      eventsDropped += 1;
      continue;
    }
    const text = String(event.text ?? '').trim();
    const scope = String(event.scope ?? '');
    const human = text && !text.startsWith('[system]') && !text.startsWith('[系统]')
      && !/^\[(notice|request|meta_event)\//.test(text)
      && !/\.(self|touch|answer)$/.test(scope)
      && !/^(persona|console|civ6-assistant|terrarium|bilibili)$/.test(String(event.source ?? ''));
    const key = `${scope}\u0000${text}`;
    if (!human || seen.has(key)) {
      eventsDropped += 1;
      continue;
    }
    seen.add(key);
    kept.push(event);
    eventsKept += 1;
  }
  if (!dry) {
    writeFileSync(join(MEM, 'events.jsonl'), kept.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf8');
  }
}

let removed = 0;
let added = 0;
if (!dry) {
  removed = store.removeIds(handoff.map((record) => record.id));
  const result = store.addMany(compacted, { nearDup: false });
  added = result.added;
  if (archiveLines.length) {
    appendFileSync(join(archiveDir, `handoff-${stamp}.jsonl`), `${archiveLines.join('\n')}\n`, 'utf8');
  }
}

console.log(JSON.stringify({
  dry,
  before: { records: before.records, events: before.events },
  handoff: handoff.length,
  compacted: compacted.length,
  removed,
  added,
  events: { kept: eventsKept, dropped: eventsDropped },
  after: dry ? null : store.stats(),
  archive: join(archiveDir, `handoff-${stamp}.jsonl`),
}, null, 2));
