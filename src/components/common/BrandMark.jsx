/**
 * App logo tile: forest square with three rising gold bars.
 * Decorative — pair it with visible "Budget App" text or an aria-label on the parent.
 */
export default function BrandMark({ className = 'h-9 w-9' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-end justify-center gap-[3px] rounded-xl bg-forest p-2 shadow-md shadow-stone-900/10 ${className}`}
    >
      <b className="h-[30%] w-1 rounded-sm bg-gold" />
      <b className="h-1/2 w-1 rounded-sm bg-gold" />
      <b className="h-[70%] w-1 rounded-sm bg-gold" />
    </span>
  );
}
