import { forwardRef, useRef, useState } from 'react';
import CalculatorModal from './CalculatorModal';
import { centsToInput } from '../../utils/calculator';

const AmountInput = forwardRef(function AmountInput({
  calculatorLabel = 'Amount',
  calculatorValue,
  onAmountChange,
  minCents = 1,
  compact = false,
  onFieldBlur,
  ...inputProps
}, ref) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const triggerRef = useRef(null);
  const [initialValue, setInitialValue] = useState('');
  const close = () => { openRef.current = false; setOpen(false); };

  return (
    <div
      className="group/amount relative min-w-0"
      onBlur={(event) => {
        if (!openRef.current && !event.currentTarget.contains(event.relatedTarget)) onFieldBlur?.();
      }}
    >
      <input
        {...inputProps}
        ref={ref}
        aria-label={inputProps['aria-label'] || calculatorLabel}
        className={`${inputProps.className ?? ''} ${compact ? 'group-focus-within/amount:pr-6' : ''}`}
        style={{ ...inputProps.style, ...(!compact && { paddingRight: '2.5rem' }), minWidth: 0 }}
      />
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Calculate ${calculatorLabel}`}
        title={`Calculate ${calculatorLabel}`}
        disabled={inputProps.disabled || inputProps.readOnly}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          setInitialValue(String(calculatorValue ?? inputProps.value ?? ''));
          openRef.current = true;
          setOpen(true);
        }}
        className={`absolute inset-y-0 right-0 flex items-center justify-center rounded-lg text-stone-400 hover:text-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40 dark:hover:text-amber-400 ${compact ? 'w-6 opacity-0 focus:opacity-100 group-focus-within/amount:opacity-100' : 'w-10'}`}
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M8 6h8v4H8zM8 14h2m4 0h2m-8 4h2m4 0h2" />
        </svg>
      </button>
      {open && (
        <CalculatorModal
          initialValue={initialValue}
          label={calculatorLabel}
          minCents={minCents}
          onApply={(cents) => onAmountChange(centsToInput(cents), cents)}
          onClose={close}
          returnFocusRef={triggerRef}
        />
      )}
    </div>
  );
});

export default AmountInput;
