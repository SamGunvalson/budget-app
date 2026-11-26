import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signOut, getCurrentUser } from '../../services/backend';
import PAGE_REGISTRY from '../../constants/pages';
import SyncStatus from './SyncStatus';
import BrandMark from './BrandMark';
import MobilePageDots from './MobilePageDots';
import SplitNotificationBell from '../splits/SplitNotificationBell';
import useSplitNotifications from '../../hooks/useSplitNotifications';
import { getPartnership, getPartnerEmail } from '../../services/partnerships';

const navPages = PAGE_REGISTRY.filter((p) => p.showInNav);

function MobileNavigationMenu({ pathname, onSignOut, isSigningOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

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

  return (
    <div className="relative lg:hidden" ref={menuRef}
      onKeyDown={(event) => {
        if (menuOpen && event.key === 'Escape') {
          setMenuOpen(false);
          menuRef.current.querySelector('button').focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
      }}
    >
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
      {menuOpen && (
        <div className="absolute left-0 top-full mt-2 w-56 rounded-xl border border-stone-200/60 bg-white py-2 shadow-xl dark:border-stone-700/60 dark:bg-stone-800">
          {navPages.map((page) => {
            const isActive = pathname === page.link;
            return (
              <Link
                key={page.id}
                to={page.link}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${page.navHover} ${page.navFocus} ${
                  isActive
                    ? page.navActive
                    : 'border-transparent text-stone-600 dark:text-stone-300'
                }`}
              >
                {page.iconSmall}
                {page.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={onSignOut}
            disabled={isSigningOut}
            className="mt-1 w-full border-t border-stone-200 px-4 py-2.5 text-left text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Shared sticky top navigation bar.
 *
 * The compact navigation fits phones and portrait tablets.
 */
export default function TopBar() {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { pathname } = useLocation();

  // Partnership + current user for split notifications
  const [partnership, setPartnership] = useState(null);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isUserA, setIsUserA] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPartnership() {
      try {
        const [user, p] = await Promise.all([getCurrentUser(), getPartnership()]);
        if (cancelled) return;
        setCurrentUserId(user?.id ?? null);
        setPartnership(p);
        setIsUserA(p?.user_a_id === user?.id);
        if (p && user) {
          const email = await getPartnerEmail(p, user.id);
          if (!cancelled) setPartnerEmail(email);
        }
      } catch { /* non-fatal */ }
    }
    loadPartnership();
    return () => { cancelled = true; };
  }, []);

  const { unseenCount, unseenExpenses, allPartnerExpenses, markAsSeen, loading: notifLoading } =
    useSplitNotifications({ partnership, currentUserId, isUserA });

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

  // ── Logo block ──
  const logo = (
    <>
      <BrandMark />
      <span className="hidden font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100 md:inline">Budget App</span>
    </>
  );

  return (
    <nav className="safe-area-pt sticky top-0 z-30 border-b border-stone-200/60 bg-white/80 shadow-sm backdrop-blur-md dark:border-stone-700/60 dark:bg-stone-900/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: logo + mobile hamburger */}
        <div className="flex items-center gap-3">
          <MobileNavigationMenu key={pathname} pathname={pathname} onSignOut={handleSignOut} isSigningOut={isSigningOut} />

          <Link to="/app/transactions" aria-label="Budget App transactions" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            {logo}
          </Link>
        </div>

        {/* Center: page dots on mobile, full nav on desktop */}
        <div className="flex items-center lg:hidden">
          <MobilePageDots />
        </div>
        <div className="hidden items-center gap-1.5 lg:flex">
          {navPages.map((page) => {
            const isActive = pathname === page.link;
            return (
              <Link
                key={page.id}
                to={page.link}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900 ${page.navHover} ${page.navFocus} ${
                  isActive
                    ? page.navActive
                    : 'border-stone-200/60 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'
                }`}
              >
                {page.iconSmall}
                {page.label}
              </Link>
            );
          })}
        </div>

        {/* Right: sync status + split bell + sign out */}
        <div className="flex items-center gap-2">
          {partnership && (
            <SplitNotificationBell
              unseenCount={unseenCount}
              unseenExpenses={unseenExpenses}
              allPartnerExpenses={allPartnerExpenses}
              partnerEmail={partnerEmail}
              currentUserId={currentUserId}
              onMarkSeen={markAsSeen}
              loading={notifLoading}
            />
          )}
          <SyncStatus />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="hidden rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:block dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </nav>);
}
