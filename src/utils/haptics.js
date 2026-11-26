import { Capacitor } from '@capacitor/core';

/**
 * Light haptic feedback for completed actions in the native Android app.
 * No-op on the web, and never throws: feedback must not break a save.
 * The plugin is imported lazily so the web bundle does not carry it.
 */
async function withHaptics(run) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const plugin = await import('@capacitor/haptics');
    await run(plugin);
  } catch {
    // Device without a vibrator, plugin not synced, etc. — ignore.
  }
}

/** Something was saved (transaction added, budget saved, settled up). */
export function hapticSuccess() {
  return withHaptics(({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Success }),
  );
}

/** A small confirmation tap (e.g. a pending transaction confirmed). */
export function hapticTap() {
  return withHaptics(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }));
}
