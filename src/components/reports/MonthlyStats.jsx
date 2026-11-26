import { formatCurrency } from '../../utils/helpers';
import StatCards from './StatCards';

/**
 * Three stat cards: Net (forest summary card), Income, Expenses.
 * Displays monthly or YTD data depending on viewMode.
 * All values in cents.
 * @param {{ income: number, expenses: number, viewMode?: 'monthly' | 'ytd' }} props
 */
export default function MonthlyStats({ income, expenses, viewMode = 'monthly' }) {
  const net = income - expenses;
  const period = viewMode === 'ytd' ? 'year to date' : 'this month';
  const netLabel = net === 0 ? 'Balanced' : net > 0 ? 'Surplus' : 'Deficit';

  return (
    <StatCards
      cards={[
        {
          label: 'Net',
          value: `${net > 0 ? '+' : net < 0 ? '−' : ''}${formatCurrency(Math.abs(net))}`,
          sub: `${netLabel} ${period}`,
          negative: net < 0,
        },
        { label: 'Income', value: formatCurrency(income) },
        { label: 'Expenses', value: formatCurrency(expenses) },
      ]}
    />
  );
}
