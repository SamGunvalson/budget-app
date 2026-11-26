import { Capacitor } from '@capacitor/core';

/**
 * App layout mode: 'mobile' (bottom tab bar + floating page actions) or
 * 'desktop' (top navigation + header actions).
 *
 * Mobile means a viewport narrower than Tailwind's `lg` breakpoint, or the
 * native Android app at any width. The mode is mirrored onto
 * `<html data-layout="…">` so CSS can use the `mobile:` / `desktop:` variants
 * defined in src/index.css without rendering both layouts.
 */
const MOBILE_QUERY = '(max-width: 1023.98px)';

const listeners = new Set();
let mql = null;
let initialized = false;

function compute() {
  if (Capacitor.isNativePlatform()) return 'mobile';
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  mql ??= window.matchMedia(MOBILE_QUERY);
  return mql.matches ? 'mobile' : 'desktop';
}

let current = 'desktop';

function apply() {
  current = compute();
  if (typeof document !== 'undefined') document.documentElement.dataset.layout = current;
  listeners.forEach((listener) => listener());
}

/** Set the initial `data-layout` attribute and follow viewport changes. Idempotent. */
export function initLayoutMode() {
  if (initialized) return;
  initialized = true;
  apply();
  mql?.addEventListener?.('change', apply);
}

export function getLayoutMode() {
  return current;
}

export function subscribeLayoutMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
