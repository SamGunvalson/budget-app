import { useRef, useCallback } from 'react';
import { useSwipeable } from 'react-swipeable';
import useSwipeNavigation from '../../hooks/useSwipeNavigation';

// Minimum swipe distance (px) before a gesture is evaluated.
const SWIPE_DELTA = 80;
// Minimum velocity (px/ms) — rejects slow accidental drags.
const MIN_VELOCITY = 0.3;
// Swipe must be at least this fraction horizontal (rejects mostly-vertical gestures).
const MIN_HORIZONTAL_RATIO = 0.65;
// Maximum gesture duration (ms) — rejects slow drags, requires a flick.
const MAX_SWIPE_DURATION = 500;
// Minimum ms between consecutive page navigations.
const NAV_COOLDOWN_MS = 400;
// px of total travel before the direction lock is committed.
const DIRECTION_LOCK_THRESHOLD = 12;

/**
 * Wraps page content to enable mobile swipe-left / swipe-right navigation.
 * On desktop (or when the page isn't in the swipe sequence) it renders children as-is.
 */
export default function SwipeableWrapper({ children }) {
  const { goNext, goPrev, canGoNext, canGoPrev, isSwipePage } = useSwipeNavigation();
  const wrapperRef = useRef(null);
  /** 'h' | 'v' | null — locked once the gesture travels past DIRECTION_LOCK_THRESHOLD */
  const lockedAxis = useRef(null);
  /** Timestamp of the last navigation to enforce NAV_COOLDOWN_MS */
  const lastNavTime = useRef(0);

  const playAnimation = useCallback((className) => {
    const el = wrapperRef.current;
    if (!el) return;
    // Remove then re-add to restart if already set
    el.classList.remove('animate-slide-in-left', 'animate-slide-in-right');
    // Force reflow so the browser recognises the class removal
    void el.offsetWidth;
    el.classList.add(className);
  }, []);

  /** Called continuously during the gesture. Lock axis as early as possible. */
  const handleSwiping = useCallback((e) => {
    if (lockedAxis.current) return;
    if (e.absX + e.absY > DIRECTION_LOCK_THRESHOLD) {
      lockedAxis.current = e.absX >= e.absY ? 'h' : 'v';
    }
  }, []);

  /** Reset direction lock when the gesture ends (fired after onSwiped* or on cancel). */
  const handleTouchEnd = useCallback(() => {
    lockedAxis.current = null;
  }, []);

  const handleSwipedLeft = useCallback(
    (e) => {
      if (lockedAxis.current === 'v') return;
      if (document.querySelector('[data-modal-open]')) return;
      if (isInsideScrollable(e.event)) return;
      if (e.velocity < MIN_VELOCITY) return;
      if (e.absX / (e.absX + e.absY) < MIN_HORIZONTAL_RATIO) return;
      const now = Date.now();
      if (now - lastNavTime.current < NAV_COOLDOWN_MS) return;
      if (canGoNext) {
        lastNavTime.current = now;
        playAnimation('animate-slide-in-right');
        goNext();
      }
    },
    [canGoNext, goNext, playAnimation],
  );

  const handleSwipedRight = useCallback(
    (e) => {
      if (lockedAxis.current === 'v') return;
      if (document.querySelector('[data-modal-open]')) return;
      if (isInsideScrollable(e.event)) return;
      if (e.velocity < MIN_VELOCITY) return;
      if (e.absX / (e.absX + e.absY) < MIN_HORIZONTAL_RATIO) return;
      const now = Date.now();
      if (now - lastNavTime.current < NAV_COOLDOWN_MS) return;
      if (canGoPrev) {
        lastNavTime.current = now;
        playAnimation('animate-slide-in-left');
        goPrev();
      }
    },
    [canGoPrev, goPrev, playAnimation],
  );

  const { ref: swipeRef, ...swipeProps } = useSwipeable({
    onSwiping: handleSwiping,
    onSwipedLeft: handleSwipedLeft,
    onSwipedRight: handleSwipedRight,
    onTouchEndOrOnMouseUp: handleTouchEnd,
    delta: SWIPE_DELTA,
    swipeDuration: MAX_SWIPE_DURATION,
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
