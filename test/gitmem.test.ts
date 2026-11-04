import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { searchGitmem, workspaceFor } from '../src/gitmem.ts';

test('GitMem 读穿能查到 notes，跳过 companion 投影与人格文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'companion-gitmem-'));
  mkdirSync(join(root, 'notes'), { recursive: true });
  mkdirSync(join(root, 'companion'), { recursive: true });
  writeFileSync(join(root, 'notes', 'a.md'), '今天看了视频插件\n还有别的事\n', 'utf8');
  writeFileSync(join(root, 'companion', 'THREADS.md'), '视频插件 companion generated\n', 'utf8');
  writeFileSync(join(root, 'CONSTITUTION.md'), '视频插件 人格文件\n', 'utf8');
  writeFileSync(join(root, 'PARTNER.md'), '视频插件 人物文件\n', 'utf8');
  const hits = searchGitmem(root, '视频插件', 5);
  assert.equal(hits.some((hit) => hit.path.includes('notes')), true);
  assert.equal(hits.some((hit) => hit.path.startsWith('companion')), false);
  assert.equal(hits.some((hit) => /CONSTITUTION|PARTNER/.test(hit.path)), false);
});

test('workspaceFor 支持默认、相对与绝对路径', () => {
  const botDir = mkdtempSync(join(tmpdir(), 'companion-bot-'));
  assert.equal(workspaceFor(botDir, ''), join(botDir, 'workspace'));
  assert.equal(workspaceFor(botDir, 'workspace'), join(botDir, 'workspace'));
  assert.equal(workspaceFor(botDir, botDir), botDir);
});
