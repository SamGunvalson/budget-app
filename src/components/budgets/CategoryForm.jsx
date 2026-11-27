import { useMemo, useState } from 'react';
import ColorPalettePicker from '../common/ColorPalettePicker';
import {
  DEFAULT_CATEGORY_COLOR,
  TYPE_COLORS,
  describeColor,
  findPaletteColor,
  nearestPaletteColor,
  normalizeHex,
} from '../../constants/palette';

const TYPE_OPTIONS = [
  {
    value: 'income',
    label: 'Income',
    description: 'Salary, freelance, and other earnings',
    color: TYPE_COLORS.income,
  },
  {
    value: 'needs',
    label: 'Needs',
    description: 'Essentials like rent, groceries, utilities',
    color: TYPE_COLORS.needs,
  },
  {
    value: 'wants',
    label: 'Wants',
    description: 'Discretionary spending like dining and entertainment',
    color: TYPE_COLORS.wants,
  },
  {
    value: 'savings',
    label: 'Savings',
    description: 'Goals, emergency fund, investments',
    color: TYPE_COLORS.savings,
  },
  {
    value: 'transfer',
    label: 'Transfer',
    description: 'Move money between accounts — won\'t affect budget totals',
    color: TYPE_COLORS.transfer,
  },
];

/**
 * CategoryForm – used for both creating and editing a category.
 *
 * Props:
 *  - initialValues: { name, type, color }  (for edit mode)
 *  - onSubmit: async (values) => void
 *  - onCancel: () => void
 *  - isEditing: boolean
 *  - categories: all categories, to show which already share a color
 */
function CategoryForm({ initialValues, onSubmit, onCancel, isEditing = false, categories = [] }) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [type, setType] = useState(initialValues?.type ?? 'income');
  const [color, setColor] = useState(initialValues?.color ?? DEFAULT_CATEGORY_COLOR);
  // New categories follow the type's color until a color is picked.
  const [colorTouched, setColorTouched] = useState(Boolean(initialValues?.color));
  const pickColor = (hex) => { setColor(hex); setColorTouched(true); };
  const pickType = (value) => {
    setType(value);
    if (!colorTouched) setColor(TYPE_COLORS[value] ?? DEFAULT_CATEGORY_COLOR);
  };

  // hex → names of the other (non-archived) categories using it.
  const usage = useMemo(() => {
    const map = new Map();
    for (const c of categories) {
      if (c.id === initialValues?.id || c.is_archived) continue;
      const hex = normalizeHex(c.color);
      if (!hex) continue;
      if (!map.has(hex)) map.set(hex, []);
      map.get(hex).push(c.name);
    }
    return map;
  }, [categories, initialValues?.id]);
  const customInUse = useMemo(
    () => [...usage.entries()].filter(([hex]) => !findPaletteColor(hex)),
    [usage],
  );
  const sharedWith = usage.get(normalizeHex(color)) ?? [];
  const inPalette = Boolean(findPaletteColor(color));
  const suggestion = normalizeHex(color) ? nearestPaletteColor(color) : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Category name is required.');
      return;
    }
    if (!normalizeHex(color)) {
      setError('Pick a color, or enter a full hex value like #4f86c6.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), type, color: normalizeHex(color) });
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <label
          htmlFor="category-name"
          className="block text-sm font-medium text-stone-700 dark:text-stone-300"
        >
          Category Name
        </label>
        <input
          id="category-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Groceries"
          required
          maxLength={50}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
        />
      </div>

      {/* Type */}
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-stone-700 dark:text-stone-300">Type</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => pickType(opt.value)}
              className={`flex flex-col items-start rounded-xl border-2 p-3 text-left transition-all ${
                type === opt.value
                  ? 'border-amber-500 bg-amber-50 shadow-sm dark:bg-amber-900/30'
                  : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:hover:border-stone-600 dark:hover:bg-stone-700'
              }`}
            >
              <span
                className="mb-1.5 inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: opt.color }}
              />
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{opt.label}</span>
              <span className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Picker */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="block text-sm font-medium text-stone-700 dark:text-stone-300">Color</span>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            Dots mark colors already in use
          </span>
        </div>

        <ColorPalettePicker value={color} onChange={pickColor} usage={usage} />

        {/* Selected color + who else uses it */}
        <div className="flex items-start gap-3 rounded-xl border border-stone-200/60 bg-stone-50/60 p-3 dark:border-stone-700/60 dark:bg-stone-900/30">
          <span className="mt-0.5 h-8 w-8 shrink-0 rounded-lg shadow-sm" style={{ backgroundColor: color }} />
          <div className="min-w-0 flex-1 text-xs">
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">{describeColor(color)}</p>
            {sharedWith.length > 0 ? (
              <p className="mt-0.5 text-stone-600 dark:text-stone-300">
                Grouped with {sharedWith.join(', ')}
              </p>
            ) : (
              <p className="mt-0.5 text-stone-500 dark:text-stone-400">No other category uses this color</p>
            )}
            {!inPalette && suggestion && (
              <button
                type="button"
                onClick={() => pickColor(suggestion)}
                className="mt-1.5 inline-flex items-center gap-1.5 font-medium text-amber-700 hover:underline dark:text-amber-400"
              >
                Not in the palette. Use closest match
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: suggestion }} />
                {describeColor(suggestion)}
              </button>
            )}
          </div>
        </div>

        {/* Off-palette colors other categories use, so they can still be matched */}
        {customInUse.length > 0 && (
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-stone-500 dark:text-stone-400">Other colors in use</span>
            <div className="flex flex-wrap gap-1.5">
              {customInUse.map(([hex, names]) => (
                <button
                  key={hex}
                  type="button"
                  title={`${hex}\nUsed by: ${names.join(', ')}`}
                  aria-label={`${hex} (used by ${names.join(', ')})`}
                  onClick={() => pickColor(hex)}
                  className={`h-7 w-7 rounded-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                    normalizeHex(color) === hex ? 'scale-110 ring-2 ring-stone-900 ring-offset-1 dark:ring-stone-100 dark:ring-offset-stone-800' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Custom color */}
        <details className="group">
          <summary className="cursor-pointer select-none text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200">
            Custom color
          </summary>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="color"
              value={normalizeHex(color) ?? '#000000'}
              onChange={(e) => pickColor(e.target.value)}
              aria-label="Pick a custom color"
              className="h-9 w-9 cursor-pointer rounded-lg border border-stone-300 bg-stone-50/50 p-0.5 dark:border-stone-600 dark:bg-stone-700/50"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => {
                const val = e.target.value;
                if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) pickColor(val);
              }}
              maxLength={7}
              aria-label="Hex color"
              className="w-28 rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 font-mono text-sm text-stone-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
              placeholder="#4f86c6"
            />
          </div>
        </details>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            <span className="mr-1.5">⚠</span>
            {error}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-stone-950 shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {isSubmitting
            ? isEditing
              ? 'Saving…'
              : 'Creating…'
            : isEditing
            ? 'Save Changes'
            : 'Create Category'}
        </button>
      </div>
    </form>
  );
}

export default CategoryForm;
