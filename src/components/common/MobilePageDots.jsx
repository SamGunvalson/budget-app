import useSwipeNavigation from '../../hooks/useSwipeNavigation';

/**
 * Dot indicator row for the current swipe page position.
 * Rendered inline inside the TopBar center slot on mobile.
 */
export default function MobilePageDots() {
  const { orderedPages, currentIndex, isSwipePage } = useSwipeNavigation();

  if (!isSwipePage || orderedPages.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {orderedPages.map((page, i) => (
        <div
          key={page.id}
          aria-hidden="true"
          className={`rounded-full transition-all duration-300 ${
            i === currentIndex
              ? 'h-2.5 w-2.5 bg-amber-500 shadow-sm shadow-amber-200/50 dark:shadow-amber-900/50'
              : 'h-2 w-2 bg-stone-300 dark:bg-stone-600'
          }`}
        />
      ))}
    </div>
  );
}
