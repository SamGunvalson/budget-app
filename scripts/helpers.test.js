import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  CATEGORY_TYPE_LABELS,
  CATEGORY_TYPE_ORDER,
  toDateString,
} from '../src/utils/helpers.js';

test('shared category order and labels preserve all five UI groups', () => {
  assert.deepEqual(CATEGORY_TYPE_ORDER, ['income', 'needs', 'wants', 'savings', 'transfer']);
  assert.deepEqual(CATEGORY_TYPE_ORDER.map((type) => CATEGORY_TYPE_LABELS[type]),
    ['Income', 'Needs', 'Wants', 'Savings', 'Transfer']);
});

test('local date formatting pads fields and preserves leap days', () => {
  assert.equal(toDateString(new Date(2024, 1, 29, 23, 59)), '2024-02-29');
  assert.equal(toDateString(new Date(2026, 0, 2)), '2026-01-02');
});

for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
  test(`local date formatting and tomorrow calculation preserve boundaries in ${timezone}`, () => {
    const moduleUrl = new URL('../src/utils/helpers.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { toDateString } from ${JSON.stringify(moduleUrl)};
      assert.equal(toDateString(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
      assert.equal(toDateString(new Date(2026, 0, 1, 23, 55)), '2026-01-01');
      for (const [year, month, day, expected] of [
        [2026, 11, 31, '2027-01-01'],
        [2024, 1, 28, '2024-02-29'],
        [2024, 1, 29, '2024-03-01'],
        [2026, 2, 8, '2026-03-09'],
        [2026, 10, 1, '2026-11-02'],
      ]) {
        const date = new Date(year, month, day, 12);
        date.setDate(date.getDate() + 1);
        assert.equal(toDateString(date), expected);
      }
    `], { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}
