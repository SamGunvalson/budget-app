import { useContext, useEffect, useEffectEvent } from 'react';
import { PageActionsContext, PageActionsRegistryContext } from '../contexts/pageActionsContextValue';

/**
 * Register the current page's actions for the mobile action bar.
 *
 * @param {Array<{
 *   id: string,
 *   label: string,
 *   icon?: import('react').ReactNode,
 *   variant?: 'primary' | 'secondary' | 'icon',
 *   pressed?: boolean,
 *   onSelect: () => void,
 * }>} actions  Order is display order; put the primary action last.
 *
 * Desktop keeps rendering its own header buttons. Hide those on mobile with
 * the `mobile:hidden` class so each action appears once.
 */
export default function usePageActions(actions) {
  const registry = useContext(PageActionsRegistryContext);
  const signature = actions
    .map((a) => `${a.id}\u0000${a.label}\u0000${a.variant ?? ''}\u0000${a.pressed ?? ''}`)
    .join('\u0001');

  // Keep handlers current without re-publishing the descriptor list.
  useEffect(() => {
    const handlers = registry.handlersRef.current;
    handlers.clear();
    for (const action of actions) handlers.set(action.id, action.onSelect);
  });

  const publish = useEffectEvent(() => {
    registry.setActions(
      actions.map(({ id, label, icon, variant, pressed }) => ({ id, label, icon, variant, pressed })),
    );
  });

  useEffect(() => {
    publish();
  }, [signature]);

  useEffect(() => () => registry.setActions([]), [registry]);
}

/** Read side for MobileChrome. */
export function usePageActionList() {
  const actions = useContext(PageActionsContext);
  const registry = useContext(PageActionsRegistryContext);
  const run = (id) => registry.handlersRef.current.get(id)?.();
  return { actions, run };
}
