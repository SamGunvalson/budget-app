import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { evaluateAmount } from '../../utils/calculator';
import { formatCurrency } from '../../utils/helpers';

const KEYS = ['(', ')', 'Clear', 'Backspace', '7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '+'];
const KEY_LABELS = { '/': 'Divide', '*': 'Multiply', '-': 'Subtract', '+': 'Add', '(': 'Open parenthesis', ')': 'Close parenthesis' };
const KEY_TEXT = { '/': '÷', '*': '×', '-': '−', Backspace: '⌫' };

export default function CalculatorModal({ initialValue, label, minCents, onApply, onClose, returnFocusRef }) {
  const [expression, setExpression] = useState(initialValue);
  const dialogRef = useRef(null);
  const expressionRef = useRef(null);
  const titleId = useId();
  const resultId = useId();
  const { cents, error } = evaluateAmount(expression, { minCents });

  useEffect(() => {
    const previousFocus = returnFocusRef.current;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    expressionRef.current.focus();
    expressionRef.current.select();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [returnFocusRef]);

  const apply = () => {
    if (cents === null) return;
    onApply(cents);
    onClose();
  };

  const insertKey = (key) => {
    const input = expressionRef.current;
    let start = input.selectionStart ?? expression.length;
    let end = input.selectionEnd ?? expression.length;
    if (key === 'Clear') {
      setExpression('');
      input.focus();
      return;
    }
    // Operators extend the preselected initial amount; numbers replace it.
    if ('+-*/'.includes(key) && start === 0 && end === expression.length && expression) start = end;
    if (key === 'Backspace' && start === end) start = Math.max(0, start - 1);
    const inserted = key === 'Backspace' ? '' : key;
    setExpression(expression.slice(0, start) + inserted + expression.slice(end));
    input.focus();
    requestAnimationFrame(() => input.setSelectionRange(start + inserted.length, start + inserted.length));
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      data-modal-open="true"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll('input, button:not(:disabled)');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-stone-200/60 bg-white p-5 text-stone-900 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-100"
    >
      <h2 id={titleId} className="text-lg font-semibold">Calculate amount</h2>
      <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">{label}</p>
      <label className="mb-1 block text-sm font-medium" htmlFor={`${titleId}-expression`}>Calculation</label>
      <input
        ref={expressionRef}
        id={`${titleId}-expression`}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={expression}
        aria-describedby={resultId}
        onChange={(event) => setExpression(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); apply(); }
        }}
        placeholder="e.g. (25 + 10) / 2"
        className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700"
      />
      <div id={resultId} role="status" aria-live="polite" className="my-3 min-h-12">
        {error
          ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          : <p className="text-xl font-semibold tabular-nums">{formatCurrency(cents)}</p>}
        <p className="text-xs text-stone-500 dark:text-stone-400">Final result rounded to the nearest cent.</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={KEY_LABELS[key] || key}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => insertKey(key)}
            className={`min-h-11 rounded-lg bg-stone-100 px-2 py-2 text-sm font-medium hover:bg-stone-200 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-stone-700 dark:hover:bg-stone-600 ${key === '+' ? 'col-span-2' : ''}`}
          >
            {KEY_TEXT[key] || key}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-xl border border-stone-200/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600">Cancel</button>
        <button type="button" onClick={apply} disabled={cents === null} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-stone-950 hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50">Use amount</button>
      </div>
    </dialog>,
    document.body,
  );
}
