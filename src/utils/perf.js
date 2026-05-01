/**
 * Lightweight performance instrumentation.
 *
 * Goals (Phase 0 — Performance baseline):
 *  - Capture cold-boot, route-change, and Supabase-call timings without
 *    pulling in a tracing library.
 *  - Be a no-op in production unless the user opts in via either:
 *      • `localStorage.setItem('perf', '1')`           (persistent)
 *      • `?perf=1` on any URL                          (per-tab)
 *      • `import.meta.env.DEV === true`                (always on in dev)
 *  - Surface results two ways:
 *      1. Native `performance.measure` entries (visible in DevTools → Performance).
 *      2. A small in-memory ring buffer queryable from the console:
 *           `window.__perf.dump()`                     → table of recent measures
 *           `window.__perf.summary()`                  → percentiles by label
 *           `window.__perf.reset()`                    → clear the buffer
 *
 * No sensitive data (PII, account names, amounts) is recorded — only labels,
 * counts, and durations.
 */

const RING_SIZE = 500;
const ring = [];

function isEnabled() {
  // Avoid throwing in non-browser contexts (SSR, tests).
  if (typeof window === "undefined") return false;
  if (import.meta?.env?.DEV) return true;
  try {
    if (window.localStorage?.getItem("perf") === "1") return true;
    if (
      typeof window.location !== "undefined" &&
      new URLSearchParams(window.location.search).get("perf") === "1"
    ) {
      return true;
    }
  } catch {
    /* storage / URL parsing unavailable */
  }
  return false;
}

const ENABLED = isEnabled();

function pushRing(entry) {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
}

function safeMark(name) {
  try {
    performance.mark(name);
  } catch {
    /* mark name collision or unsupported */
  }
}

function safeMeasure(label, startMark, endMark) {
  try {
    const m = performance.measure(label, startMark, endMark);
    return m?.duration ?? null;
  } catch {
    return null;
  }
}

/**
 * Mark the start of a labelled span. Returns an `end()` function that records
 * the measurement when called. Safe to call when disabled (returns a no-op).
 *
 * @example
 *   const end = perfStart('route:transactions');
 *   // …work…
 *   end();
 */
export function perfStart(label) {
  if (!ENABLED) return () => {};
  const startMark = `${label}:start:${performance.now()}`;
  safeMark(startMark);
  const startedAt = performance.now();

  return function end(extra) {
    const endMark = `${label}:end:${performance.now()}`;
    safeMark(endMark);
    const duration = safeMeasure(label, startMark, endMark);
    pushRing({
      label,
      duration: duration ?? performance.now() - startedAt,
      startedAt,
      ...(extra && typeof extra === "object" ? { meta: extra } : {}),
    });
  };
}

/**
 * Wrap an async function so each invocation is timed under the given label.
 *
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function perfAsync(label, fn) {
  if (!ENABLED) return fn();
  const end = perfStart(label);
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * Record an instantaneous measurement (e.g. computed durations from elsewhere).
 */
export function perfRecord(label, durationMs, extra) {
  if (!ENABLED) return;
  pushRing({
    label,
    duration: durationMs,
    startedAt: performance.now() - durationMs,
    ...(extra && typeof extra === "object" ? { meta: extra } : {}),
  });
}

/** Returns `true` when instrumentation is active in the current session. */
export function isPerfEnabled() {
  return ENABLED;
}

// ── Console helpers (dev / opt-in only) ──
if (ENABLED && typeof window !== "undefined") {
  function dump() {
    console.table(
      ring.map((e) => ({
        label: e.label,
        ms: Math.round(e.duration * 100) / 100,
        at: Math.round(e.startedAt),
      })),
    );
  }

  function summary() {
    const byLabel = new Map();
    for (const e of ring) {
      if (!byLabel.has(e.label)) byLabel.set(e.label, []);
      byLabel.get(e.label).push(e.duration);
    }
    const rows = [];
    for (const [label, durs] of byLabel) {
      const sorted = durs.slice().sort((a, b) => a - b);
      const pick = (p) =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      rows.push({
        label,
        count: sorted.length,
        p50: Math.round(pick(0.5) * 10) / 10,
        p90: Math.round(pick(0.9) * 10) / 10,
        p99: Math.round(pick(0.99) * 10) / 10,
        max: Math.round(sorted[sorted.length - 1] * 10) / 10,
      });
    }
    rows.sort((a, b) => b.p90 - a.p90);
    console.table(rows);
  }

  function reset() {
    ring.length = 0;
    try {
      performance.clearMarks();
      performance.clearMeasures();
    } catch {
      /* unsupported */
    }
  }

  // Expose without overwriting if a previous bundle already attached one.
  window.__perf = window.__perf || { dump, summary, reset, ring };
}
