import { supabase, getCurrentUser } from "./supabase";

/**
 * Get the active partnership for the current user.
 * @returns {Promise<Object|null>} Partnership object or null if none active
 */
export async function getPartnership() {
  const user = await getCurrentUser();

  const { data, error } = await supabase
    .from("partnerships")
    .select("*")
    .eq("status", "active")
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Get pending invites addressed to the current user's email.
 * @returns {Promise<Array>} List of pending partnership invites
 */
export async function getPendingInvites() {
  const user = await getCurrentUser();

  const { data, error } = await supabase
    .from("partnerships")
    .select("*")
    .eq("status", "pending")
    .eq("invited_email", user.email)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Get pending invites sent BY the current user.
 * @returns {Promise<Array>} List of pending outgoing invites
 */
export async function getSentInvites() {
  const user = await getCurrentUser();

  const { data, error } = await supabase
    .from("partnerships")
    .select("*")
    .eq("status", "pending")
    .eq("user_a_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Invite a partner by email.
 * @param {string} email - Partner's email address
 * @returns {Promise<Object>} Created partnership
 */
export async function invitePartner(email) {
  const user = await getCurrentUser();

  if (email.toLowerCase() === user.email.toLowerCase()) {
    throw new Error("You cannot invite yourself.");
  }

  // Check if user already has an active partnership
  const existing = await getPartnership();
  if (existing) {
    throw new Error("You already have an active partnership.");
  }

  const { data, error } = await supabase
    .from("partnerships")
    .insert({
      user_a_id: user.id,
      invited_email: email.toLowerCase().trim(),
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A pending invite to this email already exists.");
    }
    throw error;
  }
  return data;
}

/**
 * Accept a pending partnership invite.
 * @param {string} partnershipId - ID of the partnership to accept
 * @returns {Promise<Object>} Updated partnership
 */
export async function acceptInvite(partnershipId) {
  const user = await getCurrentUser();

  // Check if user already has an active partnership
  const existing = await getPartnership();
  if (existing) {
    throw new Error(
      "You already have an active partnership. Dissolve it first.",
    );
  }

  const { data, error } = await supabase
    .from("partnerships")
    .update({
      user_b_id: user.id,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", partnershipId)
    .eq("status", "pending")
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Decline a pending partnership invite.
 * @param {string} partnershipId - ID of the partnership to decline
 */
export async function declineInvite(partnershipId) {
  const { error } = await supabase
    .from("partnerships")
    .delete()
    .eq("id", partnershipId)
    .eq("status", "pending");

  if (error) throw error;
}

/**
 * Cancel a pending invite sent by the current user.
 * @param {string} partnershipId - ID of the partnership to cancel
 */
export async function cancelInvite(partnershipId) {
  const user = await getCurrentUser();

  const { error } = await supabase
    .from("partnerships")
    .delete()
    .eq("id", partnershipId)
    .eq("user_a_id", user.id)
    .eq("status", "pending");

  if (error) throw error;
}

/**
 * Dissolve an active partnership.
 * @param {string} partnershipId - ID of the partnership to dissolve
 * @returns {Promise<Object>} Updated partnership
 */
export async function dissolvePartnership(partnershipId) {
  const { data, error } = await supabase
    .from("partnerships")
    .update({
      status: "dissolved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", partnershipId)
    .eq("status", "active")
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get the partner's user ID from a partnership object.
 * @param {Object} partnership - Partnership object
 * @param {string} currentUserId - Current user's ID
 * @returns {string} Partner's user ID
 */
export function getPartnerId(partnership, currentUserId) {
  return partnership.user_a_id === currentUserId
    ? partnership.user_b_id
    : partnership.user_a_id;
}

/**
 * Get the partner's email from a partnership object.
 * If the current user is the inviter (user_a), the partner's email is stored in invited_email.
 * If the current user is the invitee (user_b), the inviter's email is fetched via an RPC
 * that queries auth.users with a security-definer function scoped to this partnership.
 * @param {Object} partnership - Partnership object
 * @param {string} currentUserId - Current user's ID
 * @returns {Promise<string>} Partner's email
 */
export async function getPartnerEmail(partnership, currentUserId) {
  // Inviter (user_a) → partner's email is simply the invited_email
  if (partnership.user_a_id === currentUserId) {
    return partnership.invited_email;
  }

  // Invitee (user_b) → look up the inviter's email via a security-definer RPC
  const { data, error } = await supabase.rpc("get_partner_email", {
    p_partnership_id: partnership.id,
  });
  if (error) throw error;
  return data;
}
