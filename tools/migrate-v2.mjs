/**
 * v1 → v2 迁移（dry-run / 快照 / 回滚 / 幂等）。
 *
 * 默认只产出 `memory/migration/records.v2.json`，**不覆盖**线上 records.json；
 * 等 v2 存储上线后，再用 `--in-place` 正式切换。
 *
 * 用法：
 *   node tools/migrate-v2.mjs --dry
 *   node tools/migrate-v2.mjs                 # 产出 v2 文件 + 快照 + 报告
 *   node tools/migrate-v2.mjs --in-place      # 覆盖 records.json（先快照）
 *   node tools/migrate-v2.mjs --rollback      # 恢复最近一次快照
 *   node tools/migrate-v2.mjs --rollback <snapshot.json>
 *   node tools/migrate-v2.mjs --dry --force   # 忽略“已迁移过”的幂等判断
 *   --data "D:/Coopanion/data/home/companion/data"
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { MAPPING_VERSION, V2_SCHEMA, checkCompleteness, migrateV1ToV2 } from '../src/migration-v2.ts';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => (has(flag) ? args[args.indexOf(flag) + 1] : null);

const DATA = valueOf('--data') || 'D:/Coopanion/data/home/companion/data';
const MEM = join(DATA, 'private-companion', 'memory');
const MIG = join(MEM, 'migration');
const SNAPS = join(MIG, 'snapshots');
const RECORDS = join(MEM, 'records.json');
const MANIFEST = join(MIG, 'v1-to-v2.json');

const V2_KINDS = new Set(['episode', 'fact', 'person', 'thread', 'self', 'rule']);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function latestSnapshot() {
  if (!existsSync(SNAPS)) return null;
  const files = readdirSync(SNAPS).filter((name) => name.startsWith('records-v1-') && name.endsWith('.json'))
    .sort();
  return files.length ? join(SNAPS, files[files.length - 1]) : null;
}

if (has('--rollback')) {
  const target = valueOf('--rollback') && !valueOf('--rollback').startsWith('--')
    ? valueOf('--rollback')
    : latestSnapshot();
  if (!target || !existsSync(target)) {
    console.error('没有可用的快照。');
    process.exit(1);
  }
  copyFileSync(target, RECORDS);
  if (existsSync(MANIFEST)) {
    const manifest = readJson(MANIFEST);
    manifest.rolledBackAt = new Date().toISOString();
    manifest.rolledBackFrom = target;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  }
  console.log(JSON.stringify({ ok: true, restoredFrom: target, to: RECORDS }, null, 2));
  process.exit(0);
}

if (!existsSync(RECORDS)) {
  console.error(`没有找到 ${RECORDS}`);
  process.exit(1);
}

const raw = readFileSync(RECORDS, 'utf8');
const sourceHash = sha256(raw);
const parsed = JSON.parse(raw);
const input = Array.isArray(parsed?.records) ? parsed.records : [];
const looksV2 = parsed?.schema === V2_SCHEMA
  && input.length > 0 && input.every((record) => V2_KINDS.has(String(record.kind)));

const manifest = existsSync(MANIFEST) ? readJson(MANIFEST) : null;
const alreadyMigrated = manifest
  && manifest.mappingVersion === MAPPING_VERSION
  && manifest.sourceHash === sourceHash
  && !manifest.rolledBackAt;

if (looksV2 && !has('--force')) {
  console.log(JSON.stringify({ ok: true, skipped: 'records.json 已经是 v2', sourceHash }, null, 2));
  process.exit(0);
}
if (alreadyMigrated && !has('--force')) {
  console.log(JSON.stringify({
    ok: true,
    skipped: '同一份 v1 已经迁移过（幂等）',
    mappingVersion: MAPPING_VERSION,
    sourceHash,
    output: manifest.output,
  }, null, 2));
  process.exit(0);
}

const result = migrateV1ToV2(input);
const problems = checkCompleteness(input, result);
const ids = new Set();
const duplicateIds = [];
for (const record of result.records) {
  if (ids.has(record.id)) duplicateIds.push(record.id);
  ids.add(record.id);
}

const summary = {
  dry: has('--dry'),
  inPlace: has('--in-place'),
  sourceHash,
  mappingVersion: MAPPING_VERSION,
  report: result.report,
  completeness: problems.length ? problems : 'ok',
  duplicateIds,
  outputBytes: JSON.stringify({ schema: result.schema, records: result.records }).length,
};

if (problems.length && !has('--allow-loss')) {
  console.error(JSON.stringify({ ...summary, error: '完整性校验失败，未写入。' }, null, 2));
  process.exit(2);
}

if (has('--dry')) {
  console.log(JSON.stringify({
    ...summary,
    sample: {
      rule: result.records.find((record) => record.kind === 'rule'),
      person: result.records.find((record) => record.kind === 'person'),
      recap: result.records.find((record) => record.kind === 'episode' && record.tags.includes('recap')),
    },
  }, null, 2));
  process.exit(0);
}

mkdirSync(SNAPS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const snapshot = join(SNAPS, `records-v1-${stamp}.json`);
copyFileSync(RECORDS, snapshot);

const outFile = join(MIG, 'records.v2.json');
writeFileSync(outFile, JSON.stringify({ schema: V2_SCHEMA, records: result.records }, null, 1), 'utf8');

const outputHash = sha256(readFileSync(outFile));
writeFileSync(MANIFEST, JSON.stringify({
  mappingVersion: MAPPING_VERSION,
  sourceHash,
  outputHash,
  migratedAt: new Date().toISOString(),
  snapshot,
  output: { file: outFile, records: result.records.length, byKind: result.report.output.byKind },
}, null, 2), 'utf8');

let inPlace = false;
if (has('--in-place')) {
  copyFileSync(outFile, RECORDS);
  inPlace = true;
}

console.log(JSON.stringify({
  ok: true,
  inPlace,
  snapshot,
  output: outFile,
  manifest: MANIFEST,
  report: result.report,
  completeness: problems.length ? problems : 'ok',
}, null, 2));
