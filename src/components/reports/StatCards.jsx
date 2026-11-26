/**
 * Row of report stat cards. The first card is the forest summary card (the
 * headline number); the rest are plain panels with ink figures.
 *
 * @param {{
 *   cards: Array<{
 *     label: string,
 *     value: string,
 *     sub?: string,
 *     negative?: boolean,   // headline is a bad outcome (peach on forest, red on panels)
 *   }>,
 * }} props
 */
export default function StatCards({ cards }) {
  const [hero, ...rest] = cards;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6">
      <div
        className="col-span-2 flex min-w-0 animate-fade-in-up flex-col justify-between rounded-2xl bg-forest p-5 text-[#fbfcf2] shadow-lg shadow-stone-900/10 sm:col-span-1 sm:p-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]">{hero.label}</p>
        <p className={`mt-2 break-words font-display text-4xl font-normal leading-none tracking-tight sm:text-[2.75rem] ${hero.negative ? 'text-[#f5b887]' : ''}`}>
          {hero.value}
        </p>
        {hero.sub && <p className="mt-2 text-xs text-[#daeadc]">{hero.sub}</p>}
      </div>
      {rest.map((card, i) => (
        <div
          key={card.label}
          className="min-w-0 animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-700/60 dark:bg-stone-800"
          style={{ animationDelay: `${(i + 1) * 80}ms` }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">{card.label}</p>
          <p className={`mt-2 break-words text-xl font-bold tabular-nums sm:text-2xl ${card.negative ? 'text-red-600 dark:text-red-400' : 'text-stone-900 dark:text-stone-100'}`}>
            {card.value}
          </p>
          {card.sub && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{card.sub}</p>}
        </div>
      ))}
    </div>
  );
}
