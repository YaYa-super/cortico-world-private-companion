/**
 * GitMem 只读读穿：主库仍是 companion-memory/2；
 * 主库没命中时按需检索旧 GitMem 工作区，不写入、不双向同步。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export function workspaceFor(botDir: string, configured: string): string {
  const value = String(configured ?? '').trim();
  if (!value) return join(botDir, 'workspace');
  return isAbsolute(value) ? resolve(value) : resolve(botDir, value);
}

export interface GitmemHit {
  path: string;
  line: number;
  text: string;
}

/** 只读检索旧 GitMem 工作区；跳过生成的 companion/ 与二进制/超大文件。 */
export function searchGitmem(workspace: string, query: string, limit = 5): GitmemHit[] {
  const root = resolve(workspace);
  const q = String(query ?? '').trim().toLowerCase();
  if (!q || !existsSync(root)) return [];
  const hits: GitmemHit[] = [];
  const skip = new Set(['.git', 'blobs', 'companion']);
  const skipFiles = new Set(['CONSTITUTION.md', 'PARTNER.md']);
  const walk = (dir: string): void => {
    if (hits.length >= limit) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= limit) return;
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (skipFiles.has(entry.name) || !/\.(md|txt)$/i.test(entry.name)) continue;
      try {
        if (statSync(abs).size > 512 * 1024) continue;
        const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < limit; i += 1) {
          const text = lines[i].trim();
          if (!text || !text.toLowerCase().includes(q)) continue;
          hits.push({ path: relative(root, abs), line: i + 1, text: text.slice(0, 240) });
        }
      } catch {
        // 单个文件读不了不影响其他文件
      }
    }
  };
  walk(root);
  return hits;
}
