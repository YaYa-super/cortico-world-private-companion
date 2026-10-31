/**
 * 落盘：状态 JSON、关系卡 JSON、日记 JSONL。
 * 写盘一律先写临时文件再 rename，避免进程被杀时留下半个 JSON。
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    renameSync(tmp, file);
  } catch {
    // Windows 上目标被占用时 rename 会失败：退化为直接覆盖。
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  }
}

export interface Profile {
  /** 怎么称呼对方 */
  name: string;
  /** 关系，例如「主人」「搭档」「朋友」 */
  relation: string;
  /** MM-DD 或 YYYY-MM-DD；空串表示不知道 */
  birthday: string;
  notes: string[];
  updatedAt: string;
}

export type ProfileMap = Record<string, Profile>;

export const MAIN_KEY = 'main';

export function emptyProfile(): Profile {
  return { name: '', relation: '', birthday: '', notes: [], updatedAt: new Date().toISOString() };
}

/** 关系卡的一段人话；没有任何内容时返回空串（模板里整段省略）。 */
export function profileText(profile: Profile | undefined, key: string): string {
  if (!profile) return '';
  const bits: string[] = [];
  if (profile.name) bits.push(`称呼：${profile.name}`);
  if (profile.relation) bits.push(`关系：${profile.relation}`);
  if (profile.birthday) bits.push(`生日：${profile.birthday}`);
  if (profile.notes.length) bits.push(`备注：${profile.notes.join('；')}`);
  if (!bits.length) return '';
  return `${key === MAIN_KEY ? '这个人' : key} — ${bits.join(' · ')}`;
}

export interface JournalEntry {
  ts: string;
  kind: string;
  text: string;
}

export function journalPath(dir: string): string {
  return join(dir, 'journal.jsonl');
}

export function appendJournal(dir: string, entry: JournalEntry): void {
  ensureDir(dir);
  appendFileSync(journalPath(dir), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readJournal(dir: string, limit = 5): JournalEntry[] {
  try {
    const lines = readFileSync(journalPath(dir), 'utf8').split('\n').filter(Boolean);
    const out: JournalEntry[] = [];
    for (const line of lines.slice(-Math.max(0, limit))) {
      try {
        const parsed = JSON.parse(line) as JournalEntry;
        if (parsed && typeof parsed.text === 'string') out.push(parsed);
      } catch {
        // 半行（进程被杀）跳过即可
      }
    }
    return out;
  } catch {
    return [];
  }
}
