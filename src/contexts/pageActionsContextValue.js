import { createContext } from 'react';

/** Current page's action descriptors (without handlers), read by MobileChrome. */
export const PageActionsContext = createContext([]);

/**
 * Stable registry API used by pages: `{ setActions, handlersRef }`.
 * Split from PageActionsContext so registering pages do not re-render
 * when the action list changes.
 */
export const PageActionsRegistryContext = createContext(null);
