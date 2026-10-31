/**
 * 把 cortico-world-memory(-extra) 的现有数据导进内置记忆库。
 *
 * 只读旧文件，写到 <data>/private-companion/memory/records.json；可重复跑（内容 hash 去重）。
 * 用法：
 *   node tools/import-memory-extra.mjs [--data "D:/Coopanion/data/home/companion/data"] [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryStore } from '../src/memory-store.ts';

const args = process.argv.slice(2);
const dataArg = args.includes('--data') ? args[args.indexOf('--data') + 1] : null;
const dry = args.includes('--dry');
const DATA = dataArg || 'D:/Coopanion/data/home/companion/data';

const NOISE = /^\[(request|notice|meta_event)\//;
const SKIP_SCOPES = /^(terrarium|bilibili|console|civ6-assistant|onebot)|announcement/i;
const TELEMETRY_SCOPES = new Set([
  'desktop-pet.self', 'desktop-pet.touch', 'desktop-pet.answer', '0',
]);

function readJson(name) {
  const file = join(DATA, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function msOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString();
}

const records = [];

const memoryData = readJson('memory-data.json');
for (const [scope, list] of Object.entries(memoryData?.notes ?? {})) {
  for (const item of list ?? []) {
    const text = String(item?.text ?? '').trim();
    if (text) records.push({ kind: 'note', text, scope, ts: msOf(item.ts), importance: 0.9, source: 'import:memory-extra' });
  }
}

const facts = readJson('fact-store.json');
for (const [scope, list] of Object.entries(facts?.scopes ?? {})) {
  if (SKIP_SCOPES.test(scope) || TELEMETRY_SCOPES.has(scope)) continue;
  for (const item of list ?? []) {
    const text = String(item?.text ?? '').trim();
    if (!text || NOISE.test(text)) continue;
    const kind = scope === 'persona' ? 'episode' : 'episode';
    records.push({
      kind,
      text,
      scope: scope === 'persona' ? 'main' : scope,
      ts: msOf(item.updatedAt ?? item.createdAt),
      importance: scope === 'persona' ? 0.6 : 0.45,
      source: 'import:memory-extra',
      tags: scope === 'persona' ? ['handoff'] : undefined,
    });
  }
}

const profiles = readJson('user-profiles.json');
for (const [scope, profile] of Object.entries(profiles?.profiles ?? {})) {
  for (const fact of profile?.facts ?? []) {
    const text = String(fact ?? '').trim();
    if (text) records.push({ kind: 'profile', text, scope, ts: msOf(profile.updated), importance: 0.7, source: 'import:memory-extra' });
  }
}

const knowledge = readJson('knowledge-base.json');
for (const entry of knowledge?.entries ?? []) {
  const topic = String(entry?.topic ?? '').trim();
  for (const fact of entry?.facts ?? []) {
    const text = String(fact ?? '').trim();
    if (text) records.push({ kind: 'fact', text, scope: 'main', ts: new Date().toISOString(), importance: 0.65, source: 'import:memory-extra', tags: topic ? [topic] : undefined });
  }
}

const reflection = readJson('reflection-data.json');
for (const item of [...(reflection?.reflections ?? []), ...(reflection?.interactionRules ?? [])]) {
  const text = String(item?.content ?? item?.rule ?? '').trim();
  if (text) records.push({ kind: 'reflection', text, scope: 'main', ts: new Date().toISOString(), importance: 0.75, source: 'import:memory-extra' });
}

const store = new MemoryStore(join(DATA, 'private-companion', 'memory'), undefined, { lock: !dry });
if (store.error) {
  console.error(store.error);
  process.exit(1);
}
const bundle = { schema: 'companion-memory/1', exportedAt: new Date().toISOString(), source: { system: 'memory-extra' }, records };
const result = dry ? { dry: records.length, existing: store.stats().records } : store.importBundle(bundle, { source: 'import:memory-extra' });
console.log(JSON.stringify({ scanned: records.length, result, stats: store.stats() }, null, 2));
