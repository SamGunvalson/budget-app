import { useMemo, useRef, useState } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import ColorPalettePicker from '../common/ColorPalettePicker';
import {
  COLOR_FAMILIES,
  describeColor,
  findPaletteColor,
  nearestPaletteColor,
  normalizeHex,
} from '../../constants/palette';

const FAMILY_ORDER = Object.fromEntries(COLOR_FAMILIES.map((f, i) => [f.id, i]));

/** Groups categories by color, ordered by palette family then shade; off-palette last. */
function groupByColor(categories) {
  const groups = new Map();
  for (const c of categories) {
    const hex = normalizeHex(c.color) ?? c.color ?? '';
    if (!groups.has(hex)) groups.set(hex, []);
    groups.get(hex).push(c);
  }
  const rank = (hex) => {
    const m = findPaletteColor(hex);
    return m ? FAMILY_ORDER[m.family.id] * 10 + m.shade : 10_000;
  };
  return [...groups.entries()]
    .map(([hex, items]) => ({ hex, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => rank(a.hex) - rank(b.hex) || a.hex.localeCompare(b.hex));
}

/**
 * Manage category colors in bulk: see which categories share a color,
 * recolor a whole group at once, and move old colors onto the palette.
 *
 * Props:
 *  - categories: active categories
 *  - onRecolor: async (Array<{ id, color }>) => void
 *  - onClose: () => void
 */
export default function CategoryColorsModal({ categories, onRecolor, onClose }) {
  const [editingHex, setEditingHex] = useState(null);
  const [busy, setBusy] = useState(false);
  // Synchronous guard: a second swatch click can land before `busy` renders,
  // and two overlapping group saves would finish in arbitrary order.
  const inFlight = useRef(false);
  const [error, setError] = useState('');

  const groups = useMemo(() => groupByColor(categories), [categories]);
  const offPalette = groups.filter((g) => !findPaletteColor(g.hex));
  const usage = useMemo(
    () => new Map(groups.map((g) => [g.hex, g.items.map((c) => c.name)])),
    [groups],
  );

  const run = async (updates) => {
    if (updates.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await onRecolor(updates);
      setEditingHex(null);
    } catch (err) {
      setError(err?.message || 'Some colors could not be updated.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const recolorGroup = (group, hex) =>
    run(group.items.filter((c) => normalizeHex(c.color) !== hex).map((c) => ({ id: c.id, color: hex })));

  const updateOffPalette = () =>
    run(
      offPalette.flatMap((g) =>
        g.items.map((c) => ({ id: c.id, color: nearestPaletteColor(c.color) })),
      ),
    );

  return (
    <Modal title="Category Colors" onClose={() => { if (!busy) onClose(); }} wide>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
        Categories that share a color are listed together. Change a group&apos;s color to recolor every
        category in it.
      </p>

      {offPalette.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200/60 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-900/20">
          <p className="text-sm font-medium text-stone-800 dark:text-stone-100">
            {offPalette.length} {offPalette.length === 1 ? 'color is' : 'colors are'} not in the palette
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {offPalette.map((g) => {
              const next = nearestPaletteColor(g.hex);
              return (
                <span key={g.hex} className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
                  <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: g.hex }} />
                  <span aria-hidden="true">→</span>
                  <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: next }} />
                  {describeColor(next)}
                  <span className="text-stone-500 dark:text-stone-400">({g.items.length})</span>
                </span>
              );
            })}
          </div>
          <Button size="sm" className="mt-3" disabled={busy} onClick={updateOffPalette}>
            {busy ? 'Updating…' : 'Update to closest palette colors'}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <ul className="divide-y divide-stone-200/60 dark:divide-stone-700/60">
        {groups.map((g) => (
          <li key={g.hex} className="py-3">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 shrink-0 rounded-lg shadow-sm" style={{ backgroundColor: g.hex }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                  {describeColor(g.hex)}
                  <span className="ml-1.5 font-normal text-stone-500 dark:text-stone-400">· {g.items.length}</span>
                </p>
                <p className="truncate text-xs text-stone-600 dark:text-stone-300">
                  {g.items.map((c) => c.name).join(', ')}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-expanded={editingHex === g.hex}
                onClick={() => setEditingHex(editingHex === g.hex ? null : g.hex)}
              >
                {editingHex === g.hex ? 'Done' : 'Change'}
              </Button>
            </div>
            {editingHex === g.hex && (
              <div className="mt-3">
                <ColorPalettePicker value={g.hex} usage={usage} disabled={busy} onChange={(hex) => recolorGroup(g, hex)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
