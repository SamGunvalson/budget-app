import {
  getUserPreferenceOffline,
  setUserPreferenceOffline,
} from "./offlineAware";

export const QUICK_TRANSACTION_TEMPLATES_KEY = "quick_transaction_templates";

export function normalizeQuickTransactionTemplates(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        row.account_id &&
        row.category_id &&
        row.description,
    )
    .map((row, idx) => ({
      id: row.id || crypto.randomUUID(),
      label: row.label?.trim() || row.description?.trim() || "Quick Transaction",
      description: row.description?.trim() || "",
      payee: row.payee?.trim() || "",
      account_id: row.account_id,
      category_id: row.category_id,
      is_income: !!row.is_income,
      is_split: !!row.is_split,
      split_method:
        row.split_method === "full" || row.split_method === "custom"
          ? row.split_method
          : "equal",
      split_payer: row.split_payer === "partner" ? "partner" : "me",
      split_partner_share_pct:
        Number.isFinite(row.split_partner_share_pct) &&
        row.split_partner_share_pct >= 0 &&
        row.split_partner_share_pct <= 100
          ? Math.round(row.split_partner_share_pct)
          : 50,
      is_active: row.is_active !== false,
      sort_order: Number.isFinite(row.sort_order) ? row.sort_order : idx,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function getQuickTransactionTemplates() {
  const raw = await getUserPreferenceOffline(QUICK_TRANSACTION_TEMPLATES_KEY);
  return normalizeQuickTransactionTemplates(raw);
}

export async function saveQuickTransactionTemplates(templates) {
  const normalized = normalizeQuickTransactionTemplates(templates);
  await setUserPreferenceOffline(QUICK_TRANSACTION_TEMPLATES_KEY, normalized);
}
