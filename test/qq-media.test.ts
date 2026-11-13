import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { create, defaults } from '../src/index.ts';

test('qq_view_image 首次给图，写含义后不再给图', async () => {
  const root = mkdtempSync(join(tmpdir(), 'companion-qq-image-'));
  const dataDir = join(root, 'data-private');
  const mediaDir = join(dataDir, 'private-companion', 'media', 'onebot');
  mkdirSync(mediaDir, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=', 'base64');
  const hash = createHash('sha256').update(png).digest('hex');
  const file = join(mediaDir, `${hash.slice(0, 24)}.png`);
  writeFileSync(file, png);
  writeFileSync(join(mediaDir, 'index.json'), JSON.stringify([{
    hash, path: file, url: 'https://example.com/test.png', mime: 'image/png', size: png.length,
    firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
  }]), 'utf8');

  const world = create({
    id: 'companion',
    cfg: { ...defaults(), enabled: true, qqChannelEnabled: true },
    timezone: 'Asia/Shanghai', botName: 'coo', botDir: root, packageDir: root,
    dataDir, repoRoot: root, secret: () => '', storeSecret: () => {},
    persist: () => {}, restart: async () => {},
  } as never) as unknown as {
    tools: () => Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>;
  };

  const view = world.tools().find((tool) => tool.name === 'qq_view_image');
  const note = world.tools().find((tool) => tool.name === 'qq_media_note');
  assert.ok(view && note);
  const first = await view!.handler({ key: hash }) as { blobs?: unknown[]; text?: string };
  assert.equal(first.blobs?.length, 1);
  const saved = await note!.handler({ key: hash, meaning: '测试图：一个像素' });
  assert.match(String(saved), /已记下/);
  const second = await view!.handler({ key: hash }) as string | { blobs?: unknown[]; text?: string };
  assert.equal(typeof second === 'string' ? undefined : second.blobs, undefined);
  assert.match(String(typeof second === 'string' ? second : second.text), /一个像素/);
  assert.match(String(typeof second === 'string' ? second : second.text), /不再返回图片/);
});
