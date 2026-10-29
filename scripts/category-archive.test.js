import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  budgetCategoryIds,
  categoriesForBudget,
  categoryLabel,
  isAvailableCategory,
  resolveCategoryId,
  selectableCategories,
} from '../src/utils/categoryArchive.js';

const active = { id: 'active', name: 'Current', type: 'needs', is_active: true };
const archived = { id: 'archived', name: 'Old', type: 'income', is_active: true, is_archived: true };
const deleted = { id: 'deleted', name: 'Deleted', type: 'wants', is_active: false };
const transfer = { id: 'transfer', name: 'Transfer', type: 'transfer' };
const categories = [active, archived, deleted, transfer];

test('new choices exclude archived/deleted categories and accept old cached rows', () => {
  assert.equal(isAvailableCategory(active), true);
  assert.equal(isAvailableCategory(archived), false);
  assert.equal(isAvailableCategory(deleted), false);
  assert.deepEqual(selectableCategories(categories), [active, transfer]);
});

test('an original archived selection remains available without restoring it', () => {
  assert.deepEqual(selectableCategories(categories, ['archived', 'deleted']), [active, archived, transfer]);
  assert.equal(categoryLabel(archived), 'Old (Archived)');
  assert.equal(categoryLabel(active), 'Current');
  assert.equal(archived.is_archived, true);
});

test('unused years exclude archived categories and transfers', () => {
  assert.deepEqual(categoriesForBudget(categories, {}), [active]);
  assert.deepEqual(categoriesForBudget(categories, { 1: { allocations: { deleted: 500 } } }), [active]);
});

test('a stale selected category requires a choice instead of silently falling back', () => {
  const choices = selectableCategories(categories);
  assert.equal(resolveCategoryId(choices, 'archived'), '');
  assert.equal(resolveCategoryId(choices, 'active'), 'active');
  assert.equal(resolveCategoryId(choices, ''), 'active');
  assert.equal(resolveCategoryId([], ''), '');
});

test('any saved allocation retains an archived category throughout its budget year', () => {
  const year = { 1: { allocations: { archived: 0 } }, 6: { allocations: { active: 500 } } };
  assert.deepEqual([...budgetCategoryIds(year)], ['archived', 'active']);
  assert.deepEqual(categoriesForBudget(categories, year), [active, archived]);
  assert.deepEqual(categoriesForBudget(categories, { 1: { allocations: {} } }), [active]);
});
