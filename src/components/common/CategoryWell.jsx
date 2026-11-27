import { CATEGORY_FALLBACK_COLOR } from '../../constants/chartColors';

/** Rounded square tinted with the category color, showing its initial. */
export default function CategoryWell({ category, className = 'h-9 w-9 text-sm' }) {
  const color = category?.color || CATEGORY_FALLBACK_COLOR;
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-xl font-bold ${className}`}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
    >
      {(category?.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}
