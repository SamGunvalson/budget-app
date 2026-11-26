import { useSyncExternalStore } from 'react';
import { getLayoutMode, subscribeLayoutMode } from '../utils/layoutMode';

/**
 * Returns 'mobile' or 'desktop'. Prefer the `mobile:` / `desktop:` CSS
 * variants for styling; use this hook only when the DOM structure differs.
 */
export default function useLayoutMode() {
  return useSyncExternalStore(subscribeLayoutMode, getLayoutMode, () => 'desktop');
}
