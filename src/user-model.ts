/**
 * 用户模型（derived user model）：从事件记忆里“算出来”的一小块理解，
 * 与事件记忆分开存、分开注入。
 *
 * 为什么要分开（调研结论，见 deepseek-memory/notes/companion-memory-research-2026-11-08.md）：
 *  - 事件记忆回答“发生过什么”，用户模型回答“他是谁、他最近怎么样”；
 *  - 模型是派生物：每条都带证据 id 和置信度，证据没了就跟着退场；
 *  - 模型要小（几百字）、稳定（同一个输入算出同一个结果）、可审计（面板能看/能删）。
 *
 * 这个文件只做**确定性推导**，不调用模型。夜间巩固可以让模型补充“假设”，
 * 但假设也必须落成同样结构的 item（kind='hypothesis'、带 evidenceRefs）。
 */
import { createHash } from 'node:crypto';
import type { MemoryRecord } from './memory-store.ts';
import { localParts } from './time.ts';

export type UserModelKind = 'fact' | 'pattern' | 'hypothesis';
export type UserModelSource = 'stated' | 'deduced' | 'induced';

export interface UserModelItem {
  /** 稳定槽位：identity / preference / boundary / routine / focus / mood / hypothesis:<slug> */
  key: string;
  kind: UserModelKind;
  /** 一句话，≤ 100 字。 */
  text: string;
  confidence: number;
  /** 证据记录 id（最多 4 条）；事件被归档/删除后这里会成为“空证据”。 */
  evidenceRefs: string[];
  source: UserModelSource;
  updatedAt: string;
}

export interface UserModel {
  version: 1;
  derivedAt: string;
  /** 输入指纹：同一份输入重算应得到同一个值，方便判断要不要重算。 */
  sourceHash: string;
  items: UserModelItem[];
}

export interface UserModelInput {
  records: readonly MemoryRecord[];
  now?: Date;
  tz?: string;
  /** 最多几条；默认 6。 */
  maxItems?: number;
}

const NEGATIVE = new Set(['疲惫', '烦躁', '难过', '焦虑', '孤独']);
const DAY = 86_400_000;

function clamp(value: number, lo: number, hi: number): number {
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : lo;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function oneLine(text: string, max: number): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isApproved(record: MemoryRecord): boolean {
  return record.reviewStatus === 'approved' && !record.archived;
}

function episodesOf(records: readonly MemoryRecord[]): MemoryRecord[] {
  return records.filter((record) => record.kind === 'episode'
    && isApproved(record)
    && !record.tags.includes('musing')
    && !record.tags.includes('legacy-chat')
    && !record.tags.includes('recap')
    && !record.tags.includes('thought'));
}

function fmtHour(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`;
}

function fmtWindow(start: number): string {
  const end = (start + 3) % 24;
  const period = start >= 23 || start < 5 ? '凌晨' : start < 8 ? '早上' : start < 11 ? '上午'
    : start < 13 ? '中午' : start < 17 ? '下午' : start < 19 ? '傍晚' : '晚上';
  if (end === 0) return `${period} ${fmtHour(start)}–24:00`;
  return end < start ? `${period} ${fmtHour(start)}–次日 ${fmtHour(end)}` : `${period} ${fmtHour(start)}–${fmtHour(end)}`;
}

/** 把模型写进去的长句拆成短片段；容忍“偏好:xxx;但…”这类脏数据。 */
function fragments(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const part of String(value ?? '').split(/[；;。、，,\n]/)) {
      const text = part.trim().replace(/^(偏好|边界|关系|其他)[:：]\s*/, '').trim();
      if (text.length < 2 || text.length > 30) continue;
      if (/^(偏好|边界|关系|其他)[:：]/.test(text)) continue;
      out.push(text);
    }
  }
  return out;
}

function pickPerson(records: readonly MemoryRecord[]): MemoryRecord | undefined {
  return records
    .filter((record) => record.kind === 'person' && isApproved(record))
    .sort((a, b) => {
      const score = (record: MemoryRecord) => (record.scope === 'main' ? 2 : 0)
        + (record.details?.personId ? 1 : 0) + record.importance
        + Math.min(1, record.text.length / 200);
      return score(b) - score(a);
    })[0];
}

function identityItem(record: MemoryRecord, now: Date): UserModelItem | null {
  const text = String(record.text ?? '');
  const role = text.split(/[（(：:]/)[0]?.trim().slice(0, 12) || '重要的人';
  const relation = record.details?.relationLabel ? String(record.details.relationLabel).slice(0, 12) : '';
  const nameMatch = /称呼[:：]\s*([^；;\n]+)/.exec(text);
  const name = nameMatch?.[1]?.split(/[\/、]/)[0]?.trim().slice(0, 12);
  const birthday = /生日[:：]?\s*([0-9]{1,2}\s*[-月/]\s*[0-9]{1,2}\s*日?)/.exec(text)?.[1]?.replace(/\s+/g, '');

  const parts = [`他是${role}`];
  if (relation && relation !== role) parts.push(`关系「${relation}」`);
  if (name) parts.push(`我称呼他「${name}」`);
  if (birthday) parts.push(`生日 ${birthday}`);
  return {
    key: 'identity',
    kind: 'fact',
    text: oneLine(`${parts.join('，')}。`, 100),
    confidence: 0.95,
    evidenceRefs: [record.id],
    source: 'stated',
    updatedAt: now.toISOString(),
  };
}

function preferenceItem(record: MemoryRecord, now: Date): UserModelItem | null {
  const details = record.details ?? {};
  const fromDetails = Array.isArray(details.preferences) ? details.preferences.map(String) : [];
  const fromText = (() => {
    const match = /偏好[:：]\s*([^；;\n]+)/.exec(String(record.text ?? ''));
    return match ? [match[1]] : [];
  })();
  const prefs = [...new Set([...fragments(fromDetails), ...fragments(fromText)])].slice(0, 2);
  if (!prefs.length) return null;
  return {
    key: 'preference',
    kind: 'fact',
    text: `${prefs.join('；')}。`,
    confidence: 0.85,
    evidenceRefs: [record.id],
    source: 'stated',
    updatedAt: now.toISOString(),
  };
}

function boundaryItem(record: MemoryRecord, now: Date): UserModelItem | null {
  const details = record.details ?? {};
  const fromDetails = Array.isArray(details.boundaries) ? details.boundaries.map(String) : [];
  const fromText = (() => {
    const match = /边界[:：]\s*([^；;\n]+)/.exec(String(record.text ?? ''));
    return match ? [match[1]] : [];
  })();
  // 线上出现过偏好/边界写成同一句的脏数据；和偏好片段相同的就不再当边界。
  const prefs = new Set(fragments(Array.isArray(details.preferences) ? details.preferences.map(String) : []));
  const items = [...new Set([...fragments(fromDetails), ...fragments(fromText)])]
    .filter((item) => !prefs.has(item))
    .slice(0, 1);
  if (!items.length) return null;
  return {
    key: 'boundary',
    kind: 'fact',
    text: `${items[0]}。`,
    confidence: 0.9,
    evidenceRefs: [record.id],
    source: 'stated',
    updatedAt: now.toISOString(),
  };
}

function routineItem(records: readonly MemoryRecord[], now: Date, tz: string): UserModelItem | null {
  const since = now.getTime() - 30 * DAY;
  const recent = episodesOf(records).filter((record) => {
    const at = Date.parse(record.ts);
    return Number.isFinite(at) && at >= since;
  });
  if (recent.length < 5) return null;
  const hours = recent.map((record) => {
    const parts = localParts(new Date(record.ts), tz);
    return parts.hour + parts.minute / 60;
  });
  let bestCount = -1;
  const counts: number[] = [];
  for (let start = 0; start < 24; start += 1) {
    const count = hours.filter((hour) => (Math.floor(hour) - start + 24) % 24 < 3).length;
    counts.push(count);
    if (count > bestCount) bestCount = count;
  }
  // 多个窗口并列时，取窗口中心离“平均出现时刻”最近的那个：
  // 21:30 的样本同时落在 19/20/21 点开头的窗口里，应该报 20:00–23:00 而不是 19:00–22:00。
  const radians = hours.map((hour) => (hour * Math.PI) / 12);
  const meanHour = ((Math.atan2(
    radians.reduce((sum, rad) => sum + Math.sin(rad), 0),
    radians.reduce((sum, rad) => sum + Math.cos(rad), 0),
  ) * 12) / Math.PI + 24) % 24;
  const distance = (a: number, b: number) => {
    const diff = Math.abs(a - b) % 24;
    return Math.min(diff, 24 - diff);
  };
  let bestStart = 0;
  let bestDistance = Infinity;
  for (let start = 0; start < 24; start += 1) {
    if (counts[start] !== bestCount) continue;
    const dist = distance((start + 1.5) % 24, meanHour);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestStart = start;
    }
  }
  const share = bestCount / hours.length;
  if (bestCount < 5 || share < 0.25) return null;
  const confidence = clamp(0.4 + 0.05 * Math.min(bestCount, 6) + 0.1 * Math.max(0, share - 0.25), 0.4, 0.85);
  return {
    key: 'routine',
    kind: 'pattern',
    text: `他常在 ${fmtWindow(bestStart)} 出现（近 30 天 ${bestCount} 次）。`,
    confidence: round2(confidence),
    evidenceRefs: recent.slice(-4).map((record) => record.id),
    source: 'induced',
    updatedAt: now.toISOString(),
  };
}

function focusItem(records: readonly MemoryRecord[], now: Date): UserModelItem | null {
  const threads = records
    .filter((record) => record.kind === 'thread'
      && isApproved(record)
      && record.details?.status !== 'done'
      && record.details?.status !== 'dropped')
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, 2);
  if (threads.length) {
    const labels = threads
      .map((thread) => oneLine(String(thread.details?.what ?? thread.text), 30))
      .filter(Boolean);
    if (labels.length) {
      return {
        key: 'focus',
        kind: 'pattern',
        text: `${labels.join('；')}。`,
        confidence: 0.7,
        evidenceRefs: threads.map((thread) => thread.id),
        source: 'stated',
        updatedAt: now.toISOString(),
      };
    }
  }
  const since = now.getTime() - 7 * DAY;
  const recent = episodesOf(records)
    .filter((record) => Date.parse(record.ts) >= since && record.importance >= 0.75)
    .sort((a, b) => b.importance - a.importance || Date.parse(b.ts) - Date.parse(a.ts))[0];
  if (!recent) return null;
  return {
    key: 'focus',
    kind: 'pattern',
    text: `${oneLine(recent.text, 40)}。`,
    confidence: 0.5,
    evidenceRefs: [recent.id],
    source: 'induced',
    updatedAt: now.toISOString(),
  };
}

function moodItem(records: readonly MemoryRecord[], now: Date): UserModelItem | null {
  const since = now.getTime() - 14 * DAY;
  const labelled = episodesOf(records).filter((record) => {
    const at = Date.parse(record.ts);
    return Number.isFinite(at) && at >= since && Boolean(record.details?.userEmotion?.label);
  });
  if (labelled.length < 4) return null;
  const counts = new Map<string, number>();
  for (const record of labelled) {
    const label = String(record.details?.userEmotion?.label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [topLabel, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!topLabel || topCount < 3 || topCount / labelled.length < 0.3) return null;
  return {
    key: 'mood',
    kind: 'pattern',
    text: `最近他多是「${topLabel}」（${topCount}/${labelled.length} 次）。`,
    confidence: round2(clamp(0.4 + 0.05 * Math.min(topCount, 6), 0.4, 0.7)),
    evidenceRefs: labelled.slice(-4).map((record) => record.id),
    source: 'induced',
    updatedAt: now.toISOString(),
  };
}

function hypothesisItem(records: readonly MemoryRecord[], now: Date): UserModelItem | null {
  const since = now.getTime() - 14 * DAY;
  const negative = episodesOf(records).filter((record) => {
    const at = Date.parse(record.ts);
    const label = record.details?.userEmotion?.label;
    return Number.isFinite(at) && at >= since
      && label && NEGATIVE.has(String(label))
      && Boolean(record.details?.userEmotion?.cause);
  });
  if (negative.length < 3) return null;
  const groups = new Map<string, MemoryRecord[]>();
  for (const record of negative) {
    const cause = oneLine(String(record.details?.userEmotion?.cause), 24);
    if (!cause) continue;
    groups.set(cause, [...(groups.get(cause) ?? []), record]);
  }
  const [cause, items] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!cause || items.length < 2) return null;
  return {
    key: `hypothesis:${cause.slice(0, 12)}`,
    kind: 'hypothesis',
    text: `「${cause}」可能让他不轻松（最近 ${items.length} 次）。`,
    confidence: round2(clamp(0.35 + 0.05 * Math.min(items.length - 2, 4), 0.35, 0.55)),
    evidenceRefs: items.slice(-3).map((record) => record.id),
    source: 'induced',
    updatedAt: now.toISOString(),
  };
}

function sourceHash(records: readonly MemoryRecord[]): string {
  const payload = records
    .filter(isApproved)
    .map((record) => `${record.id}\\u0001${record.ts}\\u0001${record.text.length}`)
    .sort()
    .join('\\u0002');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * 从记忆里推导用户模型。纯函数：同一个 records/now 只会得到同一个结果。
 * 只读、不落盘；落盘/合并/退休由调用方决定（当前只用于预览）。
 */
export function deriveUserModel(input: UserModelInput): UserModel {
  const now = input.now ?? new Date();
  const tz = input.tz ?? 'Asia/Shanghai';
  const records = input.records ?? [];
  const person = pickPerson(records);
  const items: UserModelItem[] = [];
  const push = (item: UserModelItem | null) => {
    if (item && !items.some((existing) => existing.key === item.key)) items.push(item);
  };

  if (person) {
    push(identityItem(person, now));
  }
  push(routineItem(records, now, tz));
  push(focusItem(records, now));
  push(moodItem(records, now));
  if (person) {
    push(preferenceItem(person, now));
    push(boundaryItem(person, now));
  }
  push(hypothesisItem(records, now));

  const max = Math.max(1, Math.min(8, Math.floor(input.maxItems ?? 6)));
  // 假设永远排最后；超过上限时先丢边界/偏好，不丢“最近的事”。
  const kept = items.length <= max ? items : (() => {
    const hypothesis = items.find((item) => item.kind === 'hypothesis');
    const rest = items.filter((item) => item.kind !== 'hypothesis').slice(0, hypothesis ? max - 1 : max);
    return hypothesis ? [...rest, hypothesis] : rest;
  })();

  return {
    version: 1,
    derivedAt: now.toISOString(),
    sourceHash: sourceHash(records),
    items: kept,
  };
}

const PREFIX: Record<string, string> = {
  identity: '确定',
  preference: '偏好',
  boundary: '边界',
  routine: '习惯',
  focus: '近况',
  mood: '心情',
  hypothesis: '也许',
};

function prefixOf(item: UserModelItem): string {
  if (item.kind === 'hypothesis') return '也许';
  return PREFIX[item.key] ?? PREFIX[item.key.split(':')[0]] ?? '知道';
}

/**
 * 渲染成一小段可注入的文本；没有内容时返回空串。
 * 假设永远放最后，并且带“也许”，不许当成事实说。
 */
export function renderUserModel(model: UserModel, opts: { maxLines?: number; maxChars?: number } = {}): string {
  const maxLines = Math.max(1, Math.min(8, Math.floor(opts.maxLines ?? 5)));
  const maxChars = Math.max(80, Math.min(800, Math.floor(opts.maxChars ?? 300)));
  if (!model.items.length) return '';
  const nonHypothesis = model.items.filter((item) => item.kind !== 'hypothesis');
  const hypotheses = model.items.filter((item) => item.kind === 'hypothesis');
  // 假设永远最后；行数不够时先砍普通条目，不砍“也许”。
  const ordered = [...nonHypothesis.slice(0, Math.max(0, maxLines - hypotheses.length)), ...hypotheses]
    .slice(0, maxLines);
  const lines: string[] = ['【我对他的理解】'];
  let used = lines[0].length;
  for (const item of ordered) {
    if (lines.length - 1 >= maxLines) break;
    const line = `- ${prefixOf(item)}：${item.text}`;
    if (used + line.length + 1 > maxChars) continue;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length > 1 ? lines.join('\n') : '';
}
