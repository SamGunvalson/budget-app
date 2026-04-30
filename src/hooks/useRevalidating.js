import { useEffect, useState } from "react";
import { getRevalidating, subscribeRevalidating } from "../services/cache";

/**
 * Reactive boolean: `true` whenever at least one cache-first SWR read is
 * performing a background revalidation. Powers the small "Refreshing…"
 * pill in the TopBar so users can see when the cached data they're looking
 * at is being verified against the server.
 */
export default function useRevalidating() {
  const [value, setValue] = useState(getRevalidating);

  useEffect(() => subscribeRevalidating(setValue), []);

  return value;
}
