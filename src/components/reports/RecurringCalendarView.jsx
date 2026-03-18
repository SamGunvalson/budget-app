import { useState, useMemo } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  format,
  isSameMonth,
  isToday,
  startOfDay,
} from 'date-fns';
import { getOccurrencesInRange } from '../../utils/recurringCalculations';
import { formatCurrency } from '../../utils/helpers';

const CHIP_LIMIT = 3;

/**
 * RecurringCalendarView — monthly calendar grid showing recurring occurrence chips.
 *
 * Props:
 *  - templates: array of recurring_template rows (with categories, accounts joined)
 *  - onEdit(template): open standalone template edit modal
 *  - onEditGroup(template): open group template edit modal
 */
export default function RecurringCalendarView({ templates, onEdit, onEditGroup }) {
  const today = startOfDay(new Date());
  const [calendarMonth, setCalendarMonth] = useState(startOfMonth(today));
  const [expandedDays, setExpandedDays] = useState(new Set());

  const toggleDayExpand = (key) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const gridDays = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const isCurrentMonth =
    format(calendarMonth, 'yyyy-MM') === format(today, 'yyyy-MM');

  // Build dateStr → occurrence items map for the visible month
  const occurrencesByDay = useMemo(() => {
    const map = new Map();
    for (const t of templates) {
      const dates = getOccurrencesInRange(t, monthStart, monthEnd);
      for (const d of dates) {
        const key = format(d, 'yyyy-MM-dd');
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({
          templateId: t.id,
          description: t.description,
          amount: t.amount,
          is_income: t.is_income,
          is_transfer: t.is_transfer,
          is_group: t.is_group_parent,
          categoryColor: t.categories?.color || '#8B5CF6',
        });
      }
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, calendarMonth]);

  const handleChipClick = (e, item) => {
    e.stopPropagation();
    const template = templates.find((t) => t.id === item.templateId);
    if (!template) return;
    if (template.is_group_parent && onEditGroup) {
      onEditGroup(template);
    } else if (onEdit) {
      onEdit(template);
    }
  };

  return (
    <div className="px-1">
      {/* Month navigation */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setCalendarMonth((m) => subMonths(m, 1)); setExpandedDays(new Set()); }}
            aria-label="Previous month"
            className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="min-w-36 text-center text-sm font-semibold text-stone-900 dark:text-stone-100">
            {format(calendarMonth, 'MMMM yyyy')}
          </span>
          <button
            type="button"
            onClick={() => { setCalendarMonth((m) => addMonths(m, 1)); setExpandedDays(new Set()); }}
            aria-label="Next month"
            className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => { setCalendarMonth(startOfMonth(today)); setExpandedDays(new Set()); }}
          disabled={isCurrentMonth}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 shadow-sm transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:cursor-default disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Today
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="mb-1 grid grid-cols-7">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="py-1 text-center text-xs font-medium text-stone-400 dark:text-stone-500"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 dark:border-stone-700 dark:bg-stone-700">
        {gridDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, calendarMonth);
          const isCurrentDay = isToday(day);
          const items = occurrencesByDay.get(key) || [];
          const isExpanded = expandedDays.has(key);
          const visible = isExpanded ? items : items.slice(0, CHIP_LIMIT);
          const overflow = isExpanded ? 0 : items.length - CHIP_LIMIT;

          return (
            <div
              key={key}
              className={`flex min-h-22 flex-col gap-0.5 p-1.5 ${
                inMonth
                  ? isCurrentDay
                    ? 'bg-amber-50 dark:bg-amber-950/30'
                    : 'bg-white dark:bg-stone-800'
                  : 'bg-stone-50 dark:bg-stone-900/50'
              }`}
            >
              {/* Day number */}
              <span
                className={`mb-0.5 self-end text-xs font-medium leading-none ${
                  isCurrentDay
                    ? 'flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white'
                    : inMonth
                      ? 'text-stone-700 dark:text-stone-300'
                      : 'text-stone-300 dark:text-stone-600'
                }`}
              >
                {format(day, 'd')}
              </span>

              {/* Occurrence chips */}
              {visible.map((item, i) => (
                <button
                  key={`${item.templateId}-${i}`}
                  type="button"
                  onClick={(e) => handleChipClick(e, item)}
                  title={`${item.description} · ${
                    item.is_transfer ? '' : item.is_income ? '+' : '−'
                  }${formatCurrency(Math.abs(item.amount))}`}
                  className="w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium leading-tight text-white transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-white focus:ring-offset-1"
                  style={{ backgroundColor: item.categoryColor }}
                >
                  {item.description}
                  <span className="ml-0.5 opacity-90">
                    {item.is_transfer
                      ? ''
                      : item.is_income
                        ? ' +'
                        : ' −'}
                    {formatCurrency(Math.abs(item.amount))}
                  </span>
                </button>
              ))}

              {overflow > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleDayExpand(key); }}
                  className="pl-1 text-left text-[10px] text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 focus:outline-none"
                >
                  +{overflow} more
                </button>
              )}
              {isExpanded && items.length > CHIP_LIMIT && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleDayExpand(key); }}
                  className="pl-1 text-left text-[10px] text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 focus:outline-none"
                >
                  show less
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
