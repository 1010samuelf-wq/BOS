// Thin wrapper around useMutation: online, behaves exactly like today (calls
// the real endpoint). Offline, enqueues into the local outbox instead of
// failing, and reports back { queued: true } so the caller can show "will
// sync" instead of a normal success state. This is the one place enqueue/
// replay logic lives — each call site just swaps useMutation for this.

import { useMutation } from "@tanstack/react-query";

import { newIdempotencyKey } from "../order/orderDraft";
import { useAuth } from "../auth/AuthContext";
import { useConnectivity } from "./connectivity";
import { OPERATIONS, OpType } from "./operations";
import * as outbox from "./outbox";

export interface Queued {
  queued: true;
}

type ResultOf<K extends OpType> = Awaited<ReturnType<(typeof OPERATIONS)[K]["execute"]>>;

export function useOfflineMutation<K extends OpType>(
  opType: K,
  opts?: {
    onSuccess?: (result: ResultOf<K> | Queued) => void;
    onError?: (e: unknown) => void;
  },
) {
  const { user } = useAuth();
  const { isOffline } = useConnectivity();

  return useMutation({
    mutationFn: async (
      vars: Parameters<(typeof OPERATIONS)[K]["execute"]>[0],
    ): Promise<ResultOf<K> | Queued> => {
      const def = OPERATIONS[opType] as (typeof OPERATIONS)[K];
      if (!isOffline) {
        // Same union-narrowing limitation TS has with generic indexed access
        // on a mapped const object — runtime behavior is exactly def.execute(vars).
        return (def.execute as unknown as (v: unknown) => Promise<ResultOf<K>>)(vars);
      }
      if (!user) throw new Error("Not signed in.");
      const getExpectedVersion = def.getExpectedVersion as ((v: unknown) => string | null) | undefined;
      await outbox.enqueue({
        client_op_id: newIdempotencyKey(),
        type: def.serverType,
        acting_user_id: user.id,
        payload: (def.toPayload as unknown as (v: unknown) => Record<string, unknown>)(vars),
        expected_updated_at: getExpectedVersion ? getExpectedVersion(vars) : null,
        queued_at: new Date().toISOString(),
        status: "pending",
        attempts: 0,
      });
      return { queued: true };
    },
    onSuccess: opts?.onSuccess,
    onError: opts?.onError,
  });
}
