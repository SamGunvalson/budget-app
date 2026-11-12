/**
 * Client-side row id (RFC 4122 version 4 UUID).
 *
 * Creates pick their id before the backend is tried so that, if the response
 * is lost after the insert commits, the queued retry upserts the same row
 * instead of adding a second copy.
 *
 * `crypto.randomUUID` only exists in secure contexts; plain-http self-hosted
 * origins fall back to `crypto.getRandomValues`.
 */
export function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
