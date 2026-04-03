import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { addMonths, startOfDay, format } from 'date-fns';
import { getRecurringTemplates, deleteRecurringTemplate, recordManualPayment } from '../../services/recurring';
import RecurringCalendarView from './RecurringCalendarView';
import { getOccurrencesInRange, formatSchedule, getNextOccurrence } from '../../utils/recurringCalculations';
import { formatCurrency, formatDate, toDollars, toCents, maskAccountName } from '../../utils/helpers';

/**
 * UpcomingRecurring — report widget that shows:
 *  1. All active recurring templates (standalone + groups) with edit/delete
 *  2. A preview of upcoming charges for the next 3 months
 *  3. An "Apply now" button to generate pending transactions
 *
 * Props:
 *  - onApplied(result): callback after applying recurring transactions
 *  - onEdit(template): callback to open edit modal for standalone templates
 *  - onEditGroup(template): callback to open group edit modal
 */
export default function UpcomingRecurring({ onApplied, onEdit, onEditGroup }) {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  // Per-template record-payment inline form
  const [recordingId, setRecordingId] = useState(null);
  const [recordDate, setRecordDate] = useState('');
  const [recordAmount, setRecordAmount] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRefs = useRef({});

  // Close kebab menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const handlePointerDown = (e) => {
      const ref = menuRefs.current[openMenuId];
      if (ref && !ref.contains(e.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openMenuId]);

  const toggleMenu = useCallback((id) => {
    setOpenMenuId((prev) => (prev === id ? null : id));
  }, []);

  // Load templates
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError('');
      try {
        const data = await getRecurringTemplates();
        if (!cancelled) setTemplates(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load recurring templates');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const toggleGroupExpand = (id) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Compute upcoming occurrences for the next 3 months
  const upcoming = useMemo(() => {
    const today = startOfDay(new Date());
    const rangeEnd = addMonths(today, 3);
    const items = [];

    for (const t of templates) {
      const dates = getOccurrencesInRange(t, today, rangeEnd);
      for (const d of dates) {
        if (t.is_group_parent) {
          // Group: show as a single entry with children info
          const children = t.children || [];
          // Compute net from children: income minus expenses, transfers excluded
          const netAmount = children.length > 0
            ? children.reduce((sum, c) => {
                if (c.is_transfer) return sum;
                return sum + (c.is_income ? c.amount : -c.amount);
              }, 0)
            : t.amount;
          items.push({
            templateId: t.id,
            description: t.description,
            payee: t.payee,
            amount: netAmount,
            is_income: netAmount >= 0,
            is_group: true,
            childCount: children.length,
            date: d,
            dateStr: format(d, 'yyyy-MM-dd'),
            category: t.categories?.name || 'Uncategorized',
            categoryColor: t.categories?.color || '#A8A29E',
            account: maskAccountName(t.accounts?.name || '—'),
          });
        } else {
          items.push({
            templateId: t.id,
            description: t.description,
            payee: t.payee,
            amount: t.amount,
            is_income: t.is_income,
            is_transfer: t.is_transfer,
            date: d,
            dateStr: format(d, 'yyyy-MM-dd'),
            category: t.categories?.name || 'Uncategorized',
            categoryColor: t.categories?.color || '#A8A29E',
            account: maskAccountName(t.accounts?.name || '—'),
            toAccount: t.to_account?.name ? maskAccountName(t.to_account.name) : null,
          });
        }
      }
    }

    items.sort((a, b) => a.date - b.date);
    return items;
  }, [templates]);

  // Open record-payment form for a template
  const handleStartRecord = (template) => {
    setRecordingId(template.id);
    setRecordDate(format(new Date(), 'yyyy-MM-dd'));
    setRecordAmount(String(toDollars(Math.abs(template.amount))));
  };

  const handleCancelRecord = () => {
    setRecordingId(null);
    setRecordDate('');
    setRecordAmount('');
  };

  const handleSubmitRecord = async (template) => {
    if (!recordDate) return;
    setIsRecording(true);
    setError('');
    try {
      const defaultCents = Math.abs(template.amount);
      const inputCents = toCents(Math.abs(Number(recordAmount)));
      const amountOverride =
        !template.is_group_parent && inputCents !== defaultCents ? inputCents : null;
      const txs = await recordManualPayment(template, recordDate, amountOverride);
      setRecordingId(null);
      setRecordDate('');
      setRecordAmount('');
      if (onApplied) onApplied({ applied: txs.length, transactions: txs });
    } catch (err) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setIsRecording(false);
    }
  };

  // Handle delete
  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await deleteRecurringTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  // Format account display for transfers
  const formatAccountDisplay = (t) => {
    if (t.is_transfer && t.to_account?.name) {
      return `${maskAccountName(t.accounts?.name || '—')} → ${maskAccountName(t.to_account.name)}`;
    }
    return maskAccountName(t.accounts?.name || '—');
  };

  // Type badge for template list
  const TypeBadge = ({ template }) => {
    if (template.is_group_parent) {
      return (
        <span className="inline-flex items-center rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
          GROUP
        </span>
      );
    }
    if (template.is_transfer) {
      return (
        <span className="inline-flex items-center rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          TRANSFER
        </span>
      );
    }
    if (template.is_split) {
      return (
        <span className="inline-flex items-center rounded-md bg-pink-100 px-1.5 py-0.5 text-[10px] font-semibold text-pink-700 dark:bg-pink-900/30 dark:text-pink-400">
          SPLIT
        </span>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <div className="h-6 w-48 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-700" />
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-700/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4 dark:border-stone-700/60">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
            <svg className="h-5 w-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Recurring Transactions
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {templates.length} active template{templates.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* List / Calendar toggle */}
        <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 dark:border-stone-700 dark:bg-stone-900/50">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-violet-500 ${
              viewMode === 'list'
                ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-violet-500 ${
              viewMode === 'calendar'
                ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            Calendar
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <div className="px-6 py-4">
          <RecurringCalendarView
            templates={templates}
            onEdit={onEdit}
            onEditGroup={onEditGroup}
          />
        </div>
      )}

      {/* Template list (list mode only) */}
      {viewMode === 'list' && <div className="px-6 py-4">
        {templates.length === 0 ? (
          <p className="text-center text-sm text-stone-400 dark:text-stone-500">
            No recurring templates yet. Create one to automate your regular transactions.
          </p>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => {
              const next = getNextOccurrence(t, startOfDay(new Date()));
              const isGroup = t.is_group_parent;
              const isExpanded = expandedGroups.has(t.id);
              // For groups, compute net from children so stale stored amounts don't mislead
              const groupNet = isGroup && t.children?.length > 0
                ? t.children.reduce((sum, c) => {
                    if (c.is_transfer) return sum;
                    return sum + (c.is_income ? c.amount : -c.amount);
                  }, 0)
                : t.amount;

              return (
                <div key={t.id}>
                  <div
                    className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 transition-colors hover:bg-stone-50 dark:border-stone-700/40 dark:bg-stone-800/50 dark:hover:bg-stone-700/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {/* Expand toggle for groups */}
                        {isGroup && (
                          <button
                            type="button"
                            onClick={() => toggleGroupExpand(t.id)}
                            className="rounded p-0.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                          >
                            <svg
                              className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          </button>
                        )}
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: t.categories?.color || '#A8A29E' }}
                        />
                        <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                          {t.description}
                        </span>
                        <TypeBadge template={t} />
                        {t.auto_confirm === false && (
                          <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            REVIEW
                          </span>
                        )}
                        {isGroup ? (
                          <span className={`text-sm font-semibold ${
                            groupNet >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}>
                            {groupNet >= 0 ? '+' : '−'}{formatCurrency(Math.abs(groupNet))}
                          </span>
                        ) : (
                          <span className={`text-sm font-semibold ${
                            t.is_transfer
                              ? 'text-blue-600 dark:text-blue-400'
                              : t.is_income
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                          }`}>
                            {t.is_transfer ? '' : t.is_income ? '+' : '−'}{formatCurrency(Math.abs(t.amount))}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
                        <span>{formatSchedule(t)}</span>
                        <span>·</span>
                        <span>{t.categories?.name || 'Uncategorized'}</span>
                        <span>·</span>
                        <span>{formatAccountDisplay(t)}</span>

                        {next && (
                          <>
                            <span>·</span>
                            <span className="text-violet-600 dark:text-violet-400">
                              Next: {formatDate(format(next, 'yyyy-MM-dd'))}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Kebab menu */}
                    <div
                      className="relative ml-2 shrink-0"
                      ref={(el) => { menuRefs.current[t.id] = el; }}
                    >
                      <button
                        type="button"
                        aria-label="Actions"
                        onClick={() => toggleMenu(t.id)}
                        className={`rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                          openMenuId === t.id
                            ? 'bg-stone-200 text-stone-700 dark:bg-stone-600 dark:text-stone-200'
                            : 'text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-300'
                        }`}
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="5" r="1.5" />
                          <circle cx="12" cy="12" r="1.5" />
                          <circle cx="12" cy="19" r="1.5" />
                        </svg>
                      </button>

                      {openMenuId === t.id && (
                        <div
                          role="menu"
                          className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
                        >
                          {/* Record payment */}
                          <button
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              recordingId === t.id ? handleCancelRecord() : handleStartRecord(t);
                              setOpenMenuId(null);
                            }}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-stone-50 dark:hover:bg-stone-700/60 ${
                              recordingId === t.id
                                ? 'font-medium text-violet-600 dark:text-violet-400'
                                : 'text-stone-700 dark:text-stone-300'
                            }`}
                          >
                            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                            </svg>
                            {recordingId === t.id ? 'Cancel Record' : 'Record Payment'}
                          </button>

                          {/* Edit */}
                          {isGroup && onEditGroup ? (
                            <button
                              role="menuitem"
                              type="button"
                              onClick={() => { onEditGroup(t); setOpenMenuId(null); }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-700/60"
                            >
                              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                              Edit Group
                            </button>
                          ) : onEdit && !isGroup ? (
                            <button
                              role="menuitem"
                              type="button"
                              onClick={() => { onEdit(t); setOpenMenuId(null); }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-700/60"
                            >
                              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                              Edit
                            </button>
                          ) : null}

                          {/* Divider */}
                          <div className="my-1 border-t border-stone-100 dark:border-stone-700" />

                          {/* Delete */}
                          <button
                            role="menuitem"
                            type="button"
                            onClick={() => { handleDelete(t.id); setOpenMenuId(null); }}
                            disabled={deletingId === t.id}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            {deletingId === t.id ? (
                              <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            )}
                            {deletingId === t.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline record-payment form */}
                  {recordingId === t.id && (
                    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 dark:border-violet-800/50 dark:bg-violet-950/30">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                        Record Payment
                      </p>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-stone-600 dark:text-stone-400">
                            Date
                          </label>
                          <input
                            type="date"
                            value={recordDate}
                            onChange={(e) => setRecordDate(e.target.value)}
                            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                          />
                        </div>
                        {!t.is_group_parent && (
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-stone-600 dark:text-stone-400">
                              Amount (optional override)
                            </label>
                            <div className="relative">
                              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-stone-400">$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={recordAmount}
                                onChange={(e) => setRecordAmount(e.target.value)}
                                className="rounded-lg border border-stone-200 bg-white py-1.5 pl-7 pr-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                              />
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSubmitRecord(t)}
                            disabled={isRecording || !recordDate}
                            className="rounded-lg bg-violet-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRecording ? 'Recording…' : 'Record'}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelRecord}
                            disabled={isRecording}
                            className="rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Expanded group children */}
                  {isGroup && isExpanded && t.children?.length > 0 && (
                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-purple-200 pl-4 dark:border-purple-800">
                      {t.children.map((child) => (
                        <div
                          key={child.id}
                          className="flex items-center justify-between rounded-lg bg-stone-50/80 px-3 py-2 text-sm dark:bg-stone-800/30"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: child.categories?.color || '#A8A29E' }}
                            />
                            <span className="text-stone-700 dark:text-stone-300">
                              {child.description}
                            </span>
                            {child.is_transfer && (
                              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                                TRANSFER
                              </span>
                            )}
                            <span className="text-xs text-stone-500 dark:text-stone-400">
                              {child.categories?.name || ''}
                            </span>
                          </div>
                          <span className={`font-semibold ${
                            child.is_transfer
                              ? 'text-blue-600 dark:text-blue-400'
                              : child.is_income
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                          }`}>
                            {child.is_transfer ? '' : child.is_income ? '+' : '−'}
                            {formatCurrency(Math.abs(child.amount))}
                          </span>
                        </div>
                      ))}
                      {/* Net summary row */}
                      <div className="flex items-center justify-between rounded-lg border border-dashed border-stone-200 bg-stone-50/50 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-800/20">
                        <span className="font-medium text-stone-700 dark:text-stone-400">
                          Net
                        </span>
                        <span className={`font-bold ${groupNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {groupNet >= 0 ? '+' : '−'}{formatCurrency(Math.abs(groupNet))}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>}

      {/* Upcoming charges (next 3 months, list mode only) */}
      {viewMode === 'list' && upcoming.length > 0 && (
        <div className="border-t border-stone-100 px-6 py-4 dark:border-stone-700/60">
          <button
            type="button"
            onClick={() => setShowUpcoming((v) => !v)}
            className="mb-3 flex w-full items-center justify-between text-sm font-medium text-stone-700 dark:text-stone-300"
          >
            <span>Upcoming Charges (Next 3 Months)</span>
            <svg
              className={`h-4 w-4 transition-transform ${showUpcoming ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {showUpcoming && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {upcoming.map((item, i) => (
                <div
                  key={`${item.templateId}-${item.dateStr}-${i}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-stone-50 dark:hover:bg-stone-700/20"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.categoryColor }}
                    />
                    <span className="text-stone-600 dark:text-stone-400">
                      {formatDate(item.dateStr)}
                    </span>
                    <span className="font-medium text-stone-900 dark:text-stone-100">
                      {item.description}
                    </span>
                    {item.is_group && (
                      <span className="rounded bg-purple-100 px-1 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                        GROUP · {item.childCount} items
                      </span>
                    )}
                    {item.is_transfer && (
                      <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        TRANSFER
                      </span>
                    )}
                    {item.toAccount && (
                      <span className="text-xs text-blue-600 dark:text-blue-400">
                        {item.account} → {item.toAccount}
                      </span>
                    )}
                  </div>
                  <span className={`font-semibold ${
                    item.is_group
                      ? (item.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')
                      : item.is_transfer
                        ? 'text-blue-600 dark:text-blue-400'
                        : item.is_income
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                  }`}>
                    {item.is_group
                      ? `Net: ${item.amount >= 0 ? '+' : '−'}${formatCurrency(Math.abs(item.amount))}`
                      : `${item.is_transfer ? '' : item.is_income ? '+' : '−'}${formatCurrency(Math.abs(item.amount))}`
                    }
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          <div className="mt-3 flex justify-between border-t border-stone-100 pt-3 text-sm dark:border-stone-700/40">
            <span className="font-medium text-stone-600 dark:text-stone-400">
              {upcoming.length} upcoming charge{upcoming.length !== 1 ? 's' : ''}
            </span>
            <span className="font-semibold text-stone-900 dark:text-stone-100">
              Total: {formatCurrency(
                upcoming.reduce((sum, item) => {
                  if (item.is_group) return sum + (item.amount || 0);
                  if (item.is_transfer) return sum; // transfers don't affect totals
                  return sum + (item.is_income ? item.amount : -Math.abs(item.amount));
                }, 0)
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
