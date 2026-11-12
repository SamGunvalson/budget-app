import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildStatusMap,
  hasNonPostedSelection,
  isAllVisibleSelected,
  nextSelectAll,
  resolveBulkIds,
  visibleSelection,
} from '../src/utils/selectionRules.js';

const rows = (...ids) => ids.map((id) => ({ id }));

// APP-11 — bulk actions only act on selected rows the filters still show.
test('visibleSelection drops selected ids that the filters hide', () => {
  const selected = new Set(['a', 'b', 'c']);
  assert.deepEqual([...visibleSelection(selected, rows('c', 'a', 'x'))], ['c', 'a']);
  assert.deepEqual([...visibleSelection(selected, rows('x', 'y'))], []);
  assert.deepEqual([...visibleSelection(selected, [])], []);
  assert.deepEqual([...visibleSelection(new Set(), rows('a'))], []);
  assert.deepEqual([...visibleSelection(selected, undefined)], []);
});

test('visibleSelection does not mutate the selection', () => {
  const selected = new Set(['a', 'b']);
  const result = visibleSelection(selected, rows('a'));
  assert.notEqual(result, selected);
  assert.deepEqual([...selected], ['a', 'b']);
});

// APP-11 — select-all compares membership, not set size.
test('isAllVisibleSelected is false for a same-size selection of other rows', () => {
  assert.equal(isAllVisibleSelected(new Set(['x', 'y']), rows('a', 'b')), false);
  assert.equal(isAllVisibleSelected(new Set(['a', 'x']), rows('a', 'b')), false);
});

test('isAllVisibleSelected is true when every visible row is selected, even with hidden extras', () => {
  assert.equal(isAllVisibleSelected(new Set(['a', 'b']), rows('a', 'b')), true);
  assert.equal(isAllVisibleSelected(new Set(['a', 'b', 'hidden']), rows('a', 'b')), true);
});

test('isAllVisibleSelected is false when nothing is visible', () => {
  assert.equal(isAllVisibleSelected(new Set(['a']), []), false);
  assert.equal(isAllVisibleSelected(new Set(), []), false);
});

test('nextSelectAll selects the visible rows when a same-size hidden selection exists', () => {
  // Old size-only check cleared here instead of selecting a and b.
  assert.deepEqual([...nextSelectAll(new Set(['x', 'y']), rows('a', 'b'))], ['a', 'b']);
});

test('nextSelectAll clears when every visible row is already selected', () => {
  assert.deepEqual([...nextSelectAll(new Set(['a', 'b']), rows('a', 'b'))], []);
  assert.deepEqual([...nextSelectAll(new Set(['a', 'b', 'hidden']), rows('a', 'b'))], []);
});

test('nextSelectAll selects all visible rows from a partial or empty selection', () => {
  assert.deepEqual([...nextSelectAll(new Set(['a']), rows('a', 'b'))], ['a', 'b']);
  assert.deepEqual([...nextSelectAll(new Set(), rows('a', 'b'))], ['a', 'b']);
});

test('nextSelectAll with no visible rows clears (the Deselect-all path)', () => {
  assert.deepEqual([...nextSelectAll(new Set(['a', 'b']), [])], []);
  assert.deepEqual([...nextSelectAll(new Set(), [])], []);
});

test('resolveBulkIds prefers an explicit id set or array, and ignores anything else', () => {
  const selected = new Set(['a', 'b', 'hidden']);
  assert.deepEqual(resolveBulkIds(selected, new Set(['a', 'b'])), ['a', 'b']);
  assert.deepEqual(resolveBulkIds(selected, ['a']), ['a']);
  assert.deepEqual(resolveBulkIds(selected, new Set()), []);
  assert.deepEqual(resolveBulkIds(selected, undefined), ['a', 'b', 'hidden']);
  // A click event forwarded by onClick must not be mistaken for ids.
  assert.deepEqual(resolveBulkIds(selected, { type: 'click' }), ['a', 'b', 'hidden']);
});

// APP-12 — id→status map replaces a transactions.find per selected id.
test('buildStatusMap maps each id to its status', () => {
  const map = buildStatusMap([
    { id: 'a', status: 'posted' },
    { id: 'b', status: 'pending' },
  ]);
  assert.equal(map.size, 2);
  assert.equal(map.get('a'), 'posted');
  assert.equal(map.get('b'), 'pending');
  assert.equal(buildStatusMap(undefined).size, 0);
});

test('hasNonPostedSelection matches the old find-based result', () => {
  const transactions = [
    { id: 'a', status: 'posted' },
    { id: 'b', status: 'pending' },
    { id: 'c', status: 'projected' },
    { id: 'd', status: 'posted' },
  ];
  const map = buildStatusMap(transactions);
  const legacy = (ids) =>
    Array.from(ids).some((id) => {
      const tx = transactions.find((t) => t.id === id);
      return tx && tx.status !== 'posted';
    });
  for (const ids of [[], ['a'], ['a', 'd'], ['b'], ['a', 'c'], ['missing'], ['missing', 'b'], ['a', 'missing']]) {
    const selected = new Set(ids);
    assert.equal(hasNonPostedSelection(selected, map), Boolean(legacy(selected)), JSON.stringify(ids));
  }
});

test('hasNonPostedSelection ignores ids that are not in the map', () => {
  assert.equal(hasNonPostedSelection(new Set(['gone']), buildStatusMap([])), false);
});
