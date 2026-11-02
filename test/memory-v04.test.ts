import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { detectEmotion, relatedWords } from '../src/emotion.ts';
import { MemoryStore } from '../src/memory-store.ts';

function fresh(): MemoryStore {
  const dir = mkdtempSync(join(tmpdir(), 'companion-v04-'));
  return new MemoryStore(join(dir, 'memory'));
}

test('情绪词表：明显情绪能识别，普通陈述不误报', () => {
  assert.equal(detectEmotion('今天累死了，又加班')?.label, '疲惫');
  assert.equal(detectEmotion('哈哈太好了，终于搞定了')?.label, '开心');
  assert.equal(detectEmotion('有点烦，别吵')?.label, '烦躁');
  assert.equal(detectEmotion('今天天气不错'), null);
  assert.equal(detectEmotion('不累，我挺好的'), null);
  assert.equal(detectEmotion('缺乏睡眠会变笨'), null);
  assert.equal(detectEmotion('哪怕失败也没关系'), null);
  assert.ok(relatedWords('疲惫').includes('加班'));
});

test('markUsed：有冷却，不会每轮都涨', () => {
  const store = fresh();
  const added = store.add({ kind: 'episode', text: '他说连续加班三天，撑不住', importance: 0.8 });
  store.markUsed([added.id]);
  assert.equal(store.entries().find((record) => record.id === added.id)?.useCount, 1);
  store.markUsed([added.id]);
  assert.equal(store.entries().find((record) => record.id === added.id)?.useCount, 1);
  const record = store.entries().find((item) => item.id === added.id)!;
  record.lastUsedAt = new Date(Date.now() - 8 * 3_600_000).toISOString();
  store.markUsed([added.id]);
  assert.equal(store.entries().find((item) => item.id === added.id)?.useCount, 2);
});

test('todayDigest：只收今天的 episode，排除 musing/legacy', () => {
  const store = fresh();
  store.add({ kind: 'episode', text: '今天一起看了海', importance: 0.7 });
  store.add({ kind: 'episode', text: '今天胡思乱想了一条', tags: ['musing'], importance: 0.25 });
  store.add({ kind: 'episode', text: '旧聊天记录', tags: ['legacy-chat'], importance: 0.4 });
  const digest = store.todayDigest(5);
  assert.match(digest, /一起看了海/);
  assert.doesNotMatch(digest, /胡思乱想/);
  assert.doesNotMatch(digest, /旧聊天/);
});

test('emotionEcho：同 scope、同情绪、至少一天前', () => {
  const store = fresh();
  const past = store.add({
    kind: 'episode', text: '他说连续加班，累到不想说话', scope: 'main', importance: 0.8,
    details: { userEmotion: { label: '疲惫', cause: '连续加班', intensity: 0.8 } },
  });
  store.entries().find((record) => record.id === past.id)!.ts = new Date(Date.now() - 3 * 86_400_000).toISOString();
  assert.equal(store.emotionEcho('疲惫', 'main').length, 1);
  assert.equal(store.emotionEcho('疲惫', 'qq:1').length, 0);
  assert.equal(store.emotionEcho('疲惫', 'main', { exclude: new Set([past.id]) }).length, 0);
});

test('合并式遗忘：相似经历合成摘要，原文归档可查，高权重不合并', () => {
  const store = fresh();
  const texts = [
    '他今天又加班到十点，回来很累',
    '他今天又加班到十点，晚饭都没吃',
    '他今天又加班到十点，说撑不住',
  ];
  for (const text of texts) store.add({ kind: 'episode', text, scope: 'main', importance: 0.7 });
  const keeper = store.add({ kind: 'episode', text: '他今天又加班到十点，但这次升职了', scope: 'main', importance: 0.9 });
  const merged = store.mergeSimilarEpisodes(2, 3);
  assert.equal(merged, 1);
  const all = store.entries();
  const summary = all.find((record) => record.details?.merged === true);
  assert.ok(summary);
  assert.equal(summary?.details?.mergedCount, 3);
  assert.equal(all.filter((record) => record.tags.includes('merged-source')).length, 3);
  assert.equal(all.find((record) => record.id === keeper.id)?.archived, false);
  assert.equal(store.search('加班', { limit: 5 }).length > 0, true);
  assert.equal(store.search('加班', { limit: 5, includeArchived: true }).length > 0, true);
});

test('fadingImportant：重要且正在变淡的记录进复习队列', () => {
  const store = fresh();
  const added = store.add({ kind: 'episode', text: '他第一次说想让我一直陪着', importance: 0.9 });
  store.entries().find((record) => record.id === added.id)!.ts = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const queue = store.fadingImportant(3);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, added.id);
});

test('合并 limit：两簇都要合，且摘要不会隔天被衰减归档', () => {
  const store = fresh();
  const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
  const a = ['他加班到十点才回家，说很累', '他加班到十点才回家，晚饭没吃', '他加班到十点才回家，直接睡了'];
  const b = ['周末去海边看鲸鱼，风很大', '周末去海边看鲸鱼，晒黑了', '周末去海边看鲸鱼，很开心'];
  for (const text of [...a, ...b]) {
    const added = store.add({ kind: 'episode', text, scope: 'main', importance: 0.7 });
    const record = store.entries().find((item) => item.id === added.id)!;
    record.ts = old;
    record.useCount = 6;
    record.lastUsedAt = new Date().toISOString();
  }
  assert.equal(store.mergeSimilarEpisodes(2, 3), 2);
  const summaries = store.entries().filter((record) => record.details?.merged === true);
  assert.equal(summaries.length, 2);
  assert.equal(store.decaySweep(), 0);
  assert.equal(summaries.some((record) => record.archived), false);
});

test('合并后同文再记：不再撞已归档记录', () => {
  const store = fresh();
  for (const text of ['他加班到十点才回家，说很累', '他加班到十点才回家，晚饭没吃', '他加班到十点才回家，直接睡了']) {
    store.add({ kind: 'episode', text, scope: 'main', importance: 0.7 });
  }
  store.mergeSimilarEpisodes(1, 3);
  const again = store.add({ kind: 'episode', text: '他加班到十点才回家，说很累', scope: 'main', importance: 0.7 });
  assert.equal(again.added, true);
});

test('合并时系统 tag 不被 8 个旧 tag 挤掉；qq: 与裸数字 scope 可匹配', () => {
  const store = fresh();
  for (let i = 0; i < 3; i += 1) {
    store.add({
      kind: 'episode', text: ['他加班到十点才回家，说很累', '他加班到十点才回家，晚饭没吃', '他加班到十点才回家，直接睡了'][i],
      scope: 'main', importance: 0.7,
      tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    });
  }
  store.mergeSimilarEpisodes(1, 3);
  const archived = store.entries().filter((record) => record.tags.includes('merged-source'));
  assert.equal(archived.length, 3);

  const past = store.add({
    kind: 'episode', text: '他说连续加班，累到不想说话', scope: '1021036873', importance: 0.8,
    details: { userEmotion: { label: '累', cause: '连续加班', intensity: 0.8 } },
  });
  store.entries().find((record) => record.id === past.id)!.ts = new Date(Date.now() - 3 * 86_400_000).toISOString();
  store.entries().find((record) => record.id === past.id)!.details = { userEmotion: { label: '疲惫', cause: '连续加班', intensity: 0.8 } };
  assert.equal(store.emotionEcho('疲惫', 'qq:1021036873').length, 1);
});

test('合并可以撤销：恢复原文、删掉摘要', () => {
  const store = fresh();
  const texts = ['他加班到十点才回家，说很累', '他加班到十点才回家，晚饭没吃', '他加班到十点才回家，直接睡了'];
  for (const text of texts) store.add({ kind: 'episode', text, scope: 'main', importance: 0.7 });
  assert.equal(store.mergeSimilarEpisodes(1, 3), 1);
  const summary = store.entries().find((record) => record.details?.merged === true)!;
  assert.equal(store.unmerge(summary.id), 3);
  assert.equal(store.entries().some((record) => record.id === summary.id), false);
  assert.equal(store.entries().filter((record) => texts.includes(record.text) && !record.archived).length, 3);
});

test('lastHumanEvent：后追加的旧事件不会遮住刚说的话', () => {
  const store = fresh();
  store.appendEvents([
    { text: '刚说的话', ts: new Date().toISOString(), scope: 'qq:1', cursor: 1 },
  ]);
  store.appendEvents([
    { text: '两小时前的回放', ts: new Date(Date.now() - 2 * 3_600_000).toISOString(), scope: 'qq:1', cursor: 2 },
  ]);
  assert.equal(store.lastHumanEvent(30)?.text, '刚说的话');
});

test('forget 按 scope 删除，不会误删另一个域的同文记录', () => {
  const store = fresh();
  store.add({ kind: 'fact', text: '同一个秘密', scope: 'main' });
  store.add({ kind: 'fact', text: '同一个秘密', scope: 'qq:1' });
  assert.equal(store.remove('同一个秘密', 'qq:1'), 1);
  assert.equal(store.entries().filter((record) => record.text === '同一个秘密').length, 1);
});

test('导入 /1 旧 kind：note/profile/reflection/commitment 会映射到 v2 类型', () => {
  const store = fresh();
  const legacy = {
    schema: 'companion-memory/1',
    records: [
      { kind: 'note', text: '不要凌晨主动找人', importance: 0.9 },
      { kind: 'profile', text: '爸爸（父女）', importance: 0.8 },
      { kind: 'reflection', text: '我不靠语料长人格', importance: 0.7 },
      { kind: 'commitment', text: '答应帮爸爸看视频插件', importance: 0.7 },
    ],
  };
  const result = store.importBundle(legacy);
  assert.equal(result.added, 4);
  const kinds = store.entries().map((record) => record.kind).sort();
  assert.deepEqual(kinds, ['person', 'rule', 'self', 'thread']);
  const rule = store.entries().find((record) => record.kind === 'rule');
  assert.equal(rule?.details?.pinned, true);
});

test('thread 可以按 id 收尾/更新', () => {
  const store = fresh();
  const added = store.add({
    kind: 'thread',
    text: '答应帮爸爸看插件',
    scope: 'main',
    details: { what: '看插件', status: 'open' },
  });
  assert.equal(store.updateThread(added.id, { status: 'done', what: '看完了' }), true);
  const thread = store.entries().find((record) => record.id === added.id);
  assert.equal(thread?.details?.status, 'done');
  assert.equal(thread?.details?.what, '看完了');
});
