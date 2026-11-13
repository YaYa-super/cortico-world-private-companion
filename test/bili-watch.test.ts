import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BiliWatchLedger } from '../src/channels/bili-watch.ts';

test('Bili 观看账本命中同标题重投', () => {
  const ledger = new BiliWatchLedger(join(mkdtempSync(join(tmpdir(), 'bili-ledger-')), 'watch.jsonl'));
  ledger.record({
    at: '2026-11-08T12:00:00.000Z',
    bvid: 'BV1Lr4e64E1G',
    title: '666，史上最抠门的大肥鱼，别人养鱼它养豆包，为了怕消耗token还严词拒绝“宠物不准上桌吃饭”',
    via: 'self',
  });
  assert.ok(ledger.find({ bvid: 'BV1Lr4e64E1G' }));
  assert.ok(ledger.find({ title: '666史上最抠门大肥鱼，别人养鱼他养豆包，为了怕消耗token还严词拒绝“宠物不准上桌吃饭”。' }));
});

test('旧 watched / fingerprints 会被导入', () => {
  const ledger = new BiliWatchLedger(join(mkdtempSync(join(tmpdir(), 'bili-legacy-')), 'watch.jsonl'));
  ledger.importLegacy(['BV1Lr4e64E1G'], ['666史上最抠门大肥鱼别人养鱼他养豆包']);
  assert.ok(ledger.find({ bvid: 'BV1Lr4e64E1G' }));
  assert.ok(ledger.find({ title: '666史上最抠门大肥鱼，别人养鱼他养豆包' }));
});
