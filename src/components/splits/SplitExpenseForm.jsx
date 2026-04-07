import { useState } from 'react';

export default function SplitExpenseForm({ currentUserId, partnerId, partnerEmail, onSubmit, onCancel, loading, initialDescription, initialAmount, initialDate }) {
  const [description, setDescription] = useState(initialDescription || '');
  const [amount, setAmount] = useState(initialAmount || '');
  const [expenseDate, setExpenseDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
  const [paidBy, setPaidBy] = useState('me');
  const [splitMethod, setSplitMethod] = useState('equal');
  const [customMyShare, setCustomMyShare] = useState('');
  const [customPartnerShare, setCustomPartnerShare] = useState('');

  const totalCents = Math.round((parseFloat(amount) || 0) * 100);

  function handleCustomShareChange(field, value) {
    const num = parseFloat(value) || 0;
    const cents = Math.round(num * 100);
    if (field === 'my') {
      setCustomMyShare(value);
      setCustomPartnerShare(((totalCents - cents) / 100).toFixed(2));
    } else {
      setCustomPartnerShare(value);
      setCustomMyShare(((totalCents - cents) / 100).toFixed(2));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!description.trim() || totalCents <= 0) return;

    let payerShare, partnerShare;
    if (splitMethod === 'equal') {
      const half = Math.floor(totalCents / 2);
      // Payer gets the extra cent if odd
      payerShare = totalCents - half;
      partnerShare = half;
    } else if (splitMethod === 'full') {
      // Non-payer owes the entire amount; payer keeps none
      payerShare = 0;
      partnerShare = totalCents;
    } else {
      // In custom mode: "my share" / "partner share" are from the current user's perspective
      const myShare = Math.round((parseFloat(customMyShare) || 0) * 100);
      const theirShare = Math.round((parseFloat(customPartnerShare) || 0) * 100);
      if (myShare + theirShare !== totalCents) return;
      if (paidBy === 'me') {
        payerShare = myShare;
        partnerShare = theirShare;
      } else {
        // Partner paid: their share is payer_share, my share is partner_share
        payerShare = theirShare;
        partnerShare = myShare;
      }
    }

    onSubmit({
      description: description.trim(),
      totalAmount: totalCents,
      payerShare,
      partnerShare,
      paidByUserId: paidBy === 'me' ? currentUserId : partnerId,
      expenseDate,
    });
  }

  const isValid = description.trim() && totalCents > 0 && (
    splitMethod === 'equal' ||
    splitMethod === 'full' ||
    (Math.round((parseFloat(customMyShare) || 0) * 100) + Math.round((parseFloat(customPartnerShare) || 0) * 100) === totalCents)
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Description */}
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Description
        </label>
        <input
          type="text"
          required
          placeholder="Dinner, groceries, etc."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-xl border border-stone-200 bg-stone-50/50 px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-500"
        />
      </div>

      {/* Amount */}
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Total Amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (splitMethod === 'custom') {
                const cents = Math.round((parseFloat(e.target.value) || 0) * 100);
                const half = Math.floor(cents / 2);
                setCustomMyShare(((cents - half) / 100).toFixed(2));
                setCustomPartnerShare((half / 100).toFixed(2));
              }
            }}
            className="w-full rounded-xl border border-stone-200 bg-stone-50/50 py-2.5 pl-7 pr-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-500"
          />
        </div>
      </div>

      {/* Date */}
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Date
        </label>
        <input
          type="date"
          required
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          className="w-full rounded-xl border border-stone-200 bg-stone-50/50 px-4 py-2.5 text-sm text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-100 dark:focus:border-amber-500"
        />
      </div>

      {/* Who paid */}
      <div>
        <label className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Who paid?
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPaidBy('me')}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              paidBy === 'me'
                ? 'border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-500/20 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            I paid
          </button>
          <button
            type="button"
            onClick={() => setPaidBy('partner')}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              paidBy === 'partner'
                ? 'border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-500/20 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            {partnerEmail} paid
          </button>
        </div>
      </div>

      {/* Split method */}
      <div>
        <label className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Split
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSplitMethod('equal')}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              splitMethod === 'equal'
                ? 'border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-500/20 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            Equal (50/50)
          </button>
          <button
            type="button"
            onClick={() => setSplitMethod('full')}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              splitMethod === 'full'
                ? 'border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-500/20 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            Full (100%)
          </button>
          <button
            type="button"
            onClick={() => {
              setSplitMethod('custom');
              if (totalCents > 0) {
                const half = Math.floor(totalCents / 2);
                setCustomMyShare(((totalCents - half) / 100).toFixed(2));
                setCustomPartnerShare((half / 100).toFixed(2));
              }
            }}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              splitMethod === 'custom'
                ? 'border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-500/20 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            Custom
          </button>
        </div>
      </div>

      {/* Custom split fields */}
      {splitMethod === 'custom' && totalCents > 0 && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-stone-100 bg-stone-50/50 p-3 dark:border-stone-700 dark:bg-stone-900/30">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
              Your share
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={customMyShare}
                onChange={(e) => handleCustomShareChange('my', e.target.value)}
                className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-6 pr-2 text-sm text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-amber-500"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
              {partnerEmail}&apos;s share
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={customPartnerShare}
                onChange={(e) => handleCustomShareChange('partner', e.target.value)}
                className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-6 pr-2 text-sm text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-amber-500"
              />
            </div>
          </div>
          {splitMethod === 'custom' && totalCents > 0 &&
            (Math.round((parseFloat(customMyShare) || 0) * 100) + Math.round((parseFloat(customPartnerShare) || 0) * 100) !== totalCents) && (
            <p className="col-span-2 text-xs text-red-500 dark:text-red-400">
              Shares must add up to ${(totalCents / 100).toFixed(2)}
            </p>
          )}
        </div>
      )}

      {/* Preview */}
      {totalCents > 0 && splitMethod === 'equal' && (
        <div className="rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 dark:border-stone-700 dark:bg-stone-900/30">
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Each person pays <span className="font-medium text-stone-700 dark:text-stone-300">${(Math.floor(totalCents / 2) / 100).toFixed(2)}</span>
          </p>
        </div>
      )}
      {totalCents > 0 && splitMethod === 'full' && (
        <div className="rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 dark:border-stone-700 dark:bg-stone-900/30">
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {paidBy === 'me' ? (
              <>{partnerEmail} owes you the full <span className="font-medium text-stone-700 dark:text-stone-300">${(totalCents / 100).toFixed(2)}</span></>
            ) : (
              <>You owe {partnerEmail} the full <span className="font-medium text-stone-700 dark:text-stone-300">${(totalCents / 100).toFixed(2)}</span></>
            )}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!isValid || loading}
          className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:from-amber-600 hover:to-amber-700 hover:shadow-lg hover:shadow-amber-500/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Adding…' : 'Add Expense'}
        </button>
      </div>
    </form>
  );
}
