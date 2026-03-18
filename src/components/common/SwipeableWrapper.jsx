import { useRef, useCallback } from 'react';
import { useSwipeable } from 'react-swipeable';
import useSwipeNavigation from '../../hooks/useSwipeNavigation';

/**
 * Wraps page content to enable mobile swipe-left / swipe-right navigation.
 * On desktop (or when the page isn't in the swipe sequence) it renders children as-is.
 */
export default function SwipeableWrapper({ children }) {
  const { goNext, goPrev, canGoNext, canGoPrev, isSwipePage } = useSwipeNavigation();
  const wrapperRef = useRef(null);

  const playAnimation = useCallback((className) => {
    const el = wrapperRef.current;
    if (!el) return;
    // Remove then re-add to restart if already set
    el.classList.remove('animate-slide-in-left', 'animate-slide-in-right');
    // Force reflow so the browser recognises the class removal
    void el.offsetWidth;
    el.classList.add(className);
  }, []);

  const handleSwipedLeft = useCallback(
    (e) => {
      if (document.querySelector('[data-modal-open]')) return;
      if (isInsideScrollable(e.event)) return;
      if (canGoNext) {
        playAnimation('animate-slide-in-right');
        goNext();
      }
    },
    [canGoNext, goNext, playAnimation],
  );

  const handleSwipedRight = useCallback(
    (e) => {
      if (document.querySelector('[data-modal-open]')) return;
      if (isInsideScrollable(e.event)) return;
      if (canGoPrev) {
        playAnimation('animate-slide-in-left');
        goPrev();
      }
    },
    [canGoPrev, goPrev, playAnimation],
  );

  const { ref: swipeRef, ...swipeProps } = useSwipeable({
    onSwipedLeft: handleSwipedLeft,
    onSwipedRight: handleSwipedRight,
    delta: 50,
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: false,
  });

  // Inline merged ref: React calls the old callback with null (listener cleanup)
  // and the new one with the element (listener setup) whenever this function
  // changes identity — which keeps react-swipeable in sync without touching
  // any ref values during render.
  const mergedRef = (el) => {
    wrapperRef.current = el;
    swipeRef(el);
  };

  if (!isSwipePage) return children;

  return (
    <div {...swipeProps} ref={mergedRef} style={{ touchAction: 'pan-y' }}>
      {children}
    </div>
  );
}

/**
 * Walk up from the touch target to check if it lives inside
 * a horizontally scrollable container (e.g. budget table).
 */
function isInsideScrollable(event) {
  let el = event?.target;
  while (el && el !== document.body) {
    const { overflowX } = window.getComputedStyle(el);
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}
