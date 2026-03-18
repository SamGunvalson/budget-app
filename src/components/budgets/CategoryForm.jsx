import { useState } from 'react';

const TYPE_OPTIONS = [
  {
    value: 'income',
    label: 'Income',
    description: 'Salary, freelance, and other earnings',
    color: '#10B981',
  },
  {
    value: 'needs',
    label: 'Needs',
    description: 'Essentials like rent, groceries, utilities',
    color: '#EF4444',
  },
  {
    value: 'wants',
    label: 'Wants',
    description: 'Discretionary spending like dining and entertainment',
    color: '#EC4899',
  },
  {
    value: 'savings',
    label: 'Savings',
    description: 'Goals, emergency fund, investments',
    color: '#14B8A6',
  },
  {
    value: 'transfer',
    label: 'Transfer',
    description: 'Move money between accounts — won\'t affect budget totals',
    color: '#64748B',
  },
];

const PRESET_COLORS = [
  '#EF4444', // red
  '#EC4899', // pink
  '#F59E0B', // amber
  '#10B981', // emerald
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#3B82F6', // blue
  '#84CC16', // lime
  '#64748B', // slate
];

/**
 * CategoryForm – used for both creating and editing a category.
 *
 * Props:
 *  - initialValues: { name, type, color }  (for edit mode)
 *  - onSubmit: async (values) => void
 *  - onCancel: () => void
 *  - isEditing: boolean
 */
function CategoryForm({ initialValues, onSubmit, onCancel, isEditing = false }) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [type, setType] = useState(initialValues?.type ?? 'income');
  const [color, setColor] = useState(initialValues?.color ?? '#10B981');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Category name is required.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), type, color });
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
              onClick={() => setType(opt.value)}
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
      <div className="space-y-2">
        <span className="block text-sm font-medium text-stone-700 dark:text-stone-300">Color</span>

        {/* Preset swatches */}
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-lg border-2 transition-transform hover:scale-110 ${
                color === c ? 'border-stone-800 scale-110 dark:border-stone-200' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Custom hex input */}
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-9 cursor-pointer rounded-lg border border-stone-300 bg-stone-50/50 p-0.5 dark:border-stone-600 dark:bg-stone-700/50"
          />
          <input
            type="text"
            value={color}
            onChange={(e) => {
              const val = e.target.value;
              if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) setColor(val);
            }}
            maxLength={7}
            className="w-28 rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 text-sm font-mono text-stone-900 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            placeholder="#3B82F6"
          />
          {/* Live preview */}
          <span className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            Preview
            <span
              className="inline-flex h-5 w-14 rounded-full"
              style={{ backgroundColor: color }}
            />
          </span>
        </div>
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
          className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
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
