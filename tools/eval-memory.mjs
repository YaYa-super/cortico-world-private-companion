/**
 * 记忆检索评测：recall@3 / 纯度 / p95 延迟。
 * 只读，不改任何数据。
 *
 * 用法：
 *   node tools/eval-memory.mjs [--data "D:/Coopanion/data/home/companion/data"]
 *   node tools/eval-memory.mjs --questions eval/questions.json --json
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryStore } from '../src/memory-store.ts';

const args = process.argv.slice(2);
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const DATA = valueOf('--data') || 'D:/Coopanion/data/home/companion/data';
const QUESTIONS = valueOf('--questions') || 'eval/questions.json';
const MEM = join(DATA, 'private-companion', 'memory');
const NOISE = /\[(调用|回执|工具)\]|^\[(notice|request|meta_event)\/|已折叠|做了:(end_turn|onebot_call)/;

// 只读评测：把数据复制到临时目录，避免损坏恢复/锁/LRU 之类情况写回线上。
const SANDBOX = mkdtempSync(join(tmpdir(), 'companion-eval-'));
for (const name of ['records.json', 'records.json.bak', 'events.jsonl']) {
  const from = join(MEM, name);
  if (existsSync(from)) copyFileSync(from, join(SANDBOX, name));
}
const store = new MemoryStore(SANDBOX);
const questions = JSON.parse(readFileSync(QUESTIONS, 'utf8'));

const person = store.people()[0];
const details = person?.details ?? {};
const names = [...new Set([...(details.aliases ?? []), ...(details.nameHistory ?? [])])];
const personLine = person ? person.text : '';
const alwaysOn = [store.rules(20).map((record) => record.text).join('\n'), personLine].join('\n');
const corpus = [
  ...store.entries().map((record) => record.text),
  ...store.rules(20).map((record) => record.text),
  person?.text ?? '',
].join('\n').toLowerCase();

const rows = [];
const latencies = [];
let hits = 0;
let pure = 0;

for (const item of questions) {
  const t0 = performance.now();
  const results = store.search(item.q, { limit: 3 });
  const ms = performance.now() - t0;
  latencies.push(ms);

  const topText = results.map((hit) => hit.text).join('\n');
  const haystack = `${topText}
${alwaysOn}`.toLowerCase();
  const hit = item.expect.some((word) => haystack.includes(String(word).toLowerCase()));
  const answerable = item.expect.some((word) => corpus.includes(String(word).toLowerCase()));
  const clean = results.every((hit) => !NOISE.test(hit.text));
  if (hit) hits += 1;
  if (clean) pure += 1;
  rows.push({
    id: item.id,
    q: item.q,
    hit,
    answerable,
    clean,
    ms: Math.round(ms * 10) / 10,
    top: results.map((hit) => `${hit.kind}:${hit.text.slice(0, 50)}`),
  });
}

latencies.sort((a, b) => a - b);
const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];

const answerableRows = rows.filter((row) => row.answerable);
const answerableHits = answerableRows.filter((row) => row.hit).length;
const summary = {
  questions: questions.length,
  answerable: answerableRows.length,
  missingData: rows.filter((row) => !row.answerable).map((row) => `${row.id} ${row.q}`),
  recallAt3: hits,
  recallAt3Rate: `${Math.round((hits / questions.length) * 100)}%`,
  recallOnAnswerable: `${answerableHits}/${answerableRows.length} = ${Math.round((answerableHits / Math.max(1, answerableRows.length)) * 100)}%`,
  purity: `${Math.round((pure / questions.length) * 100)}%`,
  p95Ms: Math.round(p95 * 10) / 10,
  avgMs: Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10,
  store: store.stats(),
};

if (args.includes('--json')) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n未命中：');
  for (const row of rows.filter((item) => !item.hit)) {
    console.log(`- ${row.id} ${row.q}  →  ${row.top.join(' | ') || '（空）'}`);
  }
  console.log('\n不纯（top3 含噪声）：');
  for (const row of rows.filter((item) => !item.clean)) {
    console.log(`- ${row.id} ${row.q}`);
  }
}
