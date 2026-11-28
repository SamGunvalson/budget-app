import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signOut, getCurrentUser } from '../../services/backend';
import PAGE_REGISTRY from '../../constants/pages';
import SyncStatus from './SyncStatus';
import BrandMark from './BrandMark';
import SplitNotificationBell from '../splits/SplitNotificationBell';
import useSplitNotifications from '../../hooks/useSplitNotifications';
import { getPartnership, getPartnerEmail } from '../../services/partnerships';

const navPages = PAGE_REGISTRY.filter((p) => p.showInNav);
const MENU_HOVER = 'hover:border-stone-200 hover:bg-stone-50 dark:hover:border-stone-700 dark:hover:bg-stone-700/50';
const MENU_ACTIVE = 'border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100';
// Pages reachable on mobile only through the top-bar menu (not in the bottom tab bar).
const menuPages = PAGE_REGISTRY.filter((p) => p.link && !p.tabActive);

function MobileAccountMenu({ pathname, onSignOut, isSigningOut }) {
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
    <div className="relative desktop:hidden" ref={menuRef}
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
        aria-label="More pages and sign out"
        aria-expanded={menuOpen}
        className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
      >
        {menuOpen ? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
        )}
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-stone-200/60 bg-white py-2 shadow-xl dark:border-stone-700/60 dark:bg-stone-800">
          {menuPages.map((page) => {
            const isActive = pathname === page.link;
            return (
              <Link
                key={page.id}
                to={page.link}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${page.navHover ?? MENU_HOVER} ${page.navFocus ?? 'focus-visible:ring-amber-500'} ${
                  isActive
                    ? (page.navActive ?? MENU_ACTIVE)
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
 * On mobile layout the page links live in the bottom tab bar (MobileChrome);
 * this bar keeps the logo, status, and a menu for Settings, Categories and Sign out.
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
      <span className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">Budget App</span>
    </>
  );

  return (
    <nav className="safe-area-pt sticky top-0 z-30 border-b border-stone-200/60 bg-panel/85 backdrop-blur-md dark:border-stone-700/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: logo */}
        <div className="flex items-center gap-3">
          <Link to="/app/transactions" aria-label="Budget App transactions" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            {logo}
          </Link>
        </div>

        {/* Right: split bell + sync status + sign out (desktop) or menu (mobile) */}
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
            className="hidden rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 desktop:block dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
          <MobileAccountMenu key={pathname} pathname={pathname} onSignOut={handleSignOut} isSigningOut={isSigningOut} />
        </div>
      </div>

      {/* Desktop page tabs (mobile uses the bottom tab bar) */}
      <div className="hidden border-t border-stone-200/60 desktop:block dark:border-stone-700/60">
        <div className="mx-auto flex max-w-6xl items-center gap-6 overflow-x-auto overflow-y-hidden no-scrollbar px-4 sm:px-6">
          {navPages.map((page) => {
            const isActive = pathname === page.link;
            return (
              <Link
                key={page.id}
                to={page.link}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${page.navFocus} ${
                  isActive
                    ? `${page.tabUnderline} font-semibold text-stone-900 dark:text-stone-100`
                    : 'border-transparent font-medium text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200'
                }`}
              >
                {page.iconSmall}
                {page.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>);
}
