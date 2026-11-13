import test from 'node:test';
import assert from 'node:assert/strict';

import { COMPANION_CONFIG_GROUP } from '../src/config.ts';

test('小数配置直接用原值显示，不用 x-scale 做百分制', () => {
  const props = COMPANION_CONFIG_GROUP.schema.properties;
  for (const key of [
    'worlds.companion.proactiveClinginess',
    'worlds.companion.mergeSimilarity',
  ]) {
    const prop = props[key] as Record<string, unknown>;
    assert.equal(prop['x-scale'], undefined, `${key} 不应有 x-scale`);
    assert.equal(prop.multipleOf, 0.05, `${key} 的步进应为 0.05`);
  }
});
