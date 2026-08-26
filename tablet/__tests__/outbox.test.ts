// Real behavior of the offline write-queue (spec: bakery-floor offline mode) —
// enqueue/list/update/remove against a storage backend, not hand-built
// literals. The project's jest config runs under plain Node (no jsdom), and
// the real AsyncStorage native module needs a `window`, so it's replaced here
// with a minimal in-memory stand-in — this is the standard way to unit-test
// AsyncStorage-backed code without pulling in a full RN test renderer.
// Each test clears storage first so entries from one test can't leak into
// the next.

jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: (key: string) => Promise.resolve(store[key] ?? null),
      setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
      removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
      clear: () => { store = {}; return Promise.resolve(); },
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";

import * as outbox from "../src/offline/outbox";
import type { OutboxEntry } from "../src/offline/outbox";

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    client_op_id: "op-1",
    type: "time.clock_in",
    acting_user_id: 7,
    payload: {},
    expected_updated_at: null,
    queued_at: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  outbox.__resetForTests();
});

describe("outbox", () => {
  it("starts empty", async () => {
    expect(await outbox.list()).toEqual([]);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it("enqueues and lists an entry", async () => {
    await outbox.enqueue(makeEntry());
    const entries = await outbox.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].client_op_id).toBe("op-1");
    expect(entries[0].status).toBe("pending");
  });

  it("persists across a fresh module read (survives an app restart)", async () => {
    await outbox.enqueue(makeEntry({ client_op_id: "op-2" }));
    // Read storage directly, bypassing the in-memory cache, to prove it's
    // actually on disk and not just held in a JS variable.
    const raw = await AsyncStorage.getItem("bos.outbox");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.some((e: OutboxEntry) => e.client_op_id === "op-2")).toBe(true);
  });

  it("only counts pending entries, not conflict/rejected ones", async () => {
    await outbox.enqueue(makeEntry({ client_op_id: "op-3", status: "pending" }));
    await outbox.enqueue(makeEntry({ client_op_id: "op-4", status: "conflict" }));
    await outbox.enqueue(makeEntry({ client_op_id: "op-5", status: "rejected" }));
    expect(await outbox.pendingCount()).toBe(1);
  });

  it("updateEntry patches only the matching entry", async () => {
    await outbox.enqueue(makeEntry({ client_op_id: "op-6" }));
    await outbox.enqueue(makeEntry({ client_op_id: "op-7" }));
    await outbox.updateEntry("op-6", { status: "conflict", last_error: { code: "stale_version", message: "changed" } });

    const entries = await outbox.list();
    const six = entries.find((e) => e.client_op_id === "op-6")!;
    const seven = entries.find((e) => e.client_op_id === "op-7")!;
    expect(six.status).toBe("conflict");
    expect(six.last_error?.code).toBe("stale_version");
    expect(seven.status).toBe("pending"); // untouched
  });

  it("remove deletes only the matching entry", async () => {
    await outbox.enqueue(makeEntry({ client_op_id: "op-8" }));
    await outbox.enqueue(makeEntry({ client_op_id: "op-9" }));
    await outbox.remove("op-8");

    const entries = await outbox.list();
    expect(entries.map((e) => e.client_op_id)).toEqual(["op-9"]);
  });

  it("notifies subscribers on every change", async () => {
    const seen: number[] = [];
    const unsubscribe = outbox.subscribe(() => { seen.push(1); });

    await outbox.enqueue(makeEntry({ client_op_id: "op-10" }));
    await outbox.updateEntry("op-10", { status: "rejected" });
    await outbox.remove("op-10");

    unsubscribe();
    expect(seen.length).toBe(3); // one notification per mutation
  });

  it("serializes concurrent enqueues instead of losing one to a race", async () => {
    // Fire several enqueues without awaiting between them — if reads/writes
    // weren't serialized, a "load current list, append, save" race could
    // drop one of these.
    await Promise.all([
      outbox.enqueue(makeEntry({ client_op_id: "op-a" })),
      outbox.enqueue(makeEntry({ client_op_id: "op-b" })),
      outbox.enqueue(makeEntry({ client_op_id: "op-c" })),
    ]);
    const ids = (await outbox.list()).map((e) => e.client_op_id).sort();
    expect(ids).toEqual(["op-a", "op-b", "op-c"]);
  });
});
