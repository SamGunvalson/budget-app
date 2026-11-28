import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts';
import DataUnavailable from '../common/DataUnavailable';
import EmptyState from '../common/EmptyState';
import useLayoutMode from '../../hooks/useLayoutMode';
import useReportData from '../../hooks/useReportData';
import {
  CATEGORY_FALLBACK_COLOR,
  CHART_AXIS,
  CHART_INCOME,
  CHART_MUTED,
  MIX_COLORS,
} from '../../constants/chartColors';
import { formatCurrency, formatPreMaskedDollars, getMonthName, toDollars } from '../../utils/helpers';
import { flowGraph, reportPeriodKeys, txMonthKey } from '../../utils/reportAggregations';

const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });
const premasked = (dollars) => formatPreMaskedDollars(dollars, 'USD', { hideCents: true });
const PANEL = 'animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50';

/** Nodes that stand for one category and open its transactions. */
const isCategoryNode = (node) => node.kind === 'category' || node.kind === 'credit' || node.kind === 'debit';

/** Fill for a flowGraph node: type nodes use the validated MIX_COLORS. */
function nodeColor(node) {
  switch (node.kind) {
    case 'income': return CHART_INCOME;
    case 'hub': return CHART_AXIS;
    case 'type': return MIX_COLORS[node.id] ?? CHART_MUTED;
    case 'moved': return MIX_COLORS.saved;
    case 'leftover': return MIX_COLORS.leftOver;
    case 'shortfall': return CHART_MUTED;
    default: return node.color || CATEGORY_FALLBACK_COLOR;
  }
}

/**
 * Sankey node: a thin bar plus "Name  $value". Leaves (right column) label to
 * their left so text stays inside the chart. Recharts' `targetLinks` are a
 * node's outgoing links (`sourceLinks` are the incoming ones).
 */
function FlowNode({ x, y, width, height, payload, onPick }) {
  const isLeaf = !(payload.targetLinks?.length);
  const clickable = isCategoryNode(payload) && onPick;
  const labelX = isLeaf ? x - 8 : x + width + 8;
  return (
    <g
      onClick={clickable ? () => onPick(payload.id) : undefined}
      style={clickable ? { cursor: 'pointer' } : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Open ${payload.name} transactions` : undefined}
    >
      <rect x={x} y={y} width={width} height={Math.max(height, 1)} rx={2} fill={nodeColor(payload)} />
      <text
        x={labelX}
        y={y + height / 2}
        textAnchor={isLeaf ? 'end' : 'start'}
        dominantBaseline="middle"
        className="fill-stone-700 text-xs dark:fill-stone-200"
      >
        <tspan fontWeight={600}>{payload.name}</tspan>
        <tspan dx={6} className="fill-stone-500 dark:fill-stone-400">{premasked(payload.value)}</tspan>
      </text>
    </g>
  );
}

/** Sankey link tinted with its target node's color. */
function FlowLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) {
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={nodeColor(payload.target)}
      strokeOpacity={0.3}
      strokeWidth={Math.max(linkWidth, 1)}
    />
  );
}

function FlowTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload?.payload ?? payload[0].payload;
  const label = item?.source && item?.target ? `${item.source.name} → ${item.target.name}` : item?.name;
  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 text-sm shadow-lg dark:border-stone-700/60 dark:bg-stone-800">
      <p className="font-semibold text-stone-700 dark:text-stone-300">{label}</p>
      <p className="tabular-nums text-stone-700 dark:text-stone-300">{premasked(item?.value ?? payload[0].value)}</p>
    </div>
  );
}

/**
 * Mobile layout: the same flow as grouped rows (a Sankey's labels don't fit a
 * phone). Each branch shows its total and its share of income.
 */
function FlowList({ graph, onPick }) {
  const { nodes, links } = graph;
  // Actual income only: the hub's other sources (refunds, the shortfall from
  // savings & other) would make spending look like a smaller share.
  const income = links
    .filter((l) => l.target === 0 && nodes[l.source].kind === 'income')
    .reduce((s, l) => s + l.value, 0);
  const branches = links.filter((l) => l.source === 0).map((l) => ({
    node: nodes[l.target],
    value: l.value,
    children: links.filter((c) => c.source === l.target).map((c) => ({ node: nodes[c.target], value: c.value })),
  }));
  const sources = links.filter((l) => l.target === 0).map((l) => ({ node: nodes[l.source], value: l.value }));
  const pct = (v) => (income > 0 ? `${Math.round((v / income) * 100)}%` : '');
  const barWidth = (v) => (income > 0 ? `${Math.min(100, (v / income) * 100)}%` : '0%');

  const Row = ({ node, value, indent = false }) => {
    const clickable = isCategoryNode(node);
    const body = (
      <>
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: nodeColor(node) }} />
        <span className={`min-w-0 flex-1 truncate ${indent ? 'text-stone-700 dark:text-stone-300' : 'font-semibold text-stone-900 dark:text-stone-100'}`}>{node.name}</span>
        <span className="tabular-nums text-stone-900 dark:text-stone-100">{money(value)}</span>
      </>
    );
    return clickable ? (
      <button type="button" onClick={() => onPick(node.id)} className={`flex w-full items-center gap-2 rounded-lg py-1.5 text-left text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-stone-700/40 ${indent ? 'pl-5' : ''}`}>
        {body}
      </button>
    ) : (
      <div className={`flex items-center gap-2 py-1.5 text-sm ${indent ? 'pl-5' : ''}`}>{body}</div>
    );
  };

  return (
    <div className="space-y-5">
      <section>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">Money in</h4>
        {sources.map((s) => <Row key={s.node.name} node={s.node} value={s.value} />)}
      </section>
      {branches.map((b) => (
        <section key={b.node.name}>
          <div className="mb-1 flex items-baseline justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">{b.node.name}</h4>
            {income > 0 && <span className="text-xs text-stone-500 dark:text-stone-400">{pct(b.value)} of income</span>}
          </div>
          <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: barWidth(b.value), backgroundColor: nodeColor(b.node) }} />
          </div>
          {b.children.length === 0
            ? <Row node={b.node} value={b.value} />
            : b.children.map((c) => <Row key={c.node.name} node={c.node} value={c.value} indent />)}
        </section>
      ))}
    </div>
  );
}

/**
 * Reports › Categories › Flow: where the period's money came from and went,
 * income → Needs / Wants / Saved / Left in checking → categories. Saved uses
 * the same rule as Overview (budget lines plus money moved to savings
 * accounts). Clicking a category opens it in the List view, expanded.
 *
 * @param {{ month: number, year: number, viewMode: 'monthly' | 'ytd', asOf: string | null }} props
 */
export default function FlowView({ month, year, viewMode, asOf }) {
  const [, setSearchParams] = useSearchParams();
  const isMobile = useLayoutMode() === 'mobile';
  const periodKeys = useMemo(() => reportPeriodKeys(year, month, viewMode), [year, month, viewMode]);
  const { settled, isLoading, failed } = useReportData({ year, keyLists: [periodKeys], asOf });

  const graph = useMemo(() => {
    const keys = new Set(periodKeys);
    return flowGraph(settled.filter((t) => keys.has(txMonthKey(t))));
  }, [settled, periodKeys]);

  // Safe mode: link values are masked ONCE here (toDollars), so the drawn
  // widths are scrambled too; labels use the pre-masked formatter.
  const chartData = useMemo(() => ({
    nodes: graph.nodes.map((n) => ({ ...n })),
    links: graph.links.map((l) => ({ ...l, value: toDollars(l.value) })),
  }), [graph]);

  const openCategory = (categoryId) => {
    setSearchParams({ view: 'categories', lens: 'list', category: categoryId });
  };

  const periodLabel = viewMode === 'ytd' ? `Jan – ${getMonthName(month)} ${year}` : `${getMonthName(month)} ${year}`;

  if (isLoading) return <div className={`h-96 animate-pulse ${PANEL}`} aria-busy="true" />;
  if (failed) {
    return (
      <DataUnavailable
        eyebrow={periodLabel}
        title="Flow unavailable"
        message="Couldn't load transactions for this period, so the flow isn't shown."
        onRetry={() => failed.refetch()}
        retrying={failed.isFetching}
      />
    );
  }
  if (graph.links.length === 0) {
    return <EmptyState title="Nothing to show" hint={`No income or spending for ${periodLabel}.`} />;
  }

  const leaves = graph.nodes.filter((_, i) => !graph.links.some((l) => l.source === i)).length;
  const height = Math.max(360, leaves * 30);

  return (
    <section className={PANEL} aria-labelledby="flow-title">
      <h3 id="flow-title" className="text-lg font-semibold text-stone-900 dark:text-stone-100">Where the money went</h3>
      <p className="mb-4 text-xs text-stone-500 dark:text-stone-400">
        {periodLabel}. Saved includes budget lines and money moved to savings accounts. Pick a category to see its transactions.
      </p>
      {isMobile ? (
        <FlowList graph={graph} onPick={openCategory} />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <Sankey
            data={chartData}
            node={<FlowNode onPick={openCategory} />}
            link={<FlowLink />}
            nodeWidth={10}
            nodePadding={14}
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            iterations={64}
            sort={false}
          >
            <Tooltip content={<FlowTooltip />} />
          </Sankey>
        </ResponsiveContainer>
      )}
    </section>
  );
}
