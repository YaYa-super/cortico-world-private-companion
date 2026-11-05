/**
 * 内置记忆库：原始事件 + 派生记录 + BM25 检索 + 导入导出。
 *
 * 写盘安全是这份实现的第一优先级：
 * - 每次保存先写 tmp + fsync，再把旧文件改名为 .bak，最后 rename 成正式文件；
 * - load 时正式文件坏了会回退 .bak，两者都坏则另存 .corrupt-* 并进入只读保护（loadError），
 *   拒绝写入，避免“读失败当空库、下一次写入覆盖全库”。
 *
 * 捕获幂等：原始事件带 cursor，append 拒绝 cursor <= maxCursor；批量写入只落一次盘。
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { formatLocal } from './time.ts';

export const MEMORY_SCHEMA = 'companion-memory/2';
/** 兼容 0.3.x 导出的旧 bundle；读取时按现有 kind 映射。 */
export const LEGACY_MEMORY_SCHEMAS = new Set(['companion-memory/1', 'companion-memory/2']);

export type MemoryKind = 'episode' | 'fact' | 'person' | 'thread' | 'self' | 'rule';

export const MEMORY_KINDS: MemoryKind[] = ['episode', 'fact', 'person', 'thread', 'self', 'rule'];

export interface MemoryDetails {
  participants?: string[];
  valence?: number;
  intensity?: number;
  howIFelt?: string;
  threadId?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  validFrom?: string;
  validTo?: string;
  sourceQuote?: string;
  personId?: string;
  aliases?: string[];
  relationLabel?: string;
  closeness?: number;
  preferences?: string[];
  boundaries?: string[];
  nameHistory?: string[];
  status?: 'open' | 'done' | 'dropped';
  what?: string;
  counterpart?: string;
  due?: string;
  lastTouchedAt?: string;
  evidence?: string[];
  topic?: string;
  belief?: string;
  evidenceRefs?: string[];
  since?: string;
  pinned?: boolean;
  /** 用户当时的情绪（区别于 coo 自己的 howIFelt）。 */
  userEmotion?: { label?: string; cause?: string; intensity?: number };
  /** 合并式遗忘：来源记录 id / 合并进的新记录 id / 合并条数。 */
  mergedFrom?: string[];
  mergedInto?: string;
  mergedCount?: number;
  merged?: boolean;
}

export interface MemoryVersion {
  version: number;
  text: string;
  status?: 'open' | 'done' | 'dropped';
  observedAt: string;
  validFrom?: string;
  validTo?: string;
  reason?: string;
  sourceEventIds?: string[];
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  scope: string;
  ts: string;
  createdAt: string;
  confidence: number;
  importance: number;
  source: string;
  tags: string[];
  /** 记忆归属：本机写的是 owner，导入的是 external。 */
  trust: 'owner' | 'trusted' | 'external' | 'untrusted';
  /** 导入的记录先 pending，人工批准后 approved。 */
  reviewStatus: 'approved' | 'pending' | 'rejected';
  useCount: number;
  archived: boolean;
  lastUsedAt?: string;
  importedAt?: string;
  bundleId?: string;
  details?: MemoryDetails;
  provenance?: Record<string, unknown>;
  /** 同一件事实/话头的稳定主语；用于版本归并，不要求所有记录都有。 */
  subjectKey?: string;
  /** 当前版本号；缺省视为 1。 */
  version?: number;
  /** 历史版本；当前正文仍是 record.text，不把历史注入上下文。 */
  versions?: MemoryVersion[];
  updatedAt?: string;
}

export interface RawEvent {
  id: string;
  /** 宿主事件库的游标，用于幂等。 */
  cursor?: number;
  ts: string;
  scope: string;
  source: string;
  text: string;
}

export interface MemoryHit {
  id?: string;
  kind: MemoryKind;
  text: string;
  /** 命中位置前后各 60 字的摘录，长文本不再只给开头。 */
  snippet: string;
  ts: string;
  scope: string;
  score: number;
  source: string;
}

export interface MemoryBundle {
  schema: string;
  exportedAt: string;
  source: { system: string; version?: string };
  records: MemoryRecord[];
}

export interface AddResult {
  added: boolean;
  id: string;
  duplicateOf?: string;
  /** 同 subjectKey 的已有记录被更新，而不是新增。 */
  updated?: boolean;
}

export interface ImportResult {
  added: number;
  duplicates: number;
  invalid: number;
  error?: string;
}

const K1 = 1.2;
const B = 0.75;
const RECENCY_DAYS = 60;
const NEAR_DUP = 0.86;
const MAX_TEXT = 6000;
const MAX_SCOPE = 64;
const MAX_TAGS = 8;
const MAX_TAG = 32;
const MAX_IMPORT_RECORDS = 5000;
/** 合并每轮最多看这么多候选，避免 1k+ 条时同步扫描阻塞 tick。 */
const MAX_MERGE_CANDIDATES = 400;

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hashText(kind: string, scope: string, text: string): string {
  return createHash('sha256')
    .update(`${kind}\u0000${scopeKey(scope)}\u0000${normalize(text).toLowerCase()}`)
    .digest('hex');
}

/** 拉丁词 + CJK 2-gram（单字也保留，短查询才有得匹配）。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const word of lower.match(/[a-z0-9_]{2,}/g) ?? []) out.push(word);
  for (const run of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
  }
  return out;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

function clamp01(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function isoOr(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return fallback;
  // 未来超过 1 天的记录会把 notes/recent 顶到最前，直接夹到当前时间。
  return new Date(Math.min(t, Date.now() + 86_400_000)).toISOString();
}

/** 可选时间字段：非法/未来过远的直接丢弃，避免污染冷却与复习。 */
function optionalIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(Math.min(t, Date.now() + 86_400_000)).toISOString() : undefined;
}

function clampRange(n: unknown, lo: number, hi: number): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
}

function cleanScope(value: unknown): string {
  const raw = typeof value === 'string' ? normalize(value) : '';
  const trimmed = raw.slice(0, MAX_SCOPE);
  return /^[a-z0-9][a-z0-9._:-]*$/i.test(trimmed) ? trimmed : 'main';
}

/** 比较/合并 scope 用的键：`qq:123` 与裸 `123` 视为同一个人。 */
export function scopeKey(value: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.startsWith('qq:') ? s.slice(3) : s;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value.slice(0, MAX_TAGS * 4)) {
    if (typeof item !== 'string') continue;
    const tag = normalize(item).slice(0, MAX_TAG);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const PROV_KEYS = new Set(['system', 'conversation', 'messageId', 'externalId', 'legacyId', 'legacyIds', 'legacyCount']);

function cleanProvenance(value: unknown): MemoryRecord['provenance'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!PROV_KEYS.has(key)) continue;
    if (typeof raw === 'string') out[key] = normalize(raw).slice(0, 200);
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (Array.isArray(raw)) {
      const list = raw.filter((item) => typeof item === 'string')
        .map((item) => normalize(item as string).slice(0, 120)).slice(0, 200);
      if (list.length) out[key] = list;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function mapKind(kind: string): MemoryKind | null {
  if ((MEMORY_KINDS as string[]).includes(kind)) return kind as MemoryKind;
  if (kind === 'note') return 'rule';
  if (kind === 'profile' || kind === 'relationship') return 'person';
  if (kind === 'reflection') return 'self';
  if (kind === 'commitment') return 'thread';
  return null;
}

function strArray(value: unknown, max = 8, len = 80): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((x) => typeof x === 'string')
    .map((x) => normalize(x as string).slice(0, len)).filter(Boolean).slice(0, max);
  return out.length ? out : undefined;
}
function shortStr(value: unknown, len = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = normalize(value).slice(0, len);
  return text || undefined;
}
function numOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function cleanVersions(raw: unknown): MemoryVersion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MemoryVersion[] = [];
  for (const item of raw.slice(-20)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    const text = shortStr(d.text, 6000);
    const version = Math.max(1, Math.floor(Number(d.version) || 1));
    const observedAt = shortStr(d.observedAt, 40) ?? shortStr(d.ts, 40);
    if (!text || !observedAt) continue;
    out.push({
      version,
      text,
      ...(d.status === 'open' || d.status === 'done' || d.status === 'dropped' ? { status: d.status } : {}),
      observedAt,
      ...(shortStr(d.validFrom, 40) ? { validFrom: shortStr(d.validFrom, 40) } : {}),
      ...(shortStr(d.validTo, 40) ? { validTo: shortStr(d.validTo, 40) } : {}),
      ...(shortStr(d.reason, 120) ? { reason: shortStr(d.reason, 120) } : {}),
      ...(strArray(d.sourceEventIds, 20, 64) ? { sourceEventIds: strArray(d.sourceEventIds, 20, 64) } : {}),
    });
  }
  return out.length ? out : undefined;
}
const EMOTION_ALIASES: Record<string, string> = {
  累: '疲惫', 累死: '疲惫', 疲劳: '疲惫', 疲惫: '疲惫', 困: '疲惫',
  烦: '烦躁', 烦躁: '烦躁', 生气: '烦躁', 高兴: '开心', 开心: '开心',
  伤心: '难过', 难过: '难过', 紧张: '焦虑', 焦虑: '焦虑',
  寂寞: '孤独', 孤独: '孤独',
};

function canonicalEmotion(label: unknown): string | undefined {
  const raw = typeof label === 'string' ? label.trim() : '';
  if (!raw) return undefined;
  return EMOTION_ALIASES[raw] ?? raw.slice(0, 20);
}

function cleanUserEmotion(raw: unknown): MemoryDetails['userEmotion'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const d = raw as Record<string, unknown>;
  const out: { label?: string; cause?: string; intensity?: number } = {};
  const label = canonicalEmotion(d.label);
  const cause = shortStr(d.cause, 120);
  if (label) out.label = label;
  if (cause) out.cause = cause;
  const intensity = numOr(d.intensity);
  if (intensity !== undefined) out.intensity = clamp01(intensity, 0.5);
  return Object.keys(out).length ? out : undefined;
}

function cleanDetails(kind: MemoryKind, raw: unknown): MemoryDetails | undefined {
  if (kind === 'rule') return { pinned: true };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const d = raw as Record<string, unknown>;
  const out: MemoryDetails = {};
  const put = (key: keyof MemoryDetails, value: unknown) => {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  };
  if (kind === 'episode') {
    put('participants', strArray(d.participants, 8, 40));
    put('valence', clampRange(d.valence, -1, 1));
    put('intensity', clampRange(d.intensity, 0, 1));
    put('howIFelt', shortStr(d.howIFelt));
    put('threadId', shortStr(d.threadId, 64));
    put('userEmotion', cleanUserEmotion(d.userEmotion));
    put('mergedFrom', strArray(d.mergedFrom, 12, 64));
    put('mergedInto', shortStr(d.mergedInto, 64));
    put('mergedCount', numOr(d.mergedCount));
    put('merged', d.merged === true ? true : undefined);
  } else if (kind === 'fact') {
    put('subject', shortStr(d.subject, 60));
    put('predicate', shortStr(d.predicate, 60));
    put('object', shortStr(d.object, 120));
    put('validFrom', shortStr(d.validFrom, 40));
    put('validTo', shortStr(d.validTo, 40));
    put('sourceQuote', shortStr(d.sourceQuote, 200));
  } else if (kind === 'person') {
    put('personId', shortStr(d.personId, 64));
    put('aliases', strArray(d.aliases, 8, 40));
    put('relationLabel', shortStr(d.relationLabel, 40));
    put('closeness', numOr(d.closeness));
    put('preferences', strArray(d.preferences, 12, 200));
    put('boundaries', strArray(d.boundaries, 12, 200));
    put('nameHistory', strArray(d.nameHistory, 8, 40));
  } else if (kind === 'thread') {
    put('status', d.status === 'done' || d.status === 'dropped' ? d.status : 'open');
    put('what', shortStr(d.what, 160));
    put('counterpart', shortStr(d.counterpart, 60));
    put('due', shortStr(d.due, 40));
    put('lastTouchedAt', shortStr(d.lastTouchedAt, 40));
    put('evidence', strArray(d.evidence, 6, 120));
  } else if (kind === 'self') {
    put('topic', shortStr(d.topic, 60));
    put('belief', shortStr(d.belief, 200));
    put('evidenceRefs', strArray(d.evidenceRefs, 8, 64));
    put('since', shortStr(d.since, 40));
  } else if (kind === 'rule') {
    out.pinned = true;
  }
  return Object.keys(out).length ? out : undefined;
}

export class MemoryStore {
  private readonly dir: string;
  private readonly log: (message: string) => void;
  private records: MemoryRecord[] = [];
  private events: RawEvent[] = [];
  private revision = 0;
  private lastCursor = 0;
  private lastPruneDay = '';
  private readonly tokenCache = new Map<string, string[]>();
  private byHash = new Map<string, string>();
  /** 正式文件损坏且没有可回退备份时的说明；非空期间拒绝写入。 */
  private loadError: string | null = null;
  private lockHeld = false;

  constructor(dir: string, log?: (message: string) => void, opts: { lock?: boolean } = {}) {
    this.dir = dir;
    this.log = log ?? (() => {});
    if (opts.lock) this.acquireLock();
    this.load();
  }

  /** 单实例写锁：World 持有；CLI 在 Coopanion 运行时会被拒绝，避免整文件 last-write-wins。 */
  private acquireLock(): void {
    const file = this.file('.lock');
    try {
      mkdirSync(this.dir, { recursive: true });
      const existing = (() => {
        try { return readFileSync(file, 'utf8').trim(); } catch { return ''; }
      })();
      if (existing && existing !== String(process.pid)) {
        let alive = true;
        try {
          process.kill(Number(existing), 0);
        } catch (error) {
          // ESRCH = 进程已不存在；EPERM 说明进程还活着（只是没权限发信号），不能抢锁。
          alive = (error as NodeJS.ErrnoException)?.code === 'EPERM';
        }
        if (alive) {
          this.loadError = `记忆库正被另一个进程使用（pid ${existing}），本次只读。请先退出 Coopanion 再跑维护脚本。`;
          return;
        }
        rmSync(file, { force: true });
      }
      if (existing === String(process.pid)) {
        // 同进程里已有实例持锁：复用它，但本实例不负责删除。
        this.lockHeld = false;
        return;
      }
      const fd = openSync(file, 'wx');
      try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
      this.lockHeld = true;
    } catch (error) {
      this.loadError = `记忆库加锁失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  close(): void {
    if (!this.lockHeld) return;
    this.lockHeld = false;
    try {
      const owner = readFileSync(this.file('.lock'), 'utf8').trim();
      if (owner !== String(process.pid)) return;
      rmSync(this.file('.lock'), { force: true });
    } catch {
      // 文件已不在或读不到：不阻塞退出
    }
  }

  private file(name: string): string {
    return join(this.dir, name);
  }

  get error(): string | null {
    return this.loadError;
  }

  private load(): void {
    this.loadRecords();
    this.loadEvents();
    try {
      const meta = JSON.parse(readFileSync(this.file('meta.json'), 'utf8')) as {
        lastCursor?: unknown; lastPruneDay?: unknown;
      };
      this.lastCursor = Number(meta?.lastCursor) || 0;
      this.lastPruneDay = String(meta?.lastPruneDay ?? '');
    } catch {
      this.lastCursor = 0;
      this.lastPruneDay = '';
    }
    this.rebuildHashIndex();
  }

  private loadRecords(): void {
    const main = this.file('records.json');
    const bak = this.file('records.json.bak');
    const parse = (file: string): MemoryRecord[] => {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { records?: unknown };
      if (!Array.isArray(raw?.records)) throw new Error('records 不是数组');
      const out: MemoryRecord[] = [];
      for (const item of raw.records) {
        const record = this.coerceRecord(item);
        if (record) out.push(record);
      }
      return out;
    };
    try {
      this.records = parse(main);
      return;
    } catch (error) {
      if (this.loadError) {
        this.records = [];
        return;
      }
      const missing = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
      if (missing && !existsSync(bak)) return;
      if (!missing) {
        const aside = this.file(`records.json.corrupt-${Date.now()}`);
        try {
          copyFileSync(main, aside);
          this.log(`[memory] records.json 读取失败，已另存 ${aside}`);
        } catch {
          // 复制失败也要继续尝试备份
        }
      }
      try {
        this.records = parse(bak);
        this.log('[memory] 已从 records.json.bak 恢复');
        // 先把损坏的正式文件挪走，避免 saveRecords 的轮转把好备份覆盖成坏文件。
        try {
          renameSync(main, this.file(`records.json.corrupt-before-restore-${Date.now()}`));
        } catch {
          rmSync(main, { force: true });
        }
        this.saveRecords();
      } catch {
        this.records = [];
        if (!missing) {
          this.loadError = '记忆库文件损坏且没有可用备份（已另存 records.json.corrupt-*）。'
            + '写入已暂停，请修复或用导出文件重新导入。';
        }
      }
    }
  }

  private loadEvents(): void {
    try {
      const lines = readFileSync(this.file('events.jsonl'), 'utf8').split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as RawEvent;
          if (event?.text && event?.id) this.events.push(event);
        } catch {
          // 坏行跳过
        }
      }
      const max = this.events.reduce((m, e) => Math.max(m, Number(e.cursor) || 0), 0);
      this.lastCursor = Math.max(this.lastCursor, max);
    } catch {
      // 没有事件文件
    }
  }

  private coerceRecord(value: unknown): MemoryRecord | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    if (typeof item.text !== 'string') return null;
    const text = normalize(item.text).slice(0, MAX_TEXT);
    if (!text) return null;
    const kind = mapKind(String(item.kind)) ?? 'fact';
    const ts = isoOr(item.ts, nowIso());
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.slice(0, 128) : randomUUID();
    return {
      id,
      kind,
      text,
      scope: cleanScope(item.scope),
      ts,
      createdAt: isoOr(item.createdAt, ts),
      confidence: clamp01(item.confidence, 0.6),
      importance: clamp01(item.importance, 0.5),
      source: typeof item.source === 'string' && item.source ? item.source.slice(0, 120) : '',
      tags: cleanTags(item.tags),
      trust: (['owner', 'trusted', 'external', 'untrusted'] as string[]).includes(String(item.trust))
        ? String(item.trust) as MemoryRecord['trust'] : 'owner',
      reviewStatus: (['approved', 'pending', 'rejected'] as string[]).includes(String(item.reviewStatus))
        ? String(item.reviewStatus) as MemoryRecord['reviewStatus'] : 'approved',
      useCount: Math.max(0, Math.floor(Number(item.useCount) || 0)),
      archived: item.archived === true,
      lastUsedAt: optionalIso(item.lastUsedAt),
      importedAt: typeof item.importedAt === 'string' ? item.importedAt : undefined,
      bundleId: typeof item.bundleId === 'string' ? item.bundleId : undefined,
      details: cleanDetails(kind, item.details),
      provenance: cleanProvenance(item.provenance),
      ...(shortStr(item.subjectKey, 120) ? { subjectKey: shortStr(item.subjectKey, 120) } : {}),
      version: Math.max(1, Math.floor(Number(item.version) || 1)),
      ...(cleanVersions(item.versions) ? { versions: cleanVersions(item.versions) } : {}),
      ...(optionalIso(item.updatedAt) ? { updatedAt: optionalIso(item.updatedAt) } : {}),
    };
  }

  private rebuildHashIndex(): void {
    this.byHash.clear();
    for (const record of this.records) {
      if (record.archived) continue;
      this.byHash.set(hashText(record.kind, record.scope, record.text), record.id);
    }
    this.tokenCache.clear();
  }

  private assertWritable(): void {
    if (this.loadError) throw new Error(this.loadError);
  }

  /** 写 tmp → fsync → 旧文件转 .bak → rename 正式文件。 */
  private writeAtomic(file: string, text: string): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const bak = `${file}.bak`;
    try {
      if (existsSync(file)) {
        rmSync(bak, { force: true });
        renameSync(file, bak);
      }
    } catch {
      // 备份失败不阻止主文件替换，但保留 tmp 供人工恢复
    }
    renameSync(tmp, file);
  }

  private saveRecords(): void {
    this.assertWritable();
    mkdirSync(this.dir, { recursive: true });
    this.writeAtomic(this.file('records.json'), JSON.stringify({ schema: MEMORY_SCHEMA, records: this.records }, null, 1));
    this.revision += 1;
  }

  private saveMeta(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      this.writeAtomic(this.file('meta.json'), JSON.stringify({
        lastCursor: this.lastCursor,
        lastPruneDay: this.lastPruneDay,
      }, null, 2));
    } catch {
      // 元数据丢了只会重扫事件；不阻塞主流程
    }
  }

  get rev(): number {
    return this.revision;
  }

  get eventCursor(): number {
    return this.lastCursor;
  }

  set eventCursor(cursor: number) {
    if (Number.isFinite(cursor) && cursor >= this.lastCursor) {
      this.lastCursor = cursor;
      this.saveMeta();
    }
  }

  /** 宿主事件库回退（清库/恢复备份）时重置游标。 */
  resetCursor(cursor: number): void {
    this.lastCursor = Number.isFinite(cursor) ? cursor : 0;
    this.saveMeta();
  }

  /** 同 subjectKey 的新状态写入已有记录，旧状态进 versions，不新增一条。 */
  private applyVersion(existing: MemoryRecord, incoming: MemoryRecord): AddResult {
    const current = existing.version ?? 1;
    const versions = existing.versions?.length ? [...existing.versions] : [{
      version: current,
      text: existing.text,
      ...(existing.kind === 'thread' && existing.details?.status ? { status: existing.details.status } : {}),
      observedAt: existing.ts,
      ...(existing.details?.validFrom ? { validFrom: existing.details.validFrom } : {}),
    }];
    const next = current + 1;
    for (const version of versions) {
      if (version.version === current && !version.validTo) version.validTo = incoming.ts;
    }
    versions.push({
      version: next,
      text: incoming.text,
      ...(incoming.kind === 'thread' && incoming.details?.status ? { status: incoming.details.status } : {}),
      observedAt: incoming.ts,
      ...(incoming.details?.validFrom ? { validFrom: incoming.details.validFrom } : {}),
      reason: '同 subjectKey 更新',
    });
    existing.version = next;
    existing.versions = versions.slice(-20);
    existing.text = incoming.text;
    existing.details = incoming.details;
    existing.ts = incoming.ts;
    existing.updatedAt = nowIso();
    existing.importance = Math.max(existing.importance, incoming.importance);
    existing.tags = cleanTags([...existing.tags, ...incoming.tags]);
    existing.archived = false;
    this.rebuildHashIndex();
    this.saveRecords();
    return { added: true, id: existing.id, updated: true };
  }

  /** 按 id 读当前记录（完整正文、版本、来源）。 */
  read(id: string): MemoryRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  /** 同一 subjectKey 的所有版本，按 observedAt 排序。 */
  timeline(subjectKey: string, scope?: string): Array<{
    id: string; kind: MemoryKind; subjectKey: string; text: string;
    status?: string; observedAt: string; version: number;
  }> {
    const key = String(subjectKey ?? '').trim();
    if (!key) return [];
    const out = [];
    for (const record of this.records) {
      if (record.subjectKey !== key || (scope && scopeKey(record.scope) !== scopeKey(scope))) continue;
      const versions = record.versions?.length ? record.versions : [{
        version: record.version ?? 1,
        text: record.text,
        observedAt: record.ts,
        ...(record.kind === 'thread' && record.details?.status ? { status: record.details.status } : {}),
      }];
      for (const version of versions) {
        out.push({
          id: record.id,
          kind: record.kind,
          subjectKey: key,
          text: version.text,
          ...(version.status ? { status: version.status } : {}),
          observedAt: version.observedAt,
          version: version.version,
        });
      }
    }
    return out.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }

  add(input: Partial<MemoryRecord> & { text: string; kind?: MemoryKind }): AddResult {
    const list = this.prepare([input]);
    if (!list.records.length) return { added: false, id: '' };
    const record = list.records[0];
    if (record.subjectKey && ['fact', 'thread', 'person'].includes(record.kind)) {
      const sameSubject = this.records
        .filter((item) => item.subjectKey === record.subjectKey
          && item.kind === record.kind && !item.archived
          && scopeKey(item.scope) === scopeKey(record.scope))
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
      if (sameSubject) {
        const sameStatus = (sameSubject.details?.status ?? '') === (record.details?.status ?? '');
        if (sameSubject.text === record.text && sameStatus) {
          return { added: false, id: sameSubject.id, duplicateOf: sameSubject.id };
        }
        return this.applyVersion(sameSubject, record);
      }
    }
    const exact = this.byHash.get(hashText(record.kind, record.scope, record.text));
    if (exact) return { added: false, id: exact, duplicateOf: exact };
    const tokens = tokenize(record.text);
    for (const existing of this.records) {
      if (existing.archived) continue;
      if (existing.kind !== record.kind || scopeKey(existing.scope) !== scopeKey(record.scope)) continue;
      const size = Math.max(existing.text.length, record.text.length);
      if (Math.abs(existing.text.length - record.text.length) > size * 0.5) continue;
      if (jaccard(tokens, this.tokensOf(existing)) >= NEAR_DUP) {
        return { added: false, id: existing.id, duplicateOf: existing.id };
      }
    }
    const result = this.addMany([record], { nearDup: false });
    return result.added ? { added: true, id: record.id } : { added: false, id: '' };
  }

  private prepare(inputs: Array<Partial<MemoryRecord> & { text: string; kind?: MemoryKind }>): {
    records: MemoryRecord[]; invalid: number;
  } {
    const records: MemoryRecord[] = [];
    let invalid = 0;
    for (const input of inputs) {
      if (!input || typeof input.text !== 'string') {
        invalid += 1;
        continue;
      }
      const text = normalize(input.text).slice(0, MAX_TEXT);
      if (!text) {
        invalid += 1;
        continue;
      }
      const kind = mapKind(String(input.kind ?? '')) ?? 'fact';
      const ts = isoOr(input.ts, nowIso());
      const id = typeof input.id === 'string' && input.id.trim() ? input.id : randomUUID();
      const record: MemoryRecord = {
        id,
        kind,
        text,
        scope: cleanScope(input.scope),
        ts,
        createdAt: isoOr(input.createdAt, nowIso()),
        confidence: clamp01(input.confidence, 0.7),
        importance: clamp01(input.importance, kind === 'note' ? 0.9 : 0.55),
        source: typeof input.source === 'string' && input.source ? input.source.slice(0, 120) : 'tool',
        tags: cleanTags(input.tags),
        trust: input.trust ?? 'owner',
        reviewStatus: input.reviewStatus ?? 'approved',
        useCount: Math.max(0, Math.floor(Number(input.useCount) || 0)),
        archived: input.archived === true,
        lastUsedAt: optionalIso(input.lastUsedAt),
        importedAt: input.importedAt,
        bundleId: input.bundleId,
        details: cleanDetails(kind, input.details),
        provenance: cleanProvenance(input.provenance),
        ...(shortStr(input.subjectKey, 120) ? { subjectKey: shortStr(input.subjectKey, 120) } : {}),
        version: Math.max(1, Math.floor(Number(input.version) || 1)),
        ...(cleanVersions(input.versions) ? { versions: cleanVersions(input.versions) } : {}),
        ...(optionalIso(input.updatedAt) ? { updatedAt: optionalIso(input.updatedAt) } : {}),
      };
      records.push(record);
    }
    return { records, invalid };
  }

  /** 批量写入：先去重，再一次性落盘；落盘失败回滚内存。 */
  addMany(records: MemoryRecord[], opts: { nearDup?: boolean } = {}): { added: number; duplicates: number } {
    this.assertWritable();
    const before = this.records.length;
    const beforeHash = new Map(this.byHash);
    const beforeTokens = new Map(this.tokenCache);
    const batchHashes = new Set<string>();
    let duplicates = 0;
    const accepted: MemoryRecord[] = [];

    for (const record of records) {
      const hash = hashText(record.kind, record.scope, record.text);
      if (this.byHash.has(hash) || batchHashes.has(hash)) {
        duplicates += 1;
        continue;
      }
      if (opts.nearDup) {
        const tokens = tokenize(record.text);
        let near = false;
        for (const existing of this.records) {
          if (existing.archived) continue;
          if (existing.kind !== record.kind || scopeKey(existing.scope) !== scopeKey(record.scope)) continue;
          if (Math.abs(existing.text.length - record.text.length) > Math.max(existing.text.length, record.text.length) * 0.5) continue;
          if (jaccard(tokens, this.tokensOf(existing)) >= NEAR_DUP) {
            near = true;
            break;
          }
        }
        if (near) {
          duplicates += 1;
          continue;
        }
      }
      batchHashes.add(hash);
      accepted.push(record);
    }

    this.records.push(...accepted);
    try {
      const ids = new Set(this.records.slice(0, before).map((record) => record.id));
      for (const record of accepted) {
        if (ids.has(record.id)) record.id = randomUUID();
        ids.add(record.id);
        this.byHash.set(hashText(record.kind, record.scope, record.text), record.id);
      }
      this.saveRecords();
    } catch (error) {
      this.records.length = before;
      this.byHash = beforeHash;
      this.tokenCache.clear();
      for (const [key, value] of beforeTokens) this.tokenCache.set(key, value);
      throw error;
    }
    return { added: this.records.length - before, duplicates };
  }

  /** 兼容旧调用：追加一条原始事件（按 cursor 幂等）。 */
  appendEvent(event: { text: string; scope?: string; source?: string; ts?: string; cursor?: number }): boolean {
    return this.appendEvents([event]) === 1;
  }

  /** 批量追加事件，只写一次盘；cursor 已存在则跳过。 */
  appendEvents(list: Array<{ text: string; scope?: string; source?: string; ts?: string; cursor?: number }>): number {
    const fresh: RawEvent[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const text = normalize(String(item.text ?? '')).slice(0, 1200);
      if (!text) continue;
      const cursor = Number(item.cursor);
      if (Number.isFinite(cursor) && cursor > 0 && cursor <= this.lastCursor) continue;
      const event: RawEvent = {
        id: randomUUID(),
        cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : undefined,
        ts: isoOr(item.ts, nowIso()),
        scope: cleanScope(item.scope ?? 'main'),
        source: String(item.source ?? 'capture').slice(0, 40),
        text,
      };
      const key = `${event.scope}\u0000${event.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(event);
    }
    if (!fresh.length) return 0;
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.file('events.jsonl'), fresh.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf8');
    this.events.push(...fresh);
    const max = fresh.reduce((m, e) => Math.max(m, Number(e.cursor) || 0), 0);
    if (max > this.lastCursor) {
      this.lastCursor = max;
      this.saveMeta();
    }
    this.revision += 1;
    return fresh.length;
  }

  private tokensOf(record: MemoryRecord): string[] {
    const cached = this.tokenCache.get(record.id);
    if (cached) return cached;
    const tokens = tokenize(record.text);
    this.tokenCache.set(record.id, tokens);
    return tokens;
  }

  /** 在文本里截取命中 token 附近的窗口。 */
  private snippetOf(text: string, qTokens: string[], raw: string): string {
    const lower = text.toLowerCase();
    let at = lower.indexOf(raw.toLowerCase());
    if (at < 0) {
      for (const token of qTokens) {
        const index = lower.indexOf(token);
        if (index >= 0 && (at < 0 || index < at)) at = index;
      }
    }
    if (at < 0) return text.slice(0, 160);
    const start = Math.max(0, at - 60);
    const end = Math.min(text.length, at + 100);
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  }

  search(query: string, opts: {
    limit?: number; scope?: string; kinds?: MemoryKind[]; retentionDays?: number; includeArchived?: boolean;
  } = {}): MemoryHit[] {
    const raw = normalize(query);
    if (!raw) return [];
    const limit = Math.max(1, Math.min(20, opts.limit ?? 6));
    const qTokens = [...new Set(tokenize(raw))];
    const lowerRaw = raw.toLowerCase();
    const days = Math.max(1, opts.retentionDays ?? 45);
    const cutoff = Date.now() - days * 86_400_000;

    const docs: Array<{
      id?: string; kind: MemoryKind; text: string; ts: string; scope: string; source: string; importance: number; tags: string[]; tokens: string[];
    }> = [];
    const allowed = opts.kinds ?? MEMORY_KINDS.filter((kind) => kind !== 'rule');
    for (const record of this.records) {
      if (record.reviewStatus !== 'approved') continue;
      if (record.archived && !opts.includeArchived) continue;
      if (opts.scope && scopeKey(record.scope) !== scopeKey(opts.scope)) continue;
      if (!allowed.includes(record.kind)) continue;
      docs.push({
        id: record.id, kind: record.kind, text: record.text, ts: record.ts, scope: record.scope,
        source: record.source, importance: record.importance, tags: record.tags, tokens: this.tokensOf(record),
      });
    }
    if (allowed.includes('episode')) {
      for (const event of this.events) {
        const t = Date.parse(event.ts);
        if (Number.isFinite(t) && t < cutoff) continue;
        if (opts.scope && scopeKey(event.scope) !== scopeKey(opts.scope)) continue;
        docs.push({
          kind: 'episode', text: event.text, ts: event.ts, scope: event.scope,
          source: event.source, importance: 0.45, tags: ['raw-event'], tokens: tokenize(event.text),
        });
      }
    }
    if (!docs.length) return [];

    const avgdl = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length || 1;
    const qSet = new Set(qTokens);
    const df = new Map<string, number>();
    for (const doc of docs) {
      for (const token of new Set(doc.tokens)) {
        if (qSet.has(token)) df.set(token, (df.get(token) ?? 0) + 1);
      }
    }
    const N = docs.length;
    const hits: MemoryHit[] = [];
    for (const doc of docs) {
      const tf = new Map<string, number>();
      for (const token of doc.tokens) {
        if (qSet.has(token)) tf.set(token, (tf.get(token) ?? 0) + 1);
      }
      let score = 0;
      for (const token of qTokens) {
        const f = tf.get(token) ?? 0;
        if (!f) continue;
        const n = df.get(token) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.tokens.length) / avgdl));
      }
      const contains = doc.text.toLowerCase().includes(lowerRaw);
      if (!score && !contains) continue;
      if (contains) score += 2.5 * Math.min(1, raw.length / 4);
      const ageDays = Math.max(0, (Date.now() - Date.parse(doc.ts)) / 86_400_000) || 0;
      const recency = Math.exp(-ageDays / RECENCY_DAYS);
      const final = score * (0.65 + 0.35 * recency) * (0.6 + 0.4 * doc.importance);
      if (final <= 0) continue;
      hits.push({
        id: doc.id,
        kind: doc.kind,
        text: doc.text,
        snippet: this.snippetOf(doc.text, qTokens, raw),
        ts: doc.ts,
        scope: doc.scope,
        score: final,
        source: doc.source,
      });
    }
    hits.sort((a, b) => b.score - a.score);

    // 结果去重 + 同质过滤：同文本只留一条，近似重复（Jaccard≥0.85）也丢掉。
    const picked: MemoryHit[] = [];
    const pickedTokens: string[][] = [];
    for (const hit of hits) {
      if (picked.length >= limit) break;
      if (hit.kind === 'person' && picked.some((item) => item.id === hit.id)) continue;
      const tokens = tokenize(hit.text);
      if (picked.some((p) => p.text === hit.text)) continue;
      if (pickedTokens.some((t) => jaccard(t, tokens) >= 0.85)) continue;
      picked.push(hit);
      pickedTokens.push(tokens);
    }
    return picked;
  }

  /** 常驻笔记：可按 scope 过滤，按时间新到旧。 */
  rules(limit = 8, scope?: string): MemoryRecord[] {
    return this.records
      .filter((record) => record.kind === 'rule' && record.reviewStatus === 'approved' && !record.archived
        && (!scope || scopeKey(record.scope) === scopeKey(scope)))
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, Math.max(0, limit));
  }

  /** 人物卡：main 优先、信息最全的在前，其余按时间新到旧。 */
  people(): MemoryRecord[] {
    return this.records
      .filter((record) => record.kind === 'person' && record.reviewStatus === 'approved' && !record.archived)
      .sort((a, b) => {
        const main = Number(scopeKey(b.scope) === 'main') - Number(scopeKey(a.scope) === 'main');
        return main || b.text.length - a.text.length || Date.parse(b.ts) - Date.parse(a.ts);
      });
  }

  /** 未完成的约定/话头；olderThanDays>0 时只要更久没碰过的。 */
  openThreads(olderThanDays = 0): MemoryRecord[] {
    const cutoff = Date.now() - Math.max(0, olderThanDays) * 86_400_000;
    return this.records.filter((record) => record.kind === 'thread'
      && record.reviewStatus === 'approved' && !record.archived
      && record.details?.status !== 'done' && record.details?.status !== 'dropped'
      && Date.parse(record.details?.lastTouchedAt ?? record.ts) <= cutoff);
  }

  markUsed(ids: string[], cooldownHours = 6): number {
    if (!ids.length) return 0;
    const set = new Set(ids);
    const cutoff = Date.now() - Math.max(0, cooldownHours) * 3_600_000;
    let changed = 0;
    for (const record of this.records) {
      if (!set.has(record.id)) continue;
      if (record.lastUsedAt && Date.parse(record.lastUsedAt) > cutoff) continue;
      record.useCount += 1;
      record.lastUsedAt = new Date().toISOString();
      changed += 1;
    }
    if (changed) {
      try { this.saveRecords(); } catch { /* 下次再存 */ }
    }
    return changed;
  }

  /** 衰减扫描：低强度且长期未用的非规则记录标记 archived（不删）。 */
  decaySweep(): number {
    const now = Date.now();
    let marked = 0;
    for (const record of this.records) {
      if (record.kind === 'rule' || record.kind === 'self' || record.kind === 'person') continue;
      if (record.archived) continue;
      const last = Date.parse(record.lastUsedAt ?? record.ts);
      const idleDays = (now - last) / 86_400_000;
      const strength = this.strengthOf(record, now);
      if (strength < 0.1 && idleDays > 90) {
        record.archived = true;
        marked += 1;
      }
    }
    if (marked) {
      this.rebuildHashIndex();
      this.saveRecords();
    }
    return marked;
  }

  private strengthOf(record: MemoryRecord, now = Date.now()): number {
    const ageDays = Math.max(0, (now - Date.parse(record.ts)) / 86_400_000) || 0;
    const base = record.kind === 'episode' ? 21 : record.kind === 'fact' ? 240 : record.kind === 'person' ? 540 : 3650;
    // 间隔效应：被想起/用过的记忆，半衰期更长（最多 4.6 倍）。
    const half = base * (1 + 0.6 * Math.min(record.useCount, 6));
    const use = 0.6 + 0.4 * Math.min(record.useCount, 5) / 5;
    return record.importance * use * Math.exp(-ageDays / half);
  }

  /** 最近 N 小时的人话事件（巩固计划用）。 */
  recentEvents(hours = 24, limit = 40, sinceMs?: number): RawEvent[] {
    const cutoff = Number.isFinite(sinceMs) ? Number(sinceMs) : Date.now() - Math.max(1, hours) * 3_600_000;
    return this.events
      .filter((event) => Date.parse(event.ts) >= cutoff)
      .slice(-Math.max(1, limit));
  }

  /** 近期高情绪 episode（proactive 用）。 */
  highIntensityEpisodes(days = 7, limit = 3): MemoryRecord[] {
    const cutoff = Date.now() - Math.max(1, days) * 86_400_000;
    return this.records
      .filter((record) => record.kind === 'episode' && record.reviewStatus === 'approved'
        && !record.archived && Date.parse(record.ts) >= cutoff
        && !record.tags.includes('musing')
        && (record.details?.intensity ?? 0) >= 0.6)
      .sort((a, b) => (b.details?.intensity ?? 0) - (a.details?.intensity ?? 0))
      .slice(0, Math.max(0, limit));
  }

  recent(limit = 3, scope?: string): MemoryRecord[] {
    return [...this.records]
      .filter((record) => record.kind !== 'rule' && record.reviewStatus === 'approved'
        && !record.archived && (!scope || scopeKey(record.scope) === scopeKey(scope))
        && !record.tags.includes('legacy-chat') && !record.tags.includes('recap')
        && !record.tags.includes('musing'))
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, Math.max(0, limit));
  }

  /** 部署时区当天 00:00 之后的 episode（工作记忆与 recent 去重用）。 */
  todayEpisodes(limit = 3, scope?: string, sinceMs = Date.now() - 86_400_000): MemoryRecord[] {
    const cutoff = Number.isFinite(sinceMs) ? Number(sinceMs) : Date.now() - 86_400_000;
    return this.records
      .filter((record) => record.kind === 'episode' && record.reviewStatus === 'approved'
        && !record.archived && Date.parse(record.ts) >= cutoff
        && (!scope || scopeKey(record.scope) === scopeKey(scope))
        && !record.tags.includes('legacy-chat') && !record.tags.includes('recap')
        && !record.tags.includes('musing'))
      .sort((a, b) => ((b.details?.intensity ?? 0) + b.importance) - ((a.details?.intensity ?? 0) + a.importance))
      .slice(0, Math.max(1, limit));
  }

  /** 今天聊过什么：当天 episode 摘要；没有 episode 时只报时间，不把私聊原文带进提示。 */
  todayDigest(limit = 3, scope?: string, sinceMs = Date.now() - 86_400_000, tz = 'UTC'): string {
    const rows = this.todayEpisodes(limit, scope, sinceMs);
    if (rows.length) return rows.map((record) => record.text.replace(/\s+/g, ' ').slice(0, 60)).join('；');
    const events = this.recentEvents(24, Math.max(3, limit), sinceMs)
      .filter((event) => !scope || scopeKey(event.scope) === scopeKey(scope));
    if (!events.length) return '';
    const times = events.map((event) => formatLocal(event.ts, tz).slice(11, 16));
    return `今天有 ${events.length} 条对话（${times[0]}–${times[times.length - 1]}）`;
  }

  /** 重要但正在变淡的记录：夜间复习队列。 */
  fadingImportant(limit = 2, now = Date.now()): MemoryRecord[] {
    const cutoff = now - 14 * 86_400_000;
    return this.records
      .filter((record) => (record.kind === 'episode' || record.kind === 'fact')
        && record.reviewStatus === 'approved' && !record.archived
        && !record.tags.includes('legacy-chat') && !record.tags.includes('recap')
        && !record.tags.includes('musing') && !record.tags.includes('merged')
        && record.importance >= 0.7
        && (!record.lastUsedAt || Date.parse(record.lastUsedAt) <= cutoff))
      .map((record) => ({ record, strength: this.strengthOf(record, now) }))
      .filter((item) => item.strength > 0.05 && item.strength < 0.4)
      .sort((a, b) => a.strength - b.strength)
      .slice(0, Math.max(0, limit))
      .map((item) => item.record);
  }

  /** 同情绪标签的旧 episode（情绪回声用）。 */
  emotionEcho(label: string, scope: string, opts: { exclude?: Set<string>; days?: number } = {}): MemoryRecord[] {
    if (!label) return [];
    const now = Date.now();
    const days = Math.max(1, opts.days ?? 180);
    return this.records
      .filter((record) => record.kind === 'episode' && record.reviewStatus === 'approved'
        && !record.archived && scopeKey(record.scope) === scopeKey(scope)
        && !record.tags.includes('legacy-chat') && !record.tags.includes('recap') && !record.tags.includes('musing')
        && !opts.exclude?.has(record.id)
        && record.details?.userEmotion?.label === label
        && now - Date.parse(record.ts) >= 86_400_000
        && now - Date.parse(record.ts) <= days * 86_400_000)
      .map((record) => ({
        record,
        score: (record.details?.userEmotion?.intensity ?? 0.5) * 0.6
          + record.importance * 0.3
          + Math.exp(-(now - Date.parse(record.ts)) / (30 * 86_400_000)) * 0.1,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => item.record);
  }

  /** 最近一条人话事件（情绪回声判断“这次说了什么”）。 */
  lastHumanEvent(maxAgeMinutes = 30): RawEvent | null {
    const cutoff = Date.now() - Math.max(1, maxAgeMinutes) * 60_000;
    let best: RawEvent | null = null;
    for (const event of this.events) {
      const ts = Date.parse(event.ts);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      if (!best || ts > Date.parse(best.ts)) best = event;
    }
    return best;
  }

  /**
   * 合并式遗忘：把同一 scope 下相似的 episode 聚成一条摘要，原文归档但保留 mergedFrom。
   * 高权重（importance>0.8）、rule/person/thread、legacy/recap/musing 不参与。
   */
  mergeSimilarEpisodes(limit = 2, minCluster = 3, threshold = 0.5): number {
    if (minCluster < 2 || minCluster > 6) return 0;
    const sim = Math.min(0.95, Math.max(0.2, Number(threshold) || 0.5));
    const candidates = this.records.filter((record) => record.kind === 'episode'
      && record.reviewStatus === 'approved' && !record.archived
      && record.importance <= 0.8
      && !record.tags.includes('legacy-chat') && !record.tags.includes('recap')
      && !record.tags.includes('musing') && record.details?.merged !== true)
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, MAX_MERGE_CANDIDATES);
    const used = new Set<string>();
    let merged = 0;
    for (const seed of candidates) {
      if (merged >= limit) break;
      if (used.has(seed.id)) continue;
      const cluster = [seed];
      const seedTokens = this.tokensOf(seed);
      for (const other of candidates) {
        if (other.id === seed.id || used.has(other.id) || cluster.length >= 6) continue;
        if (scopeKey(other.scope) !== scopeKey(seed.scope)) continue;
        if (jaccard(seedTokens, this.tokensOf(other)) < sim) continue;
        cluster.push(other);
      }
      if (cluster.length < minCluster) continue;
      const ids = cluster.map((record) => record.id);
      for (const id of ids) used.add(id);
      const first = cluster.reduce((a, b) => (Date.parse(a.ts) <= Date.parse(b.ts) ? a : b));
      const last = cluster.reduce((a, b) => (Date.parse(a.ts) >= Date.parse(b.ts) ? a : b));
      const emotions = cluster.map((record) => record.details?.userEmotion?.label).filter(Boolean) as string[];
      const maxUse = Math.max(...cluster.map((record) => record.useCount));
      const lastUsed = cluster
        .map((record) => record.lastUsedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? last.ts;
      const trust = cluster.some((record) => record.trust === 'untrusted') ? 'untrusted'
        : cluster.some((record) => record.trust === 'external') ? 'external'
          : cluster.some((record) => record.trust === 'trusted') ? 'trusted' : 'owner';
      const summary = {
        id: `merge-${createHash('sha256').update(ids.sort().join('|')).digest('hex').slice(0, 16)}`,
        kind: 'episode' as MemoryKind,
        text: normalize(
          `【合并】${first.ts.slice(0, 10)}~${last.ts.slice(0, 10)} 共 ${cluster.length} 次相似的经历：`
          + cluster.map((record) => record.text.slice(0, 70)).join('；'),
        ).slice(0, 500),
        scope: seed.scope,
        ts: last.ts,
        createdAt: new Date().toISOString(),
        confidence: 0.8,
        importance: Math.max(...cluster.map((record) => record.importance)),
        source: 'merge',
        tags: ['merged', ...new Set(cluster.flatMap((record) => record.tags))].slice(0, 8),
        trust: trust as MemoryRecord['trust'],
        reviewStatus: 'approved' as const,
        useCount: maxUse,
        lastUsedAt: lastUsed,
        archived: false,
        details: {
          merged: true,
          mergedFrom: ids,
          mergedCount: cluster.length,
          intensity: Math.max(...cluster.map((record) => record.details?.intensity ?? 0)),
          howIFelt: cluster.find((record) => record.details?.howIFelt)?.details?.howIFelt,
          userEmotion: emotions.length ? { label: emotions[0] } : undefined,
        },
      };
      const added = this.addMany([summary], { nearDup: false });
      const summaryId = added.added
        ? summary.id
        : this.byHash.get(hashText(summary.kind, summary.scope, summary.text));
      if (!summaryId) continue;
      for (const record of cluster) {
        record.archived = true;
        record.tags = cleanTags(['merged-source', ...record.tags]);
        record.details = { ...record.details, mergedInto: summaryId };
      }
      this.rebuildHashIndex();
      this.saveRecords();
      merged += 1;
    }
    return merged;
  }

  /** 撤销一次合并：恢复原文、删掉摘要。返回恢复的原文条数。 */
  unmerge(summaryId: string): number {
    const summary = this.records.find((record) => record.id === summaryId && record.details?.merged === true);
    if (!summary) return 0;
    let restored = 0;
    for (const record of this.records) {
      if (record.details?.mergedInto !== summaryId) continue;
      record.archived = false;
      record.tags = record.tags.filter((tag) => tag !== 'merged-source');
      record.details = { ...record.details, mergedInto: undefined };
      restored += 1;
    }
    if (!restored) return 0;
    this.records = this.records.filter((record) => record.id !== summaryId);
    this.rebuildHashIndex();
    this.saveRecords();
    return restored;
  }

  remove(query: string, scope?: string): number {
    const lower = normalize(query).toLowerCase();
    if (!lower) return 0;
    return this.removeWhere((record) => record.text.toLowerCase() === lower
      && (!scope || scopeKey(record.scope) === scopeKey(scope)));
  }

  removeIds(ids: string[]): number {
    const set = new Set(ids);
    return this.removeWhere((record) => set.has(record.id));
  }

  /** 按 id 收尾/更新一个 thread；供 companion_thread 工具使用。 */
  updateThread(id: string, patch: { status?: 'open' | 'done' | 'dropped'; what?: string; due?: string }): boolean {
    const record = this.records.find((item) => item.id === id && item.kind === 'thread');
    if (!record) return false;
    const oldStatus = record.details?.status;
    record.details = cleanDetails('thread', {
      ...record.details,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.what ? { what: patch.what } : {}),
      ...(patch.due ? { due: patch.due } : {}),
      lastTouchedAt: new Date().toISOString(),
    });
    if (patch.status && patch.status !== oldStatus) {
      const current = record.version ?? 1;
      const versions = record.versions?.length ? [...record.versions] : [{
        version: current,
        text: record.text,
        ...(oldStatus ? { status: oldStatus } : {}),
        observedAt: record.ts,
      }];
      versions.push({
        version: current + 1,
        text: record.text,
        status: patch.status,
        observedAt: new Date().toISOString(),
        reason: 'thread 状态更新',
      });
      record.version = current + 1;
      record.versions = versions.slice(-20);
      record.updatedAt = new Date().toISOString();
    }
    this.saveRecords();
    return true;
  }

  private removeWhere(predicate: (record: MemoryRecord) => boolean): number {
    const before = this.records.length;
    const kept = this.records.filter((record) => !predicate(record));
    const removed = before - kept.length;
    if (!removed) return 0;
    const snapshot = this.records;
    this.records = kept;
    try {
      this.rebuildHashIndex();
      this.saveRecords();
    } catch (error) {
      this.records = snapshot;
      this.rebuildHashIndex();
      throw error;
    }
    return removed;
  }

  /** 裁剪过期原始事件；非法参数直接返回 0，不误删。 */
  prune(retentionDays: number): number {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days < 1) return 0;
    const cutoff = Date.now() - days * 86_400_000;
    const kept = this.events.filter((event) => {
      const t = Date.parse(event.ts);
      return !Number.isFinite(t) || t >= cutoff;
    });
    const removed = this.events.length - kept.length;
    if (!removed) return 0;
    const snapshot = this.events;
    this.events = kept;
    try {
      this.writeAtomic(this.file('events.jsonl'), kept.map((event) => `${JSON.stringify(event)}\n`).join(''));
    } catch (error) {
      this.events = snapshot;
      throw error;
    }
    this.lastPruneDay = new Date().toISOString().slice(0, 10);
    this.saveMeta();
    this.revision += 1;
    return removed;
  }

  /** 每天最多自动裁剪一次；由 world 的 tick 调用。 */
  maybePrune(retentionDays: number): number {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastPruneDay === today) return 0;
    const removed = this.prune(retentionDays);
    if (!removed) {
      this.lastPruneDay = today;
      this.saveMeta();
    }
    return removed;
  }

  stats(): { records: number; events: number; byKind: Record<string, number>; byScope: Record<string, number>; error?: string } {
    const byKind: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    for (const record of this.records) {
      byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
      byScope[record.scope] = (byScope[record.scope] ?? 0) + 1;
    }
    return {
      records: this.records.length,
      events: this.events.length,
      byKind,
      byScope,
      ...(this.loadError ? { error: this.loadError } : {}),
    };
  }

  private quarantineDir(): string { return this.file('quarantine'); }

  /** 外部导入先落隔离区，不进入检索/提示词；批准后才合并。 */
  stageImport(bundle: unknown): { staged: number; invalid: number; bundleId?: string; error?: string } {
    const data = bundle as Partial<MemoryBundle>;
    if (!data || typeof data !== 'object') return { staged: 0, invalid: 0, error: '不是 JSON 对象' };
    if (!data.schema || !LEGACY_MEMORY_SCHEMAS.has(String(data.schema))) {
      return { staged: 0, invalid: 0, error: `schema 不匹配（需要 ${MEMORY_SCHEMA}，兼容 1）` };
    }
    if (!Array.isArray(data.records)) return { staged: 0, invalid: 0, error: '缺 records 数组' };
    if (data.records.length > MAX_IMPORT_RECORDS) {
      return { staged: 0, invalid: 0, error: `一次最多导入 ${MAX_IMPORT_RECORDS} 条` };
    }
    const prepared = this.prepare(data.records as Array<Partial<MemoryRecord> & { text: string }>);
    const bundleId = `import:${createHash('sha256').update(JSON.stringify(data.records)).digest('hex').slice(0, 12)}`;
    const staged = prepared.records.map((record) => ({
      ...record,
      trust: 'external' as const,
      reviewStatus: 'pending' as const,
      importedAt: nowIso(),
      bundleId,
    }));
    mkdirSync(this.quarantineDir(), { recursive: true });
    const name = `${bundleId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
    writeFileSync(join(this.quarantineDir(), name), JSON.stringify({
      schema: MEMORY_SCHEMA, bundleId, stagedAt: nowIso(), records: staged,
    }, null, 2), 'utf8');
    return { staged: staged.length, invalid: prepared.invalid, bundleId };
  }

  listQuarantine(): Array<{ bundleId: string; file: string; records: number; stagedAt: string }> {
    try {
      const dir = this.quarantineDir();
      return readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => {
        const file = join(dir, name);
        try {
          const data = JSON.parse(readFileSync(file, 'utf8')) as { bundleId?: string; stagedAt?: string; records?: unknown[] };
          return {
            bundleId: String(data.bundleId ?? name),
            file,
            records: Array.isArray(data.records) ? data.records.length : 0,
            stagedAt: String(data.stagedAt ?? ''),
          };
        } catch {
          return { bundleId: name, file, records: 0, stagedAt: '' };
        }
      });
    } catch {
      return [];
    }
  }

  approveImport(bundleId: string): { added: number; duplicates: number; invalid: number; error?: string } {
    const entry = this.listQuarantine().find((item) => item.bundleId === bundleId);
    if (!entry) return { added: 0, duplicates: 0, invalid: 0, error: '隔离区里没有这个 bundleId' };
    const data = JSON.parse(readFileSync(entry.file, 'utf8')) as { records?: Array<Partial<MemoryRecord> & { text: string }> };
    const prepared = this.prepare(data.records ?? []);
    const approved = prepared.records.map((record) => ({
      ...record,
      trust: 'external' as const,
      reviewStatus: 'approved' as const,
      bundleId,
    }));
    try {
      const result = this.addMany(approved, { nearDup: false });
      rmSync(entry.file, { force: true });
      return { ...result, invalid: prepared.invalid };
    } catch (error) {
      return { added: 0, duplicates: 0, invalid: prepared.invalid, error: error instanceof Error ? error.message : String(error) };
    }
  }

  rejectImport(bundleId: string): boolean {
    const entry = this.listQuarantine().find((item) => item.bundleId === bundleId);
    if (!entry) return false;
    rmSync(entry.file, { force: true });
    return true;
  }

  exportBundle(source: { system: string; version?: string }, opts: {
    scopes?: string[]; includeRules?: boolean; includeArchived?: boolean;
  } = {}): MemoryBundle {
    const scopes = opts.scopes?.length ? new Set(opts.scopes) : null;
    const records = this.records.filter((record) => {
      if (record.reviewStatus !== 'approved') return false;
      if (scopes && !scopes.has(record.scope)) return false;
      if (record.kind === 'rule' && opts.includeRules !== true) return false;
      if (record.archived && opts.includeArchived !== true) return false;
      return true;
    });
    return {
      schema: MEMORY_SCHEMA,
      exportedAt: nowIso(),
      source,
      records: records.map((record) => structuredClone(record)),
    };
  }

  importBundle(bundle: unknown): ImportResult {
    if (this.loadError) return { added: 0, duplicates: 0, invalid: 0, error: this.loadError };
    const data = bundle as Partial<MemoryBundle>;
    if (!data || typeof data !== 'object') return { added: 0, duplicates: 0, invalid: 0, error: '不是 JSON 对象' };
    if (!data.schema || !LEGACY_MEMORY_SCHEMAS.has(String(data.schema))) {
      return { added: 0, duplicates: 0, invalid: 0, error: `schema 不匹配（需要 ${MEMORY_SCHEMA}，兼容 1）` };
    }
    if (!Array.isArray(data.records)) return { added: 0, duplicates: 0, invalid: 0, error: '缺 records 数组' };
    if (data.records.length > MAX_IMPORT_RECORDS) {
      return { added: 0, duplicates: 0, invalid: 0, error: `一次最多导入 ${MAX_IMPORT_RECORDS} 条` };
    }
    const prepared = this.prepare(data.records as Array<Partial<MemoryRecord> & { text: string }>);
    try {
      const result = this.addMany(prepared.records, { nearDup: false });
      return { ...result, invalid: prepared.invalid };
    } catch (error) {
      return { added: 0, duplicates: 0, invalid: prepared.invalid, error: error instanceof Error ? error.message : String(error) };
    }
  }

  entries(): readonly MemoryRecord[] {
    return this.records;
  }

  fileInfo(): { recordsPath: string; eventsPath: string; bytes: number } {
    const recordsPath = this.file('records.json');
    const eventsPath = this.file('events.jsonl');
    let bytes = 0;
    for (const path of [recordsPath, eventsPath]) {
      try {
        bytes += statSync(path).size;
      } catch {
        // 还没落盘
      }
    }
    return { recordsPath, eventsPath, bytes };
  }

  exists(): boolean {
    return existsSync(this.file('records.json'));
  }
}
