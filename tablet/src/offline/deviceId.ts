// A stable per-install id sent with every sync batch (spec: bakery-floor
// offline mode) — lets the backend's synced_operations audit log tell which
// tablet a queued action came from. Generated once and cached in memory +
// AsyncStorage; reuses the same id-shape as order idempotency keys.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { newIdempotencyKey } from "../order/orderDraft";

const STORAGE_KEY = "bos.device_id";

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cached = stored;
    return stored;
  }
  const fresh = newIdempotencyKey();
  await AsyncStorage.setItem(STORAGE_KEY, fresh);
  cached = fresh;
  return fresh;
}
