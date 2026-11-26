/**
 * Empty-state block: soft icon well, a short title, an optional hint and an
 * optional action. Use inside the page's own panel or on the page background.
 */
export default function EmptyState({ icon, title, hint, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      {icon && (
        <div aria-hidden="true" className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-500 dark:bg-stone-700/60 dark:text-stone-400 [&>svg]:h-7 [&>svg]:w-7">
          {icon}
        </div>
      )}
      <p className="font-display text-xl font-medium text-stone-900 dark:text-stone-100">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-stone-500 dark:text-stone-400">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
