import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PAGE_REGISTRY from "../constants/pages";

/** Pages eligible for swipe navigation, in registry order. */
const SWIPE_PAGES = PAGE_REGISTRY.filter((p) => p.link && p.showInNav);

/**
 * Provides an ordered page list and navigation helpers for mobile swipe.
 * Uses the fixed order from PAGE_REGISTRY (no pinned pages dependency).
 */
export default function useSwipeNavigation() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const orderedPages = SWIPE_PAGES;

  const currentIndex = orderedPages.findIndex((p) => pathname === p.link);
  const isSwipePage = currentIndex !== -1;
  const canGoPrev = isSwipePage && currentIndex > 0;
  const canGoNext = isSwipePage && currentIndex < orderedPages.length - 1;

  const goPrev = useCallback(() => {
    if (canGoPrev) navigate(orderedPages[currentIndex - 1].link);
  }, [canGoPrev, navigate, orderedPages, currentIndex]);

  const goNext = useCallback(() => {
    if (canGoNext) navigate(orderedPages[currentIndex + 1].link);
  }, [canGoNext, navigate, orderedPages, currentIndex]);

  return {
    orderedPages,
    currentIndex,
    goNext,
    goPrev,
    canGoNext,
    canGoPrev,
    isSwipePage,
  };
}
