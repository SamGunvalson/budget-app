import {
  addDays,
  addWeeks,
  addMonths,
  addQuarters,
  setDate,
  getDaysInMonth,
  isBefore,
  isAfter,
  startOfDay,
  parseISO,
  format,
  getDay,
  nextDay,
} from "date-fns";

/**
 * Frequency labels for UI display.
 */
export const FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 Weeks" },
  { value: "semi_monthly", label: "Semi-Monthly (Twice a Month)" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom Interval" },
];

/**
 * Day-of-week labels (0 = Sunday … 6 = Saturday).
 */
export const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ── Helpers ──

/**
 * Parse a date string (YYYY-MM-DD) into a local-time Date at midnight.
 * Accepts Date objects as well (returned as-is after startOfDay).
 */
function toLocalDate(d) {
  if (!d) return null;
  if (d instanceof Date) return startOfDay(d);
  return startOfDay(parseISO(d));
}

/**
 * Clamp day_of_month to the actual number of days in the given month.
 * E.g., day 31 in February → 28 (or 29 in a leap year).
 */
function clampDay(date, targetDay) {
  const maxDay = getDaysInMonth(date);
  return setDate(date, Math.min(targetDay, maxDay));
}

// ── Core calculations ──

/**
 * Return the next occurrence date for a recurring template relative to `after`.
 * `after` is exclusive — the returned date is strictly > after.
 *
 * @param {Object} template - recurring_templates row
 * @param {Date|string} after - find next occurrence after this date
 * @returns {Date|null} next occurrence date (local midnight), or null if ended
 */
export function getNextOccurrence(template, after) {
  const afterDate = toLocalDate(after);
  const startDate = toLocalDate(template.start_date);
  const endDate = template.end_date ? toLocalDate(template.end_date) : null;

  if (!startDate) return null;

  let candidate = null;

  switch (template.frequency) {
    case "semi_monthly": {
      // Two days per month (e.g. 1st and 15th)
      const day1 = template.day_of_month || startDate.getDate();
      const day2 = template.day_of_month_2 || 15;
      const days = [Math.min(day1, day2), Math.max(day1, day2)];

      // Try both days in the current month, then next month, etc.
      let found = null;
      for (let m = 0; m <= 2 && !found; m++) {
        const monthDate = m === 0 ? afterDate : addMonths(afterDate, m);
        for (const targetDay of days) {
          // Set to the correct month (monthDate's month)
          const adjusted = clampDay(
            new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
            targetDay,
          );
          if (isAfter(adjusted, afterDate) && !isBefore(adjusted, startDate)) {
            if (!found || isBefore(adjusted, found)) {
              found = adjusted;
            }
          }
        }
      }
      candidate = found;
      break;
    }

    case "monthly": {
      const day = template.day_of_month || startDate.getDate();
      // Start from the month of afterDate, clamped
      let d = clampDay(afterDate, day);
      // If that's not after afterDate, go to next month
      if (!isAfter(d, afterDate)) {
        d = clampDay(addMonths(afterDate, 1), day);
      }
      // Must be >= start_date
      if (isBefore(d, startDate)) {
        d = clampDay(startDate, day);
        if (isBefore(d, startDate)) d = clampDay(addMonths(startDate, 1), day);
      }
      candidate = d;
      break;
    }

    case "weekly": {
      const dow = template.day_of_week ?? getDay(startDate);
      // nextDay gives the next occurrence of dow strictly after the given date
      let d = nextDay(afterDate, dow);
      if (isBefore(d, startDate)) d = nextDay(addDays(startDate, -1), dow);
      // If start_date itself is the right dow AND is after afterDate, prefer it
      if (getDay(startDate) === dow && isAfter(startDate, afterDate)) {
        d = startDate;
      }
      candidate = d;
      break;
    }

    case "biweekly": {
      // Every 2 weeks from start_date
      let d = startDate;
      while (!isAfter(d, afterDate)) {
        d = addWeeks(d, 2);
      }
      candidate = d;
      break;
    }

    case "quarterly": {
      const day = template.day_of_month || startDate.getDate();
      let d = clampDay(afterDate, day);
      if (!isAfter(d, afterDate)) {
        d = clampDay(addMonths(afterDate, 1), day);
      }
      // Align to quarterly cadence from start_date
      if (isBefore(d, startDate)) d = startDate;
      // Walk quarters from start_date
      let q = startDate;
      while (!isAfter(q, afterDate)) {
        q = addQuarters(q, 1);
        q = clampDay(q, day);
      }
      candidate = q;
      break;
    }

    case "yearly": {
      const day = template.day_of_month || startDate.getDate();
      let d = clampDay(afterDate, day);
      // Set to same month as start_date
      d = new Date(afterDate.getFullYear(), startDate.getMonth(), 1);
      d = clampDay(d, day);
      if (!isAfter(d, afterDate)) {
        d = new Date(afterDate.getFullYear() + 1, startDate.getMonth(), 1);
        d = clampDay(d, day);
      }
      if (isBefore(d, startDate)) {
        d = clampDay(startDate, day);
        if (!isAfter(d, afterDate)) {
          d = new Date(startDate.getFullYear() + 1, startDate.getMonth(), 1);
          d = clampDay(d, day);
        }
      }
      candidate = d;
      break;
    }

    case "custom": {
      const interval = template.custom_interval || 1;
      const unit = template.custom_unit || "months";

      if (unit === "days") {
        let d = startDate;
        while (!isAfter(d, afterDate)) {
          d = addDays(d, interval);
        }
        candidate = d;
      } else if (unit === "weeks") {
        let d = startDate;
        while (!isAfter(d, afterDate)) {
          d = addWeeks(d, interval);
        }
        candidate = d;
      } else {
        // months — anchor to day_of_month, walk in steps of interval months
        const targetDay = template.day_of_month || startDate.getDate();
        let d = clampDay(
          new Date(startDate.getFullYear(), startDate.getMonth(), 1),
          targetDay,
        );
        // If the aligned day is before start_date, advance one interval
        if (isBefore(d, startDate)) {
          d = clampDay(addMonths(d, interval), targetDay);
        }
        while (!isAfter(d, afterDate)) {
          d = clampDay(addMonths(d, interval), targetDay);
        }
        candidate = d;
      }
      break;
    }

    default:
      return null;
  }

  // Enforce end_date
  if (candidate && endDate && isAfter(candidate, endDate)) {
    return null;
  }
  return candidate;
}

/**
 * Get all occurrences of a recurring template within [rangeStart, rangeEnd].
 * Useful for showing upcoming charges in the next N months.
 *
 * @param {Object} template
 * @param {Date|string} rangeStart
 * @param {Date|string} rangeEnd
 * @param {number} [maxOccurrences=50] safety limit
 * @returns {Date[]} array of occurrence dates
 */
export function getOccurrencesInRange(
  template,
  rangeStart,
  rangeEnd,
  maxOccurrences = 50,
) {
  const start = toLocalDate(rangeStart);
  const end = toLocalDate(rangeEnd);
  const occurrences = [];

  // Walk from the day before rangeStart so we catch rangeStart itself
  let cursor = addDays(start, -1);

  for (let i = 0; i < maxOccurrences; i++) {
    const next = getNextOccurrence(template, cursor);
    if (!next) break;
    if (isAfter(next, end)) break;
    occurrences.push(next);
    cursor = next;
  }

  return occurrences;
}

/**
 * Determine all occurrences that should have been applied but haven't been yet.
 * Compares last_applied (or start_date - 1 day) to today.
 *
 * @param {Object} template
 * @param {Date|string} [today] defaults to current date
 * @returns {Date[]} dates that need to be applied
 */
export function getPendingOccurrences(template, today) {
  const todayDate = today ? toLocalDate(today) : startOfDay(new Date());

  // Starting point: day before last_applied, or day before start_date
  const lastApplied = template.last_applied
    ? toLocalDate(template.last_applied)
    : addDays(toLocalDate(template.start_date), -1);

  const pending = [];
  let cursor = lastApplied;

  // Safety: max 60 iterations (5 years of monthly)
  for (let i = 0; i < 60; i++) {
    const next = getNextOccurrence(template, cursor);
    if (!next) break;
    if (isAfter(next, todayDate)) break;
    pending.push(next);
    cursor = next;
  }

  return pending;
}

/**
 * Format a frequency + day into a human-readable schedule string.
 * e.g. "Monthly on the 1st", "Weekly on Monday"
 */
export function formatSchedule(template) {
  const { frequency, day_of_month, day_of_month_2, day_of_week, start_date } =
    template;

  switch (frequency) {
    case "semi_monthly": {
      const d1 =
        day_of_month || (start_date ? toLocalDate(start_date).getDate() : 1);
      const d2 = day_of_month_2 || 15;
      const sorted = [Math.min(d1, d2), Math.max(d1, d2)];
      return `Semi-Monthly on the ${ordinal(sorted[0])} and ${ordinal(sorted[1])}`;
    }
    case "monthly": {
      const day =
        day_of_month || (start_date ? toLocalDate(start_date).getDate() : 1);
      return `Monthly on the ${ordinal(day)}`;
    }
    case "weekly": {
      const dow =
        day_of_week ?? (start_date ? getDay(toLocalDate(start_date)) : 0);
      return `Weekly on ${DAY_OF_WEEK_LABELS[dow]}`;
    }
    case "biweekly": {
      const dow =
        day_of_week ?? (start_date ? getDay(toLocalDate(start_date)) : 0);
      return `Every 2 weeks on ${DAY_OF_WEEK_LABELS[dow]}`;
    }
    case "quarterly": {
      const day =
        day_of_month || (start_date ? toLocalDate(start_date).getDate() : 1);
      return `Quarterly on the ${ordinal(day)}`;
    }
    case "yearly": {
      if (start_date) {
        const d = toLocalDate(start_date);
        return `Yearly on ${format(d, "MMM d")}`;
      }
      return "Yearly";
    }
    case "custom": {
      const interval = template.custom_interval || 1;
      const unit = template.custom_unit || "months";
      if (unit === "days") {
        return `Every ${interval} day${interval === 1 ? "" : "s"}`;
      }
      if (unit === "weeks") {
        return `Every ${interval} week${interval === 1 ? "" : "s"}`;
      }
      // months
      const day =
        day_of_month || (start_date ? toLocalDate(start_date).getDate() : 1);
      return `Every ${interval} month${interval === 1 ? "" : "s"} on the ${ordinal(day)}`;
    }
    default:
      return frequency;
  }
}

/**
 * Convert a number to its ordinal string (1st, 2nd, 3rd, etc.)
 */
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Calculate the net deposit for a recurring group.
 * Net = gross amount − sum of absolute child amounts.
 * Used for paycheck breakdowns where the net deposit is auto-calculated.
 *
 * @param {number} grossAmount - Parent gross amount in cents (positive)
 * @param {Array<{ amount: number }>} children - Child line items (amounts in cents, may be signed)
 * @returns {number} net deposit in cents (0 if children exceed gross)
 */
export function calculateNetDeposit(grossAmount, children) {
  const totalDeductions = children.reduce(
    (sum, c) => sum + Math.abs(c.amount),
    0,
  );
  const net = Math.abs(grossAmount) - totalDeductions;
  return Math.max(0, net);
}
