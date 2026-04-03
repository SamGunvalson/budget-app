import { useState } from 'react';
import Modal from '../common/Modal';

/**
 * BulkEditModal — apply field changes to all transactions in a group.
 *
 * Only fields the user actually touches are applied. Fields left at "no change"
 * are excluded from the update payload.
 *
 * Props:
 *  - transactions: Transaction[] — the group children to update
 *  - categories: Category[] — full category list for the dropdown
 *  - onSubmit(fields): called with the changed fields object
 *  - onCancel(): close without saving
 */
export default function BulkEditModal({ transactions, categories, onSubmit, onCancel }) {
  const count = transactions.length;

  // Track which fields are "touched" (user opted to change them)
  const [touched, setTouched] = useState({ category_id: false, status: false, description: false });
  const [fields, setFields] = useState({ category_id: '', status: 'posted', description: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggle = (field) =>
    setTouched((prev) => ({ ...prev, [field]: !prev[field] }));

  const set = (field, value) =>
    setFields((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    if (touched.category_id && fields.category_id) payload.category_id = fields.category_id;
    if (touched.status) payload.status = fields.status;
    if (touched.description) payload.description = fields.description;
    if (Object.keys(payload).length === 0) { onCancel(); return; }
    setIsSubmitting(true);
    try {
      await onSubmit(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoryOptions = (categories || []).map((c) => ({
    value: c.id,
    label: `${c.name} (${c.type})`,
  }));

  return (
    <Modal title={`Edit ${count} Transaction${count !== 1 ? 's' : ''}`} onClose={onCancel}>
      <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
        Check a field to apply it to all {count} transactions in this group. Unchecked fields will not be changed.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Category */}
        <div className="flex items-start gap-3">
          <input
            id="bulk-category-toggle"
            type="checkbox"
            checked={touched.category_id}
            onChange={() => toggle('category_id')}
            className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
          />
          <div className="flex-1">
            <label htmlFor="bulk-category-toggle" className="block text-sm font-medium text-stone-700 dark:text-stone-300 cursor-pointer select-none">
              Category
            </label>
            <select
              value={fields.category_id}
              onChange={(e) => { set('category_id', e.target.value); setTouched((p) => ({ ...p, category_id: true })); }}
              disabled={!touched.category_id}
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-700 dark:text-stone-100"
            >
              <option value="">— select category —</option>
              {categoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-start gap-3">
          <input
            id="bulk-status-toggle"
            type="checkbox"
            checked={touched.status}
            onChange={() => toggle('status')}
            className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
          />
          <div className="flex-1">
            <label htmlFor="bulk-status-toggle" className="block text-sm font-medium text-stone-700 dark:text-stone-300 cursor-pointer select-none">
              Status
            </label>
            <select
              value={fields.status}
              onChange={(e) => { set('status', e.target.value); setTouched((p) => ({ ...p, status: true })); }}
              disabled={!touched.status}
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-700 dark:text-stone-100"
            >
              <option value="posted">Posted</option>
              <option value="pending">Pending</option>
              <option value="projected">Projected</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div className="flex items-start gap-3">
          <input
            id="bulk-desc-toggle"
            type="checkbox"
            checked={touched.description}
            onChange={() => toggle('description')}
            className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
          />
          <div className="flex-1">
            <label htmlFor="bulk-desc-toggle" className="block text-sm font-medium text-stone-700 dark:text-stone-300 cursor-pointer select-none">
              Description
            </label>
            <input
              type="text"
              value={fields.description}
              onChange={(e) => { set('description', e.target.value); setTouched((p) => ({ ...p, description: true })); }}
              disabled={!touched.description}
              placeholder="Enter description…"
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-700 dark:text-stone-100 dark:placeholder-stone-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !Object.values(touched).some(Boolean)}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Saving…' : `Apply to ${count}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
