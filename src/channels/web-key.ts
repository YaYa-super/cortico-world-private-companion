import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 复用 Coopanion 已有的 DeepSeek 密钥；找不到时返回空。 */
export function resolveDeepSeekKey(botDir: string, secret: (name: string) => string): { key: string; from: string } {
  const fromEnv = (() => { try { return secret('DEEPSEEK_API_KEY').trim(); } catch { return ''; } })();
  if (fromEnv) return { key: fromEnv, from: '部署环境' };
  const candidates = [
    join(botDir, '.env'),
    resolve(botDir, '..', 'providers', 'deepseek', '.env'),
    join(botDir, 'providers', 'deepseek', '.env'),
    join(dirname(botDir), 'providers', 'deepseek', '.env'),
  ];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const match = /^\s*DEEPSEEK_API_KEY\s*=\s*(\S+)/m.exec(readFileSync(file, 'utf8'));
      if (match?.[1]) return { key: match[1], from: file };
    } catch { /* 试下一个 */ }
  }
  return { key: '', from: '' };
}
