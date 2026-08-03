// A shift-device tablet is rarely fully force-closed (usually just
// backgrounded), so expo-updates' default "check once at cold start, apply on
// the *next* cold start" behavior can leave a published update sitting
// downloaded-but-never-applied for days. Actively check on launch and every
// time the app returns to the foreground, and reload as soon as one is ready.

import { useEffect } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

async function checkAndApply() {
  if (!Updates.isEnabled) return; // no-op in Expo Go / dev client
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // Best-effort — a failed check (offline, etc.) just means we keep
    // running on whatever's currently loaded; never crash the app over this.
  }
}

export function useOTAUpdates() {
  useEffect(() => {
    void checkAndApply(); // on launch

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkAndApply();
    });
    return () => sub.remove();
  }, []);
}
