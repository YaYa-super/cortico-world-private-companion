import assert from 'node:assert/strict';
import { test } from 'node:test';

import { weatherTrigger, weatherText, type WeatherSnapshot } from '../src/weather.ts';

const base: WeatherSnapshot = {
  at: '2026-11-02T12:00:00.000Z',
  city: '杭州',
  latitude: 30,
  longitude: 120,
  temperature: 22,
  precipitation: 0,
  weatherCode: 0,
  windSpeed: 3,
};

test('开始下雨时触发一次', () => {
  const rain = { ...base, weatherCode: 61, precipitation: 1 };
  assert.equal(weatherTrigger(base, rain, '2026-11-02')?.key, 'weather:rain:2026-11-02');
  assert.equal(weatherTrigger(rain, { ...rain, at: '2026-11-02T12:30:00.000Z' }, '2026-11-02'), null);
});

test('明显降温会触发', () => {
  const cold = { ...base, temperature: 15, at: '2026-11-02T18:00:00.000Z' };
  assert.equal(weatherTrigger(base, cold, '2026-11-02')?.key, 'weather:cool:2026-11-02');
});

test('高温/低温有独立触发', () => {
  assert.equal(weatherTrigger(base, { ...base, temperature: 36 }, '2026-11-02')?.key, 'weather:heat:2026-11-02');
  assert.equal(weatherTrigger(base, { ...base, temperature: -2 }, '2026-11-02')?.key, 'weather:cold:2026-11-02');
});

test('天气码有中文文案', () => {
  assert.equal(weatherText(61), '小雨');
  assert.equal(weatherText(999), '天气码 999');
});
