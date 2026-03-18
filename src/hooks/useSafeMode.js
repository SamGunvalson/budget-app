import { useContext } from "react";
import { SafeModeContext } from "../contexts/safeModeContextValue";

/**
 * Consume the SafeModeContext.
 * Returns `{ isSafeMode: boolean, toggleSafeMode: () => Promise<void> }`.
 */
export default function useSafeMode() {
  const ctx = useContext(SafeModeContext);
  if (!ctx)
    throw new Error("useSafeMode must be used within a <SafeModeProvider>");
  return ctx;
}
