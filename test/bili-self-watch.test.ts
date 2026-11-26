import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { create, defaults } from '../src/index.ts';
import type { BiliReadClient } from '../src/channels/bili.ts';
import type { BiliWatchLedger } from '../src/channels/bili-watch.ts';
import type { CompanionState } from '../src/state.ts';

const NOW = new Date('2026-11-26T14:00:00+08:00');
const OLD = { bvid: 'BV1Lr4e64E1G', title: '旧片：潮汐和月亮', owner: '海边', duration: 600 };
const NEW = { bvid: 'BV1xx411c7mD', title: '新片：怎样烤面包', owner: '烘焙店', duration: 480 };
type Event = { type: string; text: string; meta?: Record<string, unknown>; blobs?: unknown[] };

function fixture(t: TestContext, overrides: Record<string, unknown> = {}, options = { jpeg: false }) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const dataDir = mkdtempSync(join(tmpdir(), 'companion-bili-watch-'));
  const ctx = {
    id: 'companion', cfg: {
      ...defaults(), biliChannelEnabled: true, biliSelfWatchEnabled: true,
      biliSelfWatchTopics: '', proactiveEnabled: false, ...overrides,
    }, timezone: 'Asia/Shanghai', botName: 'coo', botDir: dataDir, packageDir: dataDir,
    dataDir, repoRoot: dataDir, secret: () => '', storeSecret: () => {}, persist: () => {}, restart: async () => {},
  };
  const makeWorld = () => create(ctx as never) as unknown as {
    state: CompanionState;
    bili: BiliReadClient;
    biliWatch: BiliWatchLedger;
    memoryStore: { close(): void };
    host: unknown;
    tools(): Array<{name: string; handler(args: Record<string, unknown>): Promise<string>}>;
    probeLastUser(now: number): number | null;
    maybeBiliSelfWatch(now: Date): Promise<void>;
    maybeProactiveInner(now: Date): Promise<boolean>;
    toolBiliFrames(...args: unknown[]): Promise<unknown>;
  };
  const w = makeWorld();
  t.after(() => { w.memoryStore.close(); rmSync(dataDir, { recursive: true, force: true }); });
  w.state.sleeping = false;
  w.state.energy = 70;
  w.state.agenda = [];
  const events: Event[] = [];
  const host = {
    modelFacts: { accepts: () => options.jpeg },
    log: { warn() {} },
    pushEvent: async (event: Event) => { events.push(event); return { cursor: events.length, contextDelivery: 'deliver' }; },
  };
  w.host = host;
  t.mock.method(w, 'probeLastUser', () => NOW.getTime() - 45 * 60_000);
  t.mock.method(w.bili, 'history', async () => [{ ...OLD, author: OLD.owner, at: '2026-11-10T00:00:00Z', progress: 500 }]);
  t.mock.method(w.bili, 'popular', async () => [NEW]);
  t.mock.method(w.bili, 'info', async (bvid: string) => ({
    ...(bvid === OLD.bvid ? OLD : NEW), aid: 1, cid: 1, desc: '', pubdate: 0, pic: '', pages: [], stat: {},
  }));
  t.mock.method(w.bili, 'subtitles', async () => [{ from: 0, to: 2, text: '一段可以交给鱼鱼的字幕' }]);
  t.mock.method(w.bili, 'comments', async () => []);
  if ('hasLiked' in w.bili) t.mock.method(w.bili, 'hasLiked', async () => false);
  if ('coinsForVideo' in w.bili) t.mock.method(w.bili, 'coinsForVideo', async () => 0);
  w.biliWatch.record({ ...OLD, via: 'tool', at: '2026-11-10T00:00:00Z' });
  return { w, events, host, makeWorld, dataDir };
}

test('刚聊天或正在忙时不会自动挑片', async (t) => {
  const { w } = fixture(t);
  const probe = t.mock.method(w, 'probeLastUser', () => NOW.getTime() - 3 * 60_000);
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(w.biliWatch.count(), 1);
  probe.mock.mockImplementation(() => NOW.getTime() - 45 * 60_000);
  w.state.agenda = [{ time: '13:00', title: '开会', place: '书桌' }];
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(w.biliWatch.count(), 1);
});

test('闲下来能在主动联系关闭时仍独立发现新片', async (t) => {
  const { w, events } = fixture(t);
  t.mock.method(Math, 'random', () => 0.1);
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(w.biliWatch.list(1)[0].bvid, NEW.bvid);
  assert.equal(w.biliWatch.list(1)[0].via, 'self');
  assert.equal(w.state.pendingTrigger, null);
  assert.deepEqual(events.map((event) => event.type), ['bili.watch']);
  assert.match(events[0].text, /一段可以交给鱼鱼的字幕/);
});

test('另一半的选片机会能重看历史并记录为自动观看', async (t) => {
  const { w, events } = fixture(t);
  t.mock.method(Math, 'random', () => 0.9);
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(w.biliWatch.count(), 2);
  assert.equal(w.biliWatch.list(1)[0].bvid, OLD.bvid);
  assert.equal(w.biliWatch.list(1)[0].via, 'self');
  assert.equal(w.state.pendingTrigger, null);
  assert.equal(events[0].meta?.rewatch, true);
});

test('画面和字幕进同一条观察，抽帧失败时保留有额度的文字观看', async (t) => {
  const { w, events, dataDir } = fixture(t, { biliSelfWatchFramesDailyLimit: 5, biliSelfWatchTextDailyLimit: 2 }, { jpeg: true });
  t.mock.method(Math, 'random', () => 0.1);
  const frame = { bytes: new Uint8Array([1]), mime: 'image/jpeg', name: 'frame.jpg' };
  const capture = t.mock.method(w, 'toolBiliFrames', async () => ({ text: '抽帧结果', blobs: [frame] }));
  // 假设今天已用了一次文字额度，下一次轮到画面。
  const path = join(dataDir, 'private-companion', 'bili', 'self-watch-state.json');
  const state = { day: '2026-11-26', lastAt: '2026-11-26T00:00:00Z', textCount: 1, framesCount: 0 };
  writeFileSync(path, JSON.stringify(state));
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].blobs, [frame]);
  assert.match(events[0].text, /一段可以交给鱼鱼的字幕/);
  capture.mock.mockImplementation(async () => '没有抽到帧');
  writeFileSync(path, JSON.stringify(state));
  await w.maybeBiliSelfWatch(new Date(NOW.getTime() + 4 * 3_600_000));
  assert.equal(events.length, 2);
  assert.equal(events[1].blobs, undefined);
  assert.match(events[1].text, /一段可以交给鱼鱼的字幕/);
});

test('模型选择延后才安排分享，跨重载保留时间并经主动联系入口唤醒', async (t) => {
  const { w, events, host, makeWorld } = fixture(t, { proactiveEnabled: true });
  t.mock.method(Math, 'random', () => 0.1);
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(w.state.pendingTrigger, null);
  const share = w.tools().find((tool) => tool.name === 'bili_watch_review');
  assert.ok(share);
  await share.handler({ watch_id: events[0].meta?.watchId, decision: 'later', delay_minutes: 45, thought: '新片里的揉面手法挺有意思' });
  w.memoryStore.close();
  const reloaded = makeWorld();
  t.after(() => reloaded.memoryStore.close());
  reloaded.host = host;
  reloaded.state.sleeping = false;
  t.mock.method(reloaded, 'probeLastUser', () => NOW.getTime() - 4 * 3_600_000);
  assert.equal(await reloaded.maybeProactiveInner(new Date(NOW.getTime() + 44 * 60_000)), false);
  assert.equal(await reloaded.maybeProactiveInner(new Date(NOW.getTime() + 45 * 60_000)), true);
  assert.equal(events[1].type, 'companion.proactive');
  assert.match(events[1].text, /揉面手法挺有意思/);
  assert.equal(await reloaded.maybeProactiveInner(new Date(NOW.getTime() + 90 * 60_000)), false);
});

test('模型选留给自己时不唤醒，选现在才能尝试主动开口', async (t) => {
  const { w, events } = fixture(t, { proactiveEnabled: true });
  t.mock.method(Math, 'random', () => 0.1);
  await w.maybeBiliSelfWatch(NOW);
  const share = w.tools().find((tool) => tool.name === 'bili_watch_review')!;
  const first = { watch_id: events[0].meta?.watchId };
  await share.handler({ ...first, decision: 'private' });
  assert.equal(await w.maybeProactiveInner(NOW), false);
  const later = new Date(NOW.getTime() + 4 * 3_600_000);
  t.mock.timers.setTime(later.getTime());
  await w.maybeBiliSelfWatch(later);
  const second = { watch_id: events[1].meta?.watchId };
  await share.handler({ ...second, decision: 'now', thought: '今天又想起潮汐' });
  assert.equal(await w.maybeProactiveInner(later), true);
  assert.equal(events[2].type, 'companion.proactive');
  assert.match(events[2].text, /今天又想起潮汐/);
});

test('旧自动观看状态仍保持跨日间隔和文字额度', async (t) => {
  const { w, dataDir, events } = fixture(t, { biliSelfWatchTextDailyLimit: 1 });
  t.mock.method(Math, 'random', () => 0.1);
  const path = join(dataDir, 'private-companion', 'bili', 'self-watch-state.json');
  writeFileSync(path, JSON.stringify({
    day: '2026-11-26', lastAt: '2026-11-26T15:30:00.000Z', textCount: 1, framesCount: 0,
  }));
  await w.maybeBiliSelfWatch(new Date('2026-11-27T00:30:00+08:00'));
  assert.equal(events.length, 0);
  await w.maybeBiliSelfWatch(new Date('2026-11-27T02:30:00+08:00'));
  assert.equal(events.length, 1);
});

test('破损的空观看状态可以忽略', async (t) => {
  const { w, dataDir, events } = fixture(t);
  t.mock.method(Math, 'random', () => 0.1);
  writeFileSync(join(dataDir, 'private-companion', 'bili', 'self-watch-state.json'), 'null');
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(events.length, 1);
});

test('看后选择分别执行点赞、投一枚币和带 @ 评论，重载后拦住同片重复评论', async (t) => {
  const { w, events, makeWorld } = fixture(t, { biliReplyEnabled: true, biliOwnerUid: '654321' });
  t.mock.method(Math, 'random', () => 0.1);
  Object.defineProperty(w.bili, 'accountUid', { value: '123456' });
  const like = t.mock.method(w.bili, 'like', async () => ({ ok: true, message: '已点赞' }));
  const coin = t.mock.method(w.bili, 'coin', async () => ({ ok: true, message: '已投币' }));
  const comment = t.mock.method(w.bili, 'comment', async () => ({ ok: true, message: '已评论', rpid: 1 }));
  await w.maybeBiliSelfWatch(NOW);
  const tool = w.tools().find((item) => item.name === 'bili_watch_review');
  assert.ok(tool);
  const options = { watch_id: events[0].meta?.watchId, decision: 'private', like: true, coin: true,
    comment: '两次折叠面团的对比很直观', mention_owner: true };
  await tool.handler(options);
  await tool.handler(options);
  assert.deepEqual(like.mock.calls.map((call) => call.arguments), [[NEW.bvid, true]]);
  assert.deepEqual(coin.mock.calls.map((call) => call.arguments), [[NEW.bvid, 1]]);
  assert.equal(comment.mock.callCount(), 1);
  assert.equal(comment.mock.calls[0].arguments[2].mentionOwner, true);
  assert.equal(comment.mock.calls[0].arguments[2].mentionUid, '654321');

  w.memoryStore.close();
  const reloaded = makeWorld();
  t.after(() => reloaded.memoryStore.close());
  Object.defineProperty(reloaded.bili, 'accountUid', { value: '123456' });
  const repeat = t.mock.method(reloaded.bili, 'comment', async () => ({ ok: true, message: '已评论' }));
  const repeatLike = t.mock.method(reloaded.bili, 'like', async () => ({ ok: true, message: '已点赞' }));
  const repeatCoin = t.mock.method(reloaded.bili, 'coin', async () => ({ ok: true, message: '已投币' }));
  const react = reloaded.tools().find((item) => item.name === 'bili_act')!;
  assert.match(await react.handler({ action: 'like', bvid: NEW.bvid }), /已点过赞/);
  assert.match(await react.handler({ action: 'coin', bvid: NEW.bvid }), /已投过币/);
  assert.equal(repeatLike.mock.callCount(), 0);
  assert.equal(repeatCoin.mock.callCount(), 0);
  const manual = reloaded.tools().find((item) => item.name === 'bili_comment_reply')!;
  assert.match(await manual.handler({ bvid: NEW.bvid, text: '第二条', confirm: true }), /评论过/);
  assert.equal(repeat.mock.callCount(), 0);
});

test('同账号在视频评论区已有评论时，观察会提示且发评入口挡住重复', async (t) => {
  const { w, events } = fixture(t, { biliReplyEnabled: true });
  t.mock.method(Math, 'random', () => 0.1);
  Object.defineProperty(w.bili, 'accountUid', { value: '123456' });
  t.mock.method(w.bili, 'comments', async () => [{
    mid: '123456', user: '鱼鱼', message: '之前的评论', like: 0, at: NOW.toISOString(), rpid: 1, root: 0,
  }]);
  const comment = t.mock.method(w.bili, 'comment', async () => ({ ok: true, message: '已评论' }));
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(events[0].meta?.hasCommented, true);
  const tool = w.tools().find((item) => item.name === 'bili_watch_review')!;
  const result = await tool.handler({ watch_id: events[0].meta?.watchId, decision: 'private', comment: '多发一条' });
  assert.match(result, /评论过/);
  assert.equal(comment.mock.callCount(), 0);
});

test('B 站已有点赞和投币会挡住重复，否则才执行动作', async (t) => {
  const { w } = fixture(t);
  Object.defineProperty(w.bili, 'accountUid', { value: '123456' });
  if ('hasLiked' in w.bili) t.mock.method(w.bili, 'hasLiked', async () => true);
  if ('coinsForVideo' in w.bili) t.mock.method(w.bili, 'coinsForVideo', async () => 1);
  const like = t.mock.method(w.bili, 'like', async () => ({ ok: true, message: '已点赞' }));
  const coin = t.mock.method(w.bili, 'coin', async () => ({ ok: true, message: '已投币' }));
  const react = w.tools().find((item) => item.name === 'bili_act')!;
  assert.match(await react.handler({ action: 'like', bvid: NEW.bvid }), /已点过赞/);
  assert.match(await react.handler({ action: 'coin', bvid: NEW.bvid }), /已投过币/);
  assert.equal(like.mock.callCount(), 0);
  assert.equal(coin.mock.callCount(), 0);
});

test('首选片详情不符合时长限制时继续尝试后续候选', async (t) => {
  const { w } = fixture(t);
  t.mock.method(Math, 'random', () => 0.1);
  const bad = { ...NEW, bvid: 'BV1xx411c7mE', title: '暂时没有时长的预览', duration: 0 };
  t.mock.method(w.bili, 'popular', async () => [bad, NEW]);
  const originalInfo = w.bili.info.bind(w.bili);
  t.mock.method(w.bili, 'info', async (bvid: string) => bvid === bad.bvid
    ? { ...await originalInfo(bvid), ...bad, duration: 3600 } : originalInfo(bvid));
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(w.biliWatch.list(1)[0].bvid, NEW.bvid);
});

test('互动提交的网关响应无法确认时仍然拦住重试', async (t) => {
  const { w } = fixture(t);
  Object.assign(w.bili, { csrf: 'test-csrf', selfUid: '123456' });
  const post = t.mock.method(globalThis, 'fetch', async () => new Response('bad gateway', { status: 502 }));
  const react = w.tools().find((item) => item.name === 'bili_act')!;
  await react.handler({ action: 'like', bvid: NEW.bvid });
  assert.match(await react.handler({ action: 'like', bvid: NEW.bvid }), /结果未确认/);
  assert.equal(post.mock.callCount(), 1);
});

test('观看决定执行途中换账号时，后续互动不会使用新账号', async (t) => {
  const { w, events, makeWorld } = fixture(t, { biliReplyEnabled: true });
  t.mock.method(Math, 'random', () => 0.1);
  Object.assign(w.bili, { csrf: 'test-csrf', selfUid: '123456' });
  await w.maybeBiliSelfWatch(NOW);
  const replacement = makeWorld();
  t.after(() => replacement.memoryStore.close());
  Object.assign(replacement.bili, { csrf: 'test-csrf', selfUid: '333333' });
  t.mock.method(replacement.bili, 'coinsForVideo', async () => 0);
  const coin = t.mock.method(replacement.bili, 'coin', async () => ({ ok: true, message: '已投币' }));
  t.mock.method(w.bili, 'like', async () => { w.bili = replacement.bili; return { ok: true, message: '已点赞' }; });
  const review = w.tools().find((item) => item.name === 'bili_watch_review')!;
  await review.handler({ watch_id: events[0].meta?.watchId, decision: 'private', like: true, coin: true });
  assert.equal(coin.mock.callCount(), 0);
});

test('同意 @ 才在B站评论表单里写入准确的昵称与 UID 映射', async (t) => {
  const { w } = fixture(t);
  Object.assign(w.bili, { csrf: 'test-csrf', selfUid: '123456' });
  t.mock.method(w.bili, 'ownerName', async () => '主人');
  const bodies: URLSearchParams[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    bodies.push(init.body as URLSearchParams);
    return Response.json({ code: 0, data: { rpid: 1, reply: { content: { members: [{ mid: '654321' }] } } } });
  });
  const options = { mentionUid: '654321' };
  assert.equal((await w.bili.comment(NEW.bvid, '像在家里做面包', { ...options, mentionOwner: true })).ok, true);
  assert.equal((await w.bili.comment(NEW.bvid, '第二种做法', { ...options, mentionOwner: false })).ok, true);
  assert.match(bodies[0].get('message') ?? '', /^@主人 /);
  assert.deepEqual(JSON.parse(bodies[0].get('at_name_to_mid') ?? '{}'), { 主人: '654321' });
  assert.equal(bodies[1].has('at_name_to_mid'), false);
});

test('兴趣搜索的时长以时间串返回时，优先选择兴趣片源', async (t) => {
  const { w } = fixture(t, { biliSelfWatchTopics: '烘焙' });
  t.mock.method(Math, 'random', () => 0.1);
  const topic = { ...NEW, bvid: 'BV1xx411c7mE', title: '兴趣片源', duration: '08:00' };
  t.mock.method(w.bili, 'search', async () => [topic]);
  const popular = t.mock.method(w.bili, 'popular', async () => [NEW]);
  const originalInfo = w.bili.info.bind(w.bili);
  t.mock.method(w.bili, 'info', async (bvid: string) => bvid === topic.bvid
    ? { ...await originalInfo(bvid), ...topic, duration: 480 } : originalInfo(bvid));
  await w.maybeBiliSelfWatch(NOW);
  assert.equal(w.biliWatch.list(1)[0].bvid, topic.bvid);
  assert.equal(popular.mock.callCount(), 0);
});
