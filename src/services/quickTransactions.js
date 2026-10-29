import {
  getUserPreferenceOffline,
  setUserPreferenceOffline,
  getCategoriesOffline,
} from "./offlineAware";
import { isAvailableCategory } from "../utils/categoryArchive";

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
  const categories = await getCategoriesOffline();
  const availableIds = new Set(categories.filter(isAvailableCategory).map((c) => c.id));
  if (normalized.some((template) => !availableIds.has(template.category_id))) {
    throw new Error("Quick templates cannot use archived or unavailable categories. Restore the category or choose another.");
  }
  await setUserPreferenceOffline(QUICK_TRANSACTION_TEMPLATES_KEY, normalized);
}
