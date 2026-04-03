/**
 * Transaction grouping utilities.
 *
 * Groups recurring-group children (shared group_id + same date) and
 * same-payee/same-date transactions into collapsible groups for display.
 */

/**
 * Build a lookup map from recurring template ID → parent group info.
 *
 * @param {Array} templates – top-level recurring templates from getRecurringTemplates()
 * @returns {Map<string, { groupId: string, parentDescription: string, parentPayee: string }>}
 */
export function buildTemplateLookup(templates) {
  const map = new Map();
  for (const t of templates) {
    if (!t.is_group_parent || !t.children) continue;
    for (const child of t.children) {
      map.set(child.id, {
        groupId: t.id,
        parentDescription: t.description || t.payee || "Group",
        parentPayee: t.payee || t.description || "Group",
      });
    }
  }
  return map;
}

/**
 * Group a flat list of transactions into GroupedItems.
 *
 * Grouping rules (in priority order):
 *  1. Recurring group children: transactions whose recurring_template_id maps
 *     to a child of a group parent → grouped by `recurring:{groupId}:{date}`
 *  2. Same payee + same date: 2+ transactions with identical payee and date
 *     → grouped by `payee:{payee}:{date}`
 *  3. Everything else: rendered as standalone.
 *
 * @param {Array} transactions – sorted/filtered transaction array
 * @param {Map} templateLookup – from buildTemplateLookup()
 * @returns {Array<{ type: 'group', groupKey: string, label: string, netAmount: number, isIncome: boolean, date: string, children: Array, isRecurringGroup: boolean, categoryColor: string|null } | { type: 'transaction', transaction: object }>}
 */
export function groupTransactions(transactions, templateLookup) {
  // Step 1: Assign each transaction a group key
  const keyedItems = transactions.map((tx) => {
    const tplInfo = tx.recurring_template_id
      ? templateLookup.get(tx.recurring_template_id)
      : null;

    if (tplInfo) {
      return {
        tx,
        groupKey: `recurring:${tplInfo.groupId}:${tx.transaction_date}`,
        label: tplInfo.parentDescription,
        isRecurring: true,
      };
    }

    // Same-payee grouping candidate
    const payee = (tx.payee || "").trim();
    if (payee) {
      return {
        tx,
        groupKey: `payee:${payee.toLowerCase()}:${tx.transaction_date}`,
        label: payee,
        isRecurring: false,
      };
    }

    // No group
    return { tx, groupKey: null, label: null, isRecurring: false };
  });

  // Step 2: Bucket by groupKey
  const buckets = new Map(); // groupKey → { label, isRecurring, items: [tx, ...], firstIndex }
  for (let i = 0; i < keyedItems.length; i++) {
    const { tx, groupKey, label, isRecurring } = keyedItems[i];
    if (!groupKey) continue;
    if (!buckets.has(groupKey)) {
      buckets.set(groupKey, { label, isRecurring, items: [], firstIndex: i });
    }
    buckets.get(groupKey).items.push(tx);
  }

  // Step 3: Build output, maintaining original sort order
  const emitted = new Set(); // groupKeys already emitted
  const result = [];

  for (let i = 0; i < keyedItems.length; i++) {
    const { tx, groupKey } = keyedItems[i];

    if (!groupKey) {
      result.push({ type: "transaction", transaction: tx });
      continue;
    }

    const bucket = buckets.get(groupKey);

    // Only group when 2+ transactions share the key
    if (bucket.items.length < 2) {
      result.push({ type: "transaction", transaction: tx });
      continue;
    }

    // Emit group only once (at the position of its first member)
    if (emitted.has(groupKey)) continue;
    emitted.add(groupKey);

    const children = bucket.items;
    const netAmount = computeGroupNet(children);
    const primaryColor = children[0]?.categories?.color || null;

    result.push({
      type: "group",
      groupKey,
      label: bucket.label,
      netAmount,
      isIncome: netAmount >= 0,
      date: children[0].transaction_date,
      children,
      isRecurringGroup: bucket.isRecurring,
      categoryColor: primaryColor,
    });
  }

  return result;
}

/**
 * Compute net amount for a group of transactions.
 * Transfers are excluded from the net. Income adds, expense subtracts.
 *
 * @param {Array} children
 * @returns {number} net amount in cents (positive = net income)
 */
export function computeGroupNet(children) {
  let net = 0;
  for (const t of children) {
    if (t.categories?.type === "transfer") continue;
    net += t.is_income ? Math.abs(t.amount) : -Math.abs(t.amount);
  }
  return net;
}
