import { cloneElement, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PAGE_REGISTRY from '../../constants/pages';
import useLayoutMode from '../../hooks/useLayoutMode';
import { usePageActionList } from '../../hooks/usePageActions';

const TAB_PAGES = PAGE_REGISTRY.filter((p) => p.showInNav && p.tabActive);

/** Tab bar row height (px), excluding the safe-area inset. */
const TAB_BAR_HEIGHT = 64;
/** Space reserved above the tab bar when the page has actions (px). */
const ACTIONS_HEIGHT = 68;

const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, select, [contenteditable="true"]';

/** True while a text field outside a dialog has focus (on-screen keyboard likely open). */
function useTextFieldFocused() {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      setFocused(Boolean(el?.matches?.(TEXT_INPUT) && !el.closest('dialog')));
    };
    let timer;
    // On focusout, activeElement is still the old field; check after focus settles.
    const deferredUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 0);
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', deferredUpdate);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', deferredUpdate);
    };
  }, []);
  return focused;
}

function ActionButton({ action, onSelect }) {
  const base =
    'pointer-events-auto inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold shadow-lg shadow-stone-900/15 transition-all active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper dark:shadow-black/40';
  if (action.variant === 'primary') {
    return (
      <button type="button" onClick={onSelect} className={`${base} bg-amber-500 px-5 text-stone-950 hover:bg-amber-600`}>
        {action.icon}
        {action.label}
      </button>
    );
  }
  const tone = action.pressed
    ? 'border-violet-300 bg-violet-500 text-white dark:border-violet-500'
    : 'border-line bg-panel text-stone-700 dark:text-stone-200';
  if (action.variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-label={action.label}
        aria-pressed={action.pressed ?? undefined}
        title={action.label}
        className={`${base} w-12 border ${tone}`}
      >
        {action.icon}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={action.pressed ?? undefined}
      className={`${base} border px-4 ${tone}`}
    >
      {action.icon}
      {action.label}
    </button>
  );
}

/**
 * Mobile-only bottom chrome: the page's floating action buttons and the
 * bottom tab bar. Rendered once per protected page; renders nothing on desktop.
 */
export default function MobileChrome() {
  const mode = useLayoutMode();
  const { pathname } = useLocation();
  const { actions, run } = usePageActionList();
  const keyboardOpen = useTextFieldFocused();
  const visible = mode === 'mobile' && !keyboardOpen;
  const hasActions = actions.length > 0;

  // Reserve room at the bottom of the page so content can scroll clear of the chrome.
  useEffect(() => {
    const root = document.documentElement;
    if (mode !== 'mobile') {
      root.style.removeProperty('--bottom-chrome');
      return undefined;
    }
    root.style.setProperty(
      '--bottom-chrome',
      `calc(${TAB_BAR_HEIGHT + (hasActions ? ACTIONS_HEIGHT : 0)}px + env(safe-area-inset-bottom, 0px))`,
    );
    return () => root.style.removeProperty('--bottom-chrome');
  }, [mode, hasActions]);

  if (!visible) return null;

  return (
    <>
      {hasActions && (
        <div
          className="pointer-events-none fixed inset-x-0 z-30 flex justify-end gap-2 px-4"
          style={{ bottom: `calc(${TAB_BAR_HEIGHT + 10}px + env(safe-area-inset-bottom, 0px))` }}
        >
          {actions.map((action) => (
            <ActionButton key={action.id} action={action} onSelect={() => run(action.id)} />
          ))}
        </div>
      )}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5" style={{ height: TAB_BAR_HEIGHT }}>
          {TAB_PAGES.map((page) => {
            const active = pathname === page.link;
            return (
              <li key={page.id} className="flex">
                <Link
                  to={page.link}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${page.navFocus} ${
                    active ? `${page.tabActive} font-semibold` : 'text-stone-500 dark:text-stone-400'
                  }`}
                >
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? page.tabPill : ''}`}
                  >
                    {cloneElement(page.iconSmall, { className: 'h-5 w-5', 'aria-hidden': true })}
                  </span>
                  {page.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
