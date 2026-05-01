import { supabase, getCurrentUser } from "./supabase";

/**
 * Fetch all active categories for the current user.
 * @returns {Promise<Array>} List of category objects
 */
export async function getCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("type")
    .order("sort_order")
    .order("name");

  if (error) throw error;
  return data;
}

/**
 * Bulk-update sort_order for multiple categories.
 *
 * Phase 4: a single Postgres RPC (`bulk_update_category_sort_order`) replaces
 * the per-row UPDATE fan-out. One round-trip regardless of category count.
 *
 * @param {Array<{ id: string, sort_order: number }>} items
 * @returns {Promise<void>}
 */
export async function bulkUpdateSortOrder(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const { error } = await supabase.rpc("bulk_update_category_sort_order", {
    p_items: items.map(({ id, sort_order }) => ({ id, sort_order })),
  });
  if (error) throw error;
}

/**
 * Create a new category for the current user.
 * @param {{ name: string, type: string, color: string }} category
 * @returns {Promise<Object>} Created category
 */
export async function createCategory({ name, type, color }) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: user.id,
      name: name.trim(),
      type,
      color,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update a category's name, color, and/or type.
 * @param {string} id - Category UUID
 * @param {{ name?: string, color?: string, type?: string }} updates
 * @returns {Promise<Object>} Updated category
 */
export async function updateCategory(id, { name, color, type }) {
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (color !== undefined) updates.color = color;
  if (type !== undefined) updates.type = type;
  if (updates.sort_order === undefined) delete updates.sort_order; // ignore if not set

  const { data, error } = await supabase
    .from("categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Soft-delete a category by setting is_active = false.
 * @param {string} id - Category UUID
 * @returns {Promise<void>}
 */
export async function deleteCategory(id) {
  const { error } = await supabase
    .from("categories")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw error;
}

// ── User Preferences ──

/**
 * Get a user preference by key.
 * @param {string} key - Preference key (e.g., 'type_group_order')
 * @returns {Promise<any|null>} The preference value, or null if not set
 */
export async function getUserPreference(key) {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("preference_value")
    .eq("preference_key", key)
    .maybeSingle();

  if (error) throw error;
  return data?.preference_value ?? null;
}

/**
 * Upsert a user preference.
 * @param {string} key - Preference key
 * @param {any} value - JSON-serializable value
 * @returns {Promise<void>}
 */
export async function setUserPreference(key, value) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      preference_key: key,
      preference_value: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,preference_key" },
  );

  if (error) throw error;
}
