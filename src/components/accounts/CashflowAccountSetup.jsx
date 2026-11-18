import { maskAccountName } from '../../utils/helpers';
import { isAssetAccount, formatAccountType } from '../../services/accounts';
import { settlementPayer } from '../../utils/cashflowScenario';

const ASSET_ROLE_OPTIONS = [
  { value: 'cash', label: 'Cash — money I spend from' },
  { value: 'reserve', label: 'Reserve — savings, not counted as spendable' },
  { value: 'ignore', label: 'Not counted' },
];
const LIABILITY_ROLE_OPTIONS = [
  { value: 'card', label: 'Card — paid from cash each statement' },
  { value: 'ignore', label: 'Not counted' },
];

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * CashflowAccountSetup — choose how each open account counts in the forecast,
 * and see whether each card's statement cycle is set up.
 *
 * Props:
 *  - accounts: open accounts
 *  - roles: { [accountId]: role } (resolved)
 *  - onRoleChange(accountId, role)
 *  - onManageAccounts()
 */
export default function CashflowAccountSetup({ accounts = [], roles = {}, onRoleChange, onManageAccounts }) {
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-2 pt-4">
      <p className="text-xs text-stone-400 dark:text-stone-500">
        The forecast adds up your <strong className="font-semibold">cash</strong> accounts and pays each
        <strong className="font-semibold"> card</strong>&apos;s statement from its paying account. Chart selection
        above only changes which lines are drawn.
      </p>
      <div className="divide-y divide-stone-100 rounded-xl border border-stone-200/60 bg-white/60 dark:divide-stone-700/60 dark:border-stone-700/60 dark:bg-stone-800/60">
        {accounts.map((a) => {
          const asset = isAssetAccount(a.type);
          const role = roles[a.id] || 'ignore';
          const payer = !asset && role === 'card' ? settlementPayer(a, byId) : null;
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{maskAccountName(a.name)}</p>
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  {formatAccountType(a.type)}
                  {role === 'card' && (payer ? (
                    <> · Closes the {ordinal(a.statement_close_day)}, due the {ordinal(a.payment_due_day)}, paid from {maskAccountName(payer.name)}</>
                  ) : (
                    <>
                      {' · '}
                      <button type="button" onClick={onManageAccounts} className="font-medium text-amber-600 hover:underline dark:text-amber-400">
                        Add statement days and paying account
                      </button>
                    </>
                  ))}
                </p>
              </div>
              <select
                value={role}
                onChange={(e) => onRoleChange?.(a.id, e.target.value)}
                aria-label={`How ${maskAccountName(a.name)} counts`}
                className="rounded-lg border border-stone-200/80 bg-stone-50/80 px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-300"
              >
                {(asset ? ASSET_ROLE_OPTIONS : LIABILITY_ROLE_OPTIONS).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
