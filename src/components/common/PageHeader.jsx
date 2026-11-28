/**
 * Standard page header: small uppercase eyebrow, serif title, optional
 * description, and actions (children) on the right.
 *
 * Mobile actions belong in `usePageActions`; give header buttons that
 * duplicate them `mobile:hidden`.
 */
export default function PageHeader({ eyebrow, title, description, children, className = 'mb-8' }) {
  return (
    <header className={`animate-fade-in flex flex-wrap items-end justify-between gap-x-6 gap-y-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl font-medium leading-tight tracking-tight text-stone-900 sm:text-4xl dark:text-stone-100">
          {title}
        </h1>
        {description && <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{description}</p>}
      </div>
      {children && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2 sm:gap-3">{children}</div>}
    </header>
  );
}

