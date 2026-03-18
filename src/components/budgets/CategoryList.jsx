const TYPE_LABELS = {
  income: { label: 'Income', description: 'Salary, freelance & other earnings' },
  needs: { label: 'Needs', description: 'Essential expenses' },
  wants: { label: 'Wants', description: 'Discretionary spending' },
  savings: { label: 'Savings', description: 'Goals & investments' },
  transfer: { label: 'Transfer', description: 'Non-budgeting — money moving between accounts' },
};

const TYPE_ORDER = ['income', 'needs', 'wants', 'savings', 'transfer'];

/**
 * CategoryList – renders categories grouped by type.
 *
 * Props:
 *  - categories: Array of category objects
 *  - onEdit: (category) => void
 *  - onDelete: (category) => void
 *  - deletingId: string | null  (id currently being soft-deleted)
 */
function CategoryList({ categories = [], onEdit, onDelete, deletingId }) {
  if (categories.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center dark:border-stone-600 dark:bg-stone-800">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-700">
          <svg
            className="h-7 w-7 text-stone-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 6h.008v.008H6V6z"
            />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-900 dark:text-stone-100">No categories yet</p>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Create your first category to start budgeting.
        </p>
      </div>
    );
  }

  // Group by type preserving order
  const grouped = TYPE_ORDER.reduce((acc, t) => {
    const items = categories.filter((c) => c.type === t);
    if (items.length > 0) acc[t] = items;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {Object.entries(grouped).map(([typeKey, items]) => {
        const meta = TYPE_LABELS[typeKey];
        return (
          <div key={typeKey}>
            {/* Group Header */}
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{meta.label}</h3>
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                {items.length}
              </span>
              <span className="text-sm text-stone-400 dark:text-stone-500">{meta.description}</span>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((category) => (
                <div
                  key={category.id}
                  className="group flex items-center justify-between rounded-xl border border-stone-200/60 bg-white p-4 shadow-sm shadow-stone-200/30 transition-all hover:shadow-md hover:shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50 dark:hover:shadow-stone-900/60"
                >
                  {/* Left: color swatch + name */}
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span
                      className="h-9 w-9 flex-shrink-0 rounded-xl shadow-sm"
                      style={{ backgroundColor: category.color }}
                      aria-label={`Color ${category.color}`}
                    />
                    <div className="overflow-hidden">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                          {category.name}
                        </p>
                        {category.type === 'transfer' && (
                          <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500 dark:bg-stone-700 dark:text-stone-400">
                            Non-budgeting
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-stone-400 dark:text-stone-500">{category.color}</p>
                    </div>
                  </div>

                  {/* Right: action buttons */}
                  <div className="ml-3 flex flex-shrink-0 items-center gap-1">
                    {/* Edit */}
                    <button
                      type="button"
                      onClick={() => onEdit(category)}
                      title="Edit category"
                      className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-amber-50 hover:text-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.8}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                        />
                      </svg>
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => onDelete(category)}
                      disabled={deletingId === category.id}
                      title="Delete category"
                      className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    >
                      {deletingId === category.id ? (
                        <svg
                          className="h-4 w-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.8}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CategoryList;
