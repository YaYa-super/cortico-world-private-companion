import test from 'node:test';
import assert from 'node:assert/strict';

import type { MemoryRecord } from '../src/memory-store.ts';
import { deriveUserModel, renderUserModel } from '../src/user-model.ts';

const AT = '2026-11-01T13:30:00.000Z'; // Asia/Shanghai 21:30

function rec(patch: Partial<MemoryRecord> & { kind: MemoryRecord['kind']; text: string; ts: string }): MemoryRecord {
  return {
    id: `${patch.kind}-${patch.ts}-${Math.random().toString(36).slice(2, 6)}`,
    scope: 'main',
    createdAt: patch.ts,
    confidence: 0.8,
    importance: 0.7,
    source: 'test',
    tags: [],
    trust: 'owner',
    reviewStatus: 'approved',
    useCount: 0,
    archived: false,
    ...patch,
  } as MemoryRecord;
}

function person(): MemoryRecord {
  return rec({
    kind: 'person',
    ts: '2026-10-20T10:00:00.000Z',
    text: '爸爸（父女）：称呼：主人 / 爸爸；偏好：喜欢我安静、不要太吵；边界：别在凌晨发消息。',
    details: {
      personId: 'person-1',
      relationLabel: '父女',
      preferences: ['喜欢我安静', '不要太吵'],
      boundaries: ['别在凌晨发消息'],
    },
  });
}

function episodes(count: number, label: string, cause: string): MemoryRecord[] {
  return Array.from({ length: count }, (_, index) => rec({
    kind: 'episode',
    ts: new Date(Date.parse(AT) - index * 86_400_000).toISOString(),
    text: `第 ${index + 1} 天晚上聊到很晚。`,
    importance: 0.7,
    details: { userEmotion: { label, cause, intensity: 0.7 }, howIFelt: '有点心疼' },
  }));
}

test('从人物卡、作息、话头、情绪里推出模型', () => {
  const records = [
    person(),
    ...episodes(6, '疲惫', '加班'),
    rec({
      kind: 'thread',
      ts: '2026-11-07T14:00:00.000Z',
      text: '音色的 bug 还没修',
      details: { status: 'open', what: '音色的 bug 还没修' },
    }),
  ];
  const model = deriveUserModel({ records, now: new Date('2026-11-08T05:00:00.000Z'), tz: 'Asia/Shanghai', maxItems: 8 });
  const keys = model.items.map((item) => item.key);
  assert.ok(keys.includes('identity'));
  assert.ok(keys.includes('preference'));
  assert.ok(keys.includes('boundary'));
  assert.ok(keys.includes('routine'));
  assert.ok(keys.includes('focus'));
  assert.ok(keys.includes('mood'));
  assert.ok(keys.includes('hypothesis:加班'), keys.join(','));

  const identity = model.items.find((item) => item.key === 'identity');
  assert.match(identity?.text ?? '', /爸爸/);
  assert.match(identity?.text ?? '', /主人/);
  const routine = model.items.find((item) => item.key === 'routine');
  assert.equal(routine?.kind, 'pattern');
  assert.match(routine?.text ?? '', /20:00–23:00/);
  const hypothesis = model.items.find((item) => item.kind === 'hypothesis');
  assert.ok((hypothesis?.confidence ?? 1) <= 0.6);
  assert.ok((hypothesis?.evidenceRefs.length ?? 0) >= 2);
});

test('证据不够时不硬编：没有人物/情绪/话头就只有空模型', () => {
  const model = deriveUserModel({
    records: [rec({ kind: 'episode', ts: AT, text: '随便聊聊。' })],
    now: new Date('2026-11-08T05:00:00.000Z'),
  });
  assert.equal(model.items.length, 0);
  assert.equal(renderUserModel(model), '');
});

test('渲染把假设放最后，并带“也许”', () => {
  const records = [person(), ...episodes(6, '疲惫', '加班')];
  const model = deriveUserModel({ records, now: new Date('2026-11-08T05:00:00.000Z'), tz: 'Asia/Shanghai', maxItems: 8 });
  const text = renderUserModel(model);
  assert.match(text, /^【我对他的理解】/);
  const lines = text.split('\n').filter((line) => line.startsWith('- '));
  assert.ok(lines.length >= 2 && lines.length <= 5);
  assert.match(lines[lines.length - 1], /也许/);
  assert.ok(text.length <= 320);
});

test('maxItems 截断时保留假设', () => {
  const records = [person(), ...episodes(6, '疲惫', '加班'),
    rec({ kind: 'thread', ts: '2026-11-07T14:00:00.000Z', text: '音色的 bug 还没修', details: { status: 'open', what: '音色的 bug 还没修' } })];
  const model = deriveUserModel({ records, now: new Date('2026-11-08T05:00:00.000Z'), tz: 'Asia/Shanghai', maxItems: 5 });
  assert.equal(model.items.length, 5);
  assert.ok(model.items.some((item) => item.kind === 'hypothesis'));
});

test('同一份输入 sourceHash 稳定', () => {
  const records = [person(), ...episodes(3, '焦虑', '考试')];
  const a = deriveUserModel({ records, now: new Date('2026-11-08T05:00:00.000Z') });
  const b = deriveUserModel({ records, now: new Date('2026-11-09T05:00:00.000Z') });
  assert.equal(a.sourceHash, b.sourceHash);
});
