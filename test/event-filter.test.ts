import assert from 'node:assert/strict';
import test from 'node:test';

import { isHumanEvent, scopeOfEvent } from '../src/event-filter.ts';

const base = {
  origin: 'external',
  source: 'onebot',
  senderKey: '1021036873',
  text: '[私聊] 爸爸: 晚上好',
};

test('只放行人说的话', () => {
  assert.equal(isHumanEvent(base), true);
  assert.equal(isHumanEvent({ ...base, origin: 'internal' }), false);
  assert.equal(isHumanEvent({ ...base, senderKey: 'desktop-pet.self' }), false);
  assert.equal(isHumanEvent({ ...base, senderKey: 'desktop-pet.touch' }), false);
  assert.equal(isHumanEvent({ ...base, source: 'persona' }), false);
  assert.equal(isHumanEvent({ ...base, source: 'console' }), false);
  assert.equal(isHumanEvent({ ...base, source: 'bilibili' }), false);
  assert.equal(isHumanEvent({ ...base, text: '[系统] 已连接' }), false);
  assert.equal(isHumanEvent({ ...base, text: '[notice/notify/input_status] {"x":1}' }), false);
  assert.equal(isHumanEvent({ ...base, meta: { kind: 'activity' } }), false);
  assert.equal(isHumanEvent({ ...base, meta: { kind: 'delivered' } }), false);
});

test('桌宠世界只认打字/语音/聊天', () => {
  const pet = { origin: 'external', source: 'desktop-pet', text: '爸爸: 在吗' };
  assert.equal(isHumanEvent({ ...pet, senderKey: 'desktop-pet.text' }), true);
  assert.equal(isHumanEvent({ ...pet, senderKey: 'desktop-pet.voice' }), true);
  assert.equal(isHumanEvent({ ...pet, senderKey: 'desktop-pet.self' }), false);
  assert.equal(isHumanEvent({ ...pet, senderKey: '' }), false);
});

test('scope 统一 qq:<号>', () => {
  assert.equal(scopeOfEvent({ senderKey: '1021036873' }), 'qq:1021036873');
  assert.equal(scopeOfEvent({ senderKey: 'desktop-pet.text', source: 'desktop-pet' }), 'desktop-pet.text');
  assert.equal(scopeOfEvent({ source: 'onebot' }), 'onebot');
});
