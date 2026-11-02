import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixedHolidays } from '../src/holidays.ts';

test('固定公历节日有元旦/劳动节/国庆', () => {
  const holidays = fixedHolidays(2026);
  assert.equal(holidays['2026-01-01'], '元旦');
  assert.equal(holidays['2026-05-01'], '劳动节');
  assert.equal(holidays['2026-10-01'], '国庆节');
});
