import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OneBotChannel, parseMessagePayload } from '../src/channels/onebot.ts';

function dirs() {
  const root = mkdtempSync(join(tmpdir(), 'companion-onebot-'));
  return { root, dataDir: join(root, 'data'), botDir: root };
}

test('OneBot 通道默认关闭，保存后能读回地址/开关', () => {
  const { root, dataDir, botDir } = dirs();
  const channel = new OneBotChannel({ dataDir, botDir });
  const initial = channel.loadConfig();
  assert.equal(initial.enabled, false);
  assert.equal(initial.wsUrl, 'ws://127.0.0.1:3001');
  channel.saveConfig({ enabled: true, wsUrl: 'ws://127.0.0.1:3999' });
  const again = new OneBotChannel({ dataDir, botDir }).loadConfig();
  assert.equal(again.enabled, true);
  assert.equal(again.wsUrl, 'ws://127.0.0.1:3999');
  assert.equal(channel.status().state, 'disabled');
  assert.ok(root.length > 0);
});

test('OneBot 首次读取旧 worlds.onebot 的地址与 token', () => {
  const { dataDir, botDir } = dirs();
  writeFileSync(join(botDir, 'config.json'), JSON.stringify({
    worlds: { onebot: { wsUrl: 'ws://127.0.0.1:3002', token: 'legacy-token' } },
  }), 'utf8');
  const channel = new OneBotChannel({ dataDir, botDir });
  const config = channel.loadConfig();
  assert.equal(config.wsUrl, 'ws://127.0.0.1:3002');
  assert.equal(config.token, 'legacy-token');
  assert.equal(channel.status().hasToken, true);
});

test('OneBot 消息段归一化：文本 / @ / 图片', () => {
  const message = parseMessagePayload({
    post_type: 'message',
    message_type: 'group',
    user_id: 3553975852,
    group_id: 123456,
    message_id: 9,
    sender: { card: '鲸鲸' },
    message: [
      { type: 'text', data: { text: '晚上好' } },
      { type: 'at', data: { qq: '3553975852' } },
      { type: 'image', data: { url: 'https://example.com/a.png' } },
    ],
  });
  assert.equal(message.messageType, 'group');
  assert.equal(message.nickname, '鲸鲸');
  assert.match(message.text, /晚上好/);
  assert.match(message.text, /@3553975852/);
  assert.match(message.text, /\[图片\]/);
  assert.deepEqual(message.images, ['https://example.com/a.png']);
});

test('OneBot 接收策略按会话过滤', () => {
  const { dataDir, botDir } = dirs();
  const channel = new OneBotChannel({ dataDir, botDir });
  channel.saveConfig({ receive: 'private:* group:123' });
  assert.equal(channel.accepts({ messageType: 'private', userId: '42', groupId: '' } as never), true);
  assert.equal(channel.accepts({ messageType: 'group', userId: '42', groupId: '123' } as never), true);
  assert.equal(channel.accepts({ messageType: 'group', userId: '42', groupId: '456' } as never), false);
});
