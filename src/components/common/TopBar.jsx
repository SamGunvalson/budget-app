import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signOut } from '../../services/supabase';
import PAGE_REGISTRY from '../../constants/pages';
import SyncStatus from './SyncStatus';
import MobilePageDots from './MobilePageDots';

const navPages = PAGE_REGISTRY.filter((p) => p.showInNav);

/**
 * Shared sticky top navigation bar.
 *
 * Desktop (md+): shows all nav pages as links in the center.
 * Mobile (<md):  hamburger menu opens a dropdown overlay.
 */
export default function TopBar() {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const menuRef = useRef(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error('Sign-out failed:', err);
    } finally {
      setIsSigningOut(false);
    }
  };

  // Close mobile menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [menuOpen]);

  // ── Logo block ──
  const logo = (
    <>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-md shadow-amber-200/50">
        <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <span className="hidden text-lg font-bold text-stone-900 dark:text-stone-100 md:inline">Budget App</span>
    </>
  );

  return (
    <nav className="sticky top-0 z-10 border-b border-stone-200/60 bg-white/80 shadow-sm backdrop-blur-md dark:border-stone-700/60 dark:bg-stone-900/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: logo + mobile hamburger */}
        <div className="flex items-center gap-3">
          {/* Hamburger — mobile only */}
          <div className="relative md:hidden" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Navigation menu"
              aria-expanded={menuOpen}
              className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            >
              {menuOpen ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>

            {/* Dropdown overlay */}
            {menuOpen && (
              <div className="absolute left-0 top-full mt-2 w-56 rounded-xl border border-stone-200/60 bg-white py-2 shadow-xl dark:border-stone-700/60 dark:bg-stone-800">
                {navPages.map((page) => {
                  const isActive = pathname === page.link;
                  return (
                    <Link
                      key={page.id}
                      to={page.link}
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'text-stone-600 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-700/50'
                      }`}
                    >
                      {page.iconSmall}
                      {page.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <Link to="/app/transactions" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            {logo}
          </Link>
        </div>

        {/* Center: page dots on mobile, full nav on desktop */}
        <div className="flex items-center md:hidden">
          <MobilePageDots />
        </div>
        <div className="hidden items-center gap-1.5 md:flex">
          {navPages.map((page) => {
            const isActive = pathname === page.link;
            return (
              <Link
                key={page.id}
                to={page.link}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                  isActive
                    ? 'border border-amber-300 bg-amber-50 text-amber-700 shadow-amber-100/50 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'border border-stone-200/60 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'
                }`}
              >
                {page.iconSmall}
                {page.label}
              </Link>
            );
          })}
        </div>

        {/* Right: sync status + sign out */}
        <div className="flex items-center gap-2">
          <SyncStatus />
          <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </nav>);
}
