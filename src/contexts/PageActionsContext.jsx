import { useMemo, useRef, useState } from 'react';
import { PageActionsContext, PageActionsRegistryContext } from './pageActionsContextValue';

/**
 * Holds the actions the current page exposes in the mobile action bar.
 * Pages register them with `usePageActions`; MobileChrome renders them.
 */
export function PageActionsProvider({ children }) {
  const [actions, setActions] = useState([]);
  const handlersRef = useRef(new Map());
  const registry = useMemo(() => ({ setActions, handlersRef }), []);

  return (
    <PageActionsRegistryContext.Provider value={registry}>
      <PageActionsContext.Provider value={actions}>{children}</PageActionsContext.Provider>
    </PageActionsRegistryContext.Provider>
  );
}
