import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  COLOR_FAMILIES,
  SERIES_COLORS,
  TYPE_COLORS,
  describeColor,
  findPaletteColor,
  nearestPaletteColor,
  normalizeHex,
} from '../src/constants/palette.js';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const cssVar = (scale, step) => css.match(new RegExp(`--color-${scale}-${step}: (#[0-9a-f]{6});`))?.[1];
const SHADE_STEPS = [300, 400, 500, 700];

test('category swatches match the re-tinted Tailwind scales in index.css', () => {
  for (const family of COLOR_FAMILIES) {
    const steps = family.tw === 'stone' ? [300, 400, 500, 600] : SHADE_STEPS;
    family.shades.forEach((hex, i) => {
      assert.equal(cssVar(family.tw, steps[i]), hex, `${family.id} shade ${i} vs ${family.tw}-${steps[i]}`);
    });
  }
});

test('palette swatches are unique lowercase hexes', () => {
  const all = COLOR_FAMILIES.flatMap((f) => f.shades);
  assert.equal(new Set(all).size, all.length);
  for (const hex of [...all, ...SERIES_COLORS]) assert.match(hex, /^#[0-9a-f]{6}$/);
});

test('type colors and series colors come from the palette', () => {
  for (const hex of Object.values(TYPE_COLORS)) assert.ok(findPaletteColor(hex), hex);
  for (const hex of SERIES_COLORS) assert.ok(findPaletteColor(hex), hex);
});

test('old preset colors map to their new family', () => {
  assert.equal(describeColor(nearestPaletteColor('#EC4899')), 'Rose · Mid');
  assert.equal(describeColor(nearestPaletteColor('#3B82F6')), 'Blue · Mid');
  assert.equal(describeColor(nearestPaletteColor('#10B981')), 'Jade · Mid');
  assert.equal(describeColor(nearestPaletteColor('#8B5CF6')), 'Violet · Mid');
});

test('nearestPaletteColor keeps swatches and finds a close family for custom colors', () => {
  assert.equal(nearestPaletteColor('#4F86C6'), '#4f86c6');
  assert.equal(findPaletteColor(nearestPaletteColor('#ff0066')).family.id, 'rose');
  assert.equal(findPaletteColor(nearestPaletteColor('#0077ff')).family.id, 'blue');
  assert.equal(nearestPaletteColor('not-a-color'), 'not-a-color');
});

test('normalizeHex handles case, shorthand, and junk', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex(' #4F86C6 '), '#4f86c6');
  assert.equal(normalizeHex('#4f86c'), null);
  assert.equal(normalizeHex(null), null);
});

test('type dot classes render the same hex as TYPE_COLORS', async () => {
  const { TYPE_DOT_CLASSES } = await import('../src/constants/typeStyles.js');
  for (const type of ['income', 'needs', 'wants', 'savings']) {
    const [, scale, step] = TYPE_DOT_CLASSES[type].match(/^bg-([a-z]+)-(\d+)$/);
    assert.equal(cssVar(scale, step), TYPE_COLORS[type], `${type}: ${TYPE_DOT_CLASSES[type]}`);
  }
});
