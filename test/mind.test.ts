import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { MindLog } from '../src/mind.ts';

function fresh(limit = 500): { log: MindLog; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'companion-mind-'));
  const file = join(dir, 'mind.jsonl');
  return { log: new MindLog(file, limit), file };
}

test('心理活动日志：倒序、按类型过滤、坏行跳过', () => {
  const { log, file } = fresh();
  log.append({ type: 'proactive', summary: '开口：忽然想起' });
  log.append({ type: 'echo', summary: '回声：上次加班' });
  log.append({ type: 'memory', summary: '记住 episode：一起看海' });
  const all = log.tail(10);
  assert.equal(all.length, 3);
  assert.equal(all[0].summary, '记住 episode：一起看海');
  assert.equal(log.tail(10, 'echo').length, 1);
  assert.equal(log.tail(10, 'echo')[0].summary, '回声：上次加班');
  const text = readFileSync(file, 'utf8');
  assert.match(text, /"type":"proactive"/);
  assert.equal(existsSync(file), true);
});
