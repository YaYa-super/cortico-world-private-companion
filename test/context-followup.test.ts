import assert from 'node:assert/strict';
import { test } from 'node:test';

import { companionDefaults } from '../src/config.ts';
import { buildContextText } from '../src/context.ts';
import { createInitialState } from '../src/state.ts';

test('待复核话头会进入陪伴上下文', () => {
  const cfg = companionDefaults();
  const now = new Date('2026-11-02T20:00:00+08:00');
  const text = buildContextText({
    state: createInitialState(now, 'Asia/Shanghai', cfg),
    profile: undefined,
    profileKey: 'main',
    journal: [],
    cfg,
    tz: 'Asia/Shanghai',
    now,
    memory: {
      rules: [],
      recent: [],
      followup: '视频插件还没做完',
    },
  });
  assert.match(text, /待复核话头/);
  assert.match(text, /视频插件还没做完/);
});
