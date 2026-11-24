import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, defaults, COMPANION_CONFIG_GROUPS } from '../src/index.ts';

test('本地看图默认关闭，开关紧跟试验设置里的模型 ID', () => {
  assert.equal(defaults().preferLocalMediaVision, false);
  const keys = Object.keys(COMPANION_CONFIG_GROUPS.find(group => group.id.endsWith(':experimental'))!.schema.properties);
  assert.equal(keys[keys.indexOf('worlds.companion.mediaCaptionModel') + 1], 'worlds.companion.preferLocalMediaVision');
});

for (const entry of ['message', 'view', 'remind']) {
  for (const mode of ['off', 'local', 'failed']) {
    test(`QQ 图片 ${entry} / ${mode}`, async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'coo-local-vision-'));
      t.after(() => rmSync(root, {recursive: true, force: true}));
      const cfg = {...defaults(), qqChannelEnabled: true, preferLocalMediaVision: mode !== 'off', mediaCaptionModel: 'fixture'};
      const world = create({cfg, dataDir: root, botDir: root, timezone: 'Asia/Shanghai'} as never) as any;
      const file = join(root, 'sample.png');
      const bytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';
      writeFileSync(file, Buffer.from(bytes, 'base64'));
      const record = world.oneBot.mediaImportFile(file).record;
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async (_url, init) => {
        calls++;
        const {messages} = JSON.parse(init.body);
        assert.equal(messages[0].content[1].image_url.url, 'data:image/png;base64,' + bytes);
        return mode === 'failed' ? new Response(null, {status: 503}) :
          Response.json({choices: [{message: {content: '一只猫在挥手'}}]});
      });
      const events: any[] = [];
      world.host = {pushEvent: async (event) => events.push(event)};
      let result;
      if (entry === 'view') {
        result = await world.toolQqViewImage({key: record.hash});
      } else if (entry === 'message') {
        await world.handleQqMessage({at: new Date().toISOString(), text:'', nickname:'测试', messageType:'private', userId:'1', imageKeys:[record.hash]});
        result = events[0];
      } else {
        record.needsMeaning = true;
        record.lastSeenAt = '2000-01-01T00:00:00Z';
        await world.remindPendingQqMedia(new Date());
        result = events[0];
      }
      assert.equal(calls, mode === 'off' ? 0 : 1);
      if (mode === 'local') {
        assert.equal(record.meaning, '一只猫在挥手');
        assert.equal(result?.blobs, undefined);
        if (entry !== 'remind') assert.match(typeof result === 'string' ? result : result.text, /一只猫在挥手/);
        await world.toolQqViewImage({key: record.hash});
        assert.equal(calls, 1);
      } else {
        assert.equal(result.blobs.length, 1);
      }
    });
  }
}
