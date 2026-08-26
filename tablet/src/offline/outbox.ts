// Local write-queue for offline actions (spec: bakery-floor offline mode).
// Each queued action sits here until the app is back online, then replays
// against POST /sync/replay in the order it was queued. Its own AsyncStorage
// key (`bos.outbox`) — deliberately never touched by session/logout logic
// (see AuthContext) so a forced re-login can never destroy unsynced work.

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "bos.outbox";

export type OutboxStatus = "pending" | "conflict" | "rejected";

export interface OutboxEntry {
  client_op_id: string;
  type: string; // server op type, e.g. "time.clock_in"
  acting_user_id: number;
  payload: unknown;
  expected_updated_at: string | null;
  queued_at: string;
  status: OutboxStatus;
  attempts: number;
  last_error?: { code: string; message: string };
  current?: unknown; // server's current state, populated on a conflict
}

let memo: OutboxEntry[] | null = null;

// All reads/writes chain onto one queue, mirroring the serialized-fetch
// pattern in src/api/client.ts — avoids a lost-update race if two enqueues
// happen close together (e.g. a tap while a background flush is mid-write).
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.catch(() => undefined).then(fn);
  chain = result.catch(() => undefined);
  return result;
}

async function load(): Promise<OutboxEntry[]> {
  if (memo) return memo;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  memo = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  return memo;
}

// Notifies listeners (the OutboxProvider) whenever the queue changes, so the
// pending-count banner updates the instant something is enqueued rather than
// only after the next flush attempt.
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function persist(entries: OutboxEntry[]): Promise<void> {
  memo = entries;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  listeners.forEach((fn) => fn());
}

export function enqueue(entry: OutboxEntry): Promise<void> {
  return serialize(async () => {
    const entries = await load();
    await persist([...entries, entry]);
  });
}

export function list(): Promise<OutboxEntry[]> {
  return serialize(load);
}

export async function pendingCount(): Promise<number> {
  const entries = await list();
  return entries.filter((e) => e.status === "pending").length;
}

export function updateEntry(clientOpId: string, patch: Partial<OutboxEntry>): Promise<void> {
  return serialize(async () => {
    const entries = await load();
    await persist(entries.map((e) => (e.client_op_id === clientOpId ? { ...e, ...patch } : e)));
  });
}

export function remove(clientOpId: string): Promise<void> {
  return serialize(async () => {
    const entries = await load();
    await persist(entries.filter((e) => e.client_op_id !== clientOpId));
  });
}

// Test-only: the in-memory cache is a safe assumption in the real app (this
// module is the only thing that ever touches the `bos.outbox` key), but it
// means multiple simulated "app sessions" within one test file would
// otherwise share stale state across tests. Not exported for app code.
export function __resetForTests(): void {
  memo = null;
}
