// Keeps a small on-device copy of "the last data this screen successfully
// showed" (spec: bakery-floor offline mode). Needed alongside React Query's
// own persisted cache because Production/Deliveries key their query by a
// date range computed fresh from "today" on every mount — a cache entry from
// yesterday is unreachable by key once the date rolls over, so a baker
// opening the app offline the next morning would otherwise see a blank
// screen even though the persister is working correctly. This is a fallback
// of last resort: whatever was last actually seen, independent of preset.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

interface Snapshot<T> {
  data: T;
  fetchedAt: number;
}

export function useOfflineSnapshot<T>(storageKey: string, liveData: T | undefined) {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (raw) setSnapshot(JSON.parse(raw) as Snapshot<T>);
      })
      .finally(() => setHydrated(true));
  }, [storageKey]);

  useEffect(() => {
    if (liveData === undefined) return;
    const next: Snapshot<T> = { data: liveData, fetchedAt: Date.now() };
    setSnapshot(next);
    void AsyncStorage.setItem(storageKey, JSON.stringify(next));
  }, [liveData, storageKey]);

  const usingSnapshot = liveData === undefined && !!snapshot;
  return {
    data: liveData ?? (hydrated ? snapshot?.data : undefined),
    usingSnapshot,
    fetchedAt: snapshot?.fetchedAt ?? null,
    hydrated,
  };
}
