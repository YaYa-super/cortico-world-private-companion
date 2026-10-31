import assert from 'node:assert/strict';
import test from 'node:test';

import { checkCompleteness, migrateV1ToV2, type V1Record } from '../src/migration-v2.ts';

const now = '2026-10-29T12:00:00.000Z';
const fixture: V1Record[] = [
  { id: 'n1', kind: 'note', text: '不要在凌晨主动找人', scope: 'main', ts: now, source: 'test' },
  { id: 'n2', kind: 'note', text: '操作前不问，但不做不可逆的事', scope: 'main', ts: now },
  { id: 'p1', kind: 'profile', text: '称呼:主人', scope: 'main', ts: '2026-10-14T00:00:00.000Z' },
  { id: 'p2', kind: 'profile', text: '称呼改为「爸爸」(10-25) 并说「你是我女儿了现在」', scope: 'main', ts: '2026-10-25T00:00:00.000Z' },
  { id: 'p3', kind: 'profile', text: '偏好:平时喜欢我安静少走动', scope: 'main', ts: '2026-10-25T00:00:00.000Z' },
  { id: 'r1', kind: 'reflection', text: '我好像太急着解释了', scope: 'main', ts: now },
  { id: 'c1', kind: 'commitment', text: '答应周末去爬山', scope: 'main', ts: now },
  { id: 'f1', kind: 'fact', text: '主人对花生过敏', scope: 'main', ts: now },
  { id: 'e1', kind: 'episode', text: '交接摘要：一起看了电影', scope: 'main', ts: now, tags: ['handoff-summary'] },
  { id: 'e2', kind: 'episode', text: '[私聊] 爸爸: 晚上好', scope: 'qq:1', ts: now },
  { id: 'x1', kind: 'bogus', text: '未知类型的一条', scope: 'main', ts: now },
];

test('v1 映射：规则/人物/自我/约定/事实/经历', () => {
  const { records, report } = migrateV1ToV2(fixture);
  assert.equal(report.input.total, fixture.length);
  assert.equal(report.output.byKind.rule, 2);
  assert.equal(report.output.byKind.person, 1);
  assert.equal(report.output.byKind.self, 1);
  assert.equal(report.output.byKind.thread, 1);
  assert.equal(report.output.byKind.fact, 2); // 原始 fact + 未知 kind 降级
  assert.equal(report.output.byKind.episode, 2);
  assert.equal(report.merged.fromProfiles, 3);
  assert.equal(report.tagged.recap, 1);
  assert.equal(report.tagged.legacyChat, 1);
  assert.equal(records.filter((record) => record.kind === 'episode' && record.tags.includes('legacy-chat')).length, 1);
});

test('人物合并：称呼历史与偏好', () => {
  const { records } = migrateV1ToV2(fixture);
  const person = records.find((record) => record.kind === 'person')!;
  assert.deepEqual(person.details.aliases, ['主人', '爸爸']);
  assert.ok((person.details.nameHistory as string[]).includes('爸爸'));
  assert.ok((person.details.preferences as string[]).length >= 1);
  assert.match(person.text, /爸爸/);
});

test('幂等：同一输入两次得到相同 id 与相同输出', () => {
  const first = migrateV1ToV2(fixture);
  const second = migrateV1ToV2(fixture);
  assert.deepEqual(first.records.map((record) => record.id), second.records.map((record) => record.id));
  assert.deepEqual(first.records, second.records);
});

test('完整性：原文都能在输出里找到（合并记录按 legacyId 关联）', () => {
  const result = migrateV1ToV2(fixture);
  assert.deepEqual(checkCompleteness(fixture, result), []);
});

test('未知 kind 降级为 fact 并留下 warning', () => {
  const { records, report } = migrateV1ToV2(fixture);
  const unknown = records.find((record) => record.tags.includes('legacy-unknown'))!;
  assert.equal(unknown.kind, 'fact');
  assert.match(unknown.text, /未知类型/);
  assert.ok(report.warnings.length >= 1);
});
