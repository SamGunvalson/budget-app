import { COLOR_FAMILIES, SHADE_LABELS, normalizeHex } from '../../constants/palette';

/**
 * Palette grid: one column per color family, one row per shade (pale → deep),
 * so shades of the same hue line up for grouping related categories.
 *
 * Props:
 *  - value: selected hex
 *  - onChange: (hex) => void
 *  - usage: optional Map<hex, string[]> of category names already using a
 *           color; those swatches get a dot and list the names in the tooltip.
 */
export default function ColorPalettePicker({ value, onChange, usage }) {
  const selected = normalizeHex(value);
  return (
    <div
      role="radiogroup"
      aria-label="Color palette"
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${COLOR_FAMILIES.length}, minmax(0, 1fr))` }}
    >
      {SHADE_LABELS.map((shadeLabel, shade) =>
        COLOR_FAMILIES.map((family) => {
          const hex = family.shades[shade];
          const isSelected = selected === hex;
          const users = usage?.get(hex);
          const label = `${family.label} · ${shadeLabel}`;
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={users?.length ? `${label} (used by ${users.join(', ')})` : label}
              title={users?.length ? `${label}\nUsed by: ${users.join(', ')}` : label}
              onClick={() => onChange(hex)}
              className={`relative aspect-square w-full rounded-md transition-transform hover:z-10 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-stone-800 ${
                isSelected ? 'z-10 scale-110 ring-2 ring-stone-900 ring-offset-1 dark:ring-stone-100 dark:ring-offset-stone-800' : ''
              }`}
              style={{ backgroundColor: hex }}
            >
              {users?.length > 0 && (
                <span aria-hidden="true" className="absolute inset-0 m-auto h-1.5 w-1.5 rounded-full bg-white/90 shadow-sm" />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
