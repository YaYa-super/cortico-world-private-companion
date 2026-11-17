/**
 * 通道媒体存储（OneBot 图片起步）。
 *
 * 只做三件事：校验公网 http(s)、下载、按 sha256 去重落盘。
 * 索引是本地 JSON；语义标注留给后续 qq_media_note / 记忆层。
 */
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MediaRecord {
  hash: string;
  path: string;
  url: string;
  mime: string;
  size: number;
  firstSeenAt: string;
  lastSeenAt: string;
  meaning?: string;
  viewedAt?: string;
  viewCount?: number;
  /** 图片已随消息给过模型，但还没写含义。 */
  needsMeaning?: boolean;
  remindedAt?: string;
  lastSeenAt?: string;
  /** 来源：QQ 下载或本地导入。 */
  source?: 'qq' | 'import';
  /** 本地导入时的原始路径。 */
  sourceFile?: string;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RECORDS = 20_000;

function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host === '::1' || host === '0.0.0.0') return true;
  if (/^(fc|fd|fe80:)/i.test(host)) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const m = /^172\.(\d+)\./.exec(host);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

export function publicHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (privateHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}


function privateIp(address: string): boolean {
  const host = address.toLowerCase();
  if (host === '::1' || host === '::' || /^(fc|fd|fe80:)/i.test(host)) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || host === '0.0.0.0') return true;
  const m = /^172\.(\d+)\./.exec(host);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (privateHost(host)) throw new Error('私有地址');
  if (isIP(host)) {
    if (privateIp(host)) throw new Error('私有地址');
    return;
  }
  const rows = await lookup(host, { all: true });
  if (!rows.length || rows.some((row) => privateIp(row.address))) throw new Error('私有地址');
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes ? bytes : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

export class ChannelMediaStore {
  readonly dir: string;
  private readonly indexPath: string;
  private records = new Map<string, MediaRecord>();

  constructor(dir: string) {
    this.dir = dir;
    this.indexPath = join(dir, 'index.json');
    mkdirSync(dir, { recursive: true });
    try {
      if (existsSync(this.indexPath)) {
        const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8')) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === 'object' && typeof (item as MediaRecord).hash === 'string') {
              const record = item as MediaRecord;
              this.records.set(record.hash, record);
            }
          }
        }
      }
    } catch {
      // 索引坏了不影响下载；下一次保存重写。
    }
  }

  list(limit = 20): MediaRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  search(query: string, limit = 20): MediaRecord[] {
    const needle = query.trim().toLowerCase();
    const items = [...this.records.values()].filter((item) => !needle
      || String(item.meaning || '').toLowerCase().includes(needle)
      || item.hash.includes(needle)
      || item.path.toLowerCase().includes(needle)
      || String(item.sourceFile || '').toLowerCase().includes(needle));
    return items.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, Math.max(1, Math.min(100, limit)));
  }

  all(): MediaRecord[] {
    return [...this.records.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  get(key: string): MediaRecord | null {
    const needle = key.trim();
    if (!needle) return null;
    return [...this.records.values()].find((item) => item.hash === needle || item.path === needle || item.url === needle || item.hash.startsWith(needle)) ?? null;
  }

  remove(key: string): MediaRecord | null {
    const needle = key.trim();
    if (!needle) return null;
    const record = [...this.records.values()].find((item) => item.hash === needle || item.path === needle || item.url === needle || item.hash.startsWith(needle));
    if (!record) return null;
    this.records.delete(record.hash);
    try { rmSync(record.path, { force: true }); } catch { /* 索引先移除，残留文件不影响使用 */ }
    this.save();
    return record;
  }

  markViewed(record: MediaRecord): void {
    record.viewedAt = new Date().toISOString();
    record.viewCount = (record.viewCount || 0) + 1;
    this.save();
  }

  markSeen(record: MediaRecord): void {
    record.lastSeenAt = new Date().toISOString();
    if (!record.meaning) record.needsMeaning = true;
    this.save();
  }

  markReminded(record: MediaRecord): void {
    record.remindedAt = new Date().toISOString();
    this.save();
  }

  pendingMeaning(limit = 4): MediaRecord[] {
    const now = Date.now();
    return [...this.records.values()]
      .filter((record) => !record.meaning && record.needsMeaning)
      .filter((record) => !record.remindedAt || now - Date.parse(record.remindedAt) > 6 * 3_600_000)
      .filter((record) => !record.lastSeenAt || now - Date.parse(record.lastSeenAt) > 10 * 60_000)
      .sort((a, b) => (Date.parse(a.lastSeenAt || '') || 0) - (Date.parse(b.lastSeenAt || '') || 0))
      .slice(0, Math.max(1, Math.min(8, limit)));
  }

  read(record: MediaRecord): Uint8Array {
    return readFileSync(record.path);
  }

  attachMeaning(key: string, meaning: string, persist = true): MediaRecord | null {
    const needle = key.trim();
    if (!needle) return null;
    const record = [...this.records.values()].find((item) => item.hash === needle || item.path === needle || item.url === needle || item.hash.startsWith(needle));
    if (!record) return null;
    record.meaning = meaning.trim().slice(0, 200);
    record.needsMeaning = false;
    record.lastSeenAt = new Date().toISOString();
    if (persist) this.save();
    return record;
  }

  /** 批量导入/描述时由调用方控制落盘频率。 */
  flush(): void { this.save(); }

  async capture(raw: string, allowAny = false): Promise<MediaRecord | null> {
    let target = publicHttpUrl(raw);
    if (!target) return null;
    const maxBytes = allowAny ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
    try {
      let response: Response | null = null;
      for (let hop = 0; hop <= 3; hop += 1) {
        await assertPublicHost(target.hostname);
        response = await fetch(target, { signal: AbortSignal.timeout(8_000), redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => {});
          if (!location) return null;
          target = publicHttpUrl(new URL(location, target).toString());
          if (!target) return null;
          continue;
        }
        break;
      }
      if (!response || !response.ok) return null;
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!allowAny && !mime.startsWith('image/')) return null;
      if (allowAny && !/^(image|audio|video|text|application)\//.test(mime)) return null;
      const length = Number(response.headers.get('content-length') || 0);
      if (length > maxBytes) return null;
      const bytes = await readLimited(response, maxBytes);
      if (!bytes) return null;
      const hash = createHash('sha256').update(bytes).digest('hex');
      const existing = this.records.get(hash);
      const now = new Date().toISOString();
      if (existing) {
        existing.lastSeenAt = now;
        this.save();
        return existing;
      }
      const ext = mime === 'image/png' ? '.png' : mime === 'image/gif' ? '.gif'
        : mime === 'image/webp' ? '.webp' : mime === 'image/jpeg' ? '.jpg'
          : mime.startsWith('audio/') ? '.audio' : mime.startsWith('text/') ? '.txt' : '.bin';
      const path = join(this.dir, `${hash.slice(0, 24)}${ext}`);
      writeFileSync(path, bytes);
      const record: MediaRecord = {
        hash, path, url: target.toString(), mime, size: bytes.byteLength, firstSeenAt: now, lastSeenAt: now,
      };
      this.records.set(hash, record);
      while (this.records.size > MAX_RECORDS) {
        const oldest = [...this.records.values()].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0];
        if (!oldest) break;
        this.records.delete(oldest.hash);
      }
      this.save();
      return record;
    } catch {
      return null;
    }
  }

  /** 导入本地图片；按内容 sha256 与 QQ 图片共用去重。 */
  importFile(source: string): { record: MediaRecord; duplicate: boolean } | null {
    try {
      const stat = statSync(source);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) return null;
      const ext = source.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp' : ext === 'bmp' ? 'image/bmp'
          : ext === 'avif' ? 'image/avif' : (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') ? 'image/jpeg' : '';
      if (!mime) return null;
      const bytes = new Uint8Array(readFileSync(source));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const existing = this.records.get(hash);
      const now = new Date().toISOString();
      if (existing) {
        existing.lastSeenAt = now;
        if (!existing.sourceFile) existing.sourceFile = source;
        this.save();
        return { record: existing, duplicate: true };
      }
      const extOut = mime === 'image/png' ? '.png' : mime === 'image/gif' ? '.gif'
        : mime === 'image/webp' ? '.webp' : mime === 'image/bmp' ? '.bmp'
          : mime === 'image/avif' ? '.avif' : '.jpg';
      const path = join(this.dir, `${hash.slice(0, 24)}${extOut}`);
      writeFileSync(path, bytes);
      const record: MediaRecord = {
        hash, path, url: '', mime, size: bytes.byteLength,
        firstSeenAt: now, lastSeenAt: now,
        source: 'import', sourceFile: source,
      };
      this.records.set(hash, record);
      while (this.records.size > MAX_RECORDS) {
        const oldest = [...this.records.values()].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0];
        if (!oldest) break;
        this.records.delete(oldest.hash);
      }
      this.save();
      return { record, duplicate: false };
    } catch {
      return null;
    }
  }

  private save(): void {
    const list = [...this.records.values()].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
    try {
      writeFileSync(this.indexPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
    } catch {
      // 落盘失败不阻塞聊天；文件已下载时可后续重建。
    }
  }
}
