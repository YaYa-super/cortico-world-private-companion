/**
 * B站观看账本：所有入口（自己看 / 指定 BV / 陪看播放）都写这一份。
 *
 * 去重规则对齐 issue-2026-11-09：
 *  - 同 bvid 直接算看过；
 *  - 标题去标点/空白后 key 相同算同内容；
 *  - 标题字符 bigram Jaccard ≥ 0.8 算重投。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface BiliWatchEntry {
  at: string;
  bvid: string;
  title: string;
  owner?: string;
  duration?: number;
  via: 'tool' | 'self' | 'browser' | 'frames';
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(text: string): Set<string> {
  const chars = Array.from(text);
  const out = new Set<string>();
  for (let i = 0; i < chars.length - 1; i += 1) out.add(`${chars[i]}${chars[i + 1]}`);
  return out;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let hit = 0;
  for (const gram of left) if (right.has(gram)) hit += 1;
  return hit / (left.size + right.size - hit);
}

export class BiliWatchLedger {
  private entries: BiliWatchEntry[] = [];
  private readonly path: string;
  private legacyBvids = new Set<string>();
  private legacyTitles: string[] = [];

  constructor(path: string) {
    this.path = path;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      this.entries = readFileSync(this.path, 'utf8').split(/\n/).flatMap((line) => {
        if (!line.trim()) return [];
        try {
          const parsed = JSON.parse(line) as BiliWatchEntry;
          return parsed && parsed.bvid && parsed.title ? [parsed] : [];
        } catch {
          return [];
        }
      });
    } catch {
      this.entries = [];
    }
  }

  /** 导入旧陪看的 watched / fingerprints，避免升级后把看过的再刷一遍。 */
  importLegacy(bvids: string[], titles: string[]): void {
    for (const bvid of bvids) if (/^BV[0-9A-Za-z]{10}$/.test(bvid)) this.legacyBvids.add(bvid);
    for (const title of titles) {
      const key = titleKey(title);
      if (key && !this.legacyTitles.includes(key)) this.legacyTitles.push(key);
    }
  }

  /** 查这条是否看过；返回命中的旧记录。 */
  find(input: { bvid?: string; title?: string }): BiliWatchEntry | null {
    const bvid = input.bvid?.trim();
    if (bvid) {
      if (this.legacyBvids.has(bvid)) return { at: '', bvid, title: '旧陪看看过', via: 'self' };
      const byBvid = this.entries.find((entry) => entry.bvid === bvid);
      if (byBvid) return byBvid;
    }
    const title = titleKey(input.title?.trim() || '');
    if (!title) return null;
    for (const old of this.legacyTitles) {
      if (old === title || similarity(old, title) >= 0.8) return { at: '', bvid: '', title: old, via: 'self' };
    }
    for (const entry of this.entries) {
      const key = titleKey(entry.title);
      if (key === title || similarity(key, title) >= 0.8) return entry;
    }
    return null;
  }

  record(entry: BiliWatchEntry): BiliWatchEntry {
    this.entries.push(entry);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  list(limit = 20): BiliWatchEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(200, limit))).reverse();
  }

  count(): number {
    return this.entries.length + this.legacyBvids.size;
  }
}
