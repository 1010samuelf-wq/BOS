// Client-side mirror of the backend's op registry (app/services/sync_dispatch.py).
// One entry per action that can be queued offline: how to run it online today
// (the existing endpoints.ts call, untouched), and how to build the payload
// queued for POST /sync/replay when offline. Extended phase by phase as more
// actions become offline-capable — not every mutation in the app is here,
// only the ones scoped for bakery-floor offline work (orders, clock in/out,
// checking off a task).

import {
  addNote,
  cancelOrder,
  clockIn,
  clockOut,
  createOrder,
  fulfillOrder,
  markPaid,
  toggleNoteDone,
  toggleTaskDone,
  updateOrder,
} from "../api/endpoints";
import type { Order, OrderCreatePayload, OrderUpdatePayload, Task, TimeEntry } from "../api/types";

export interface OperationDef<TVars, TResult> {
  serverType: string;
  execute: (vars: TVars) => Promise<TResult>;
  toPayload: (vars: TVars) => Record<string, unknown>;
  // Only orders.update needs this — the order's `updated_at` as last seen by
  // this screen, so the server can detect "this was edited elsewhere while
  // you were offline" instead of silently overwriting it. Lives in the sync
  // envelope's own `expected_updated_at` field (a sibling of `payload`), not
  // inside the payload itself — see useOfflineMutation.ts.
  getExpectedVersion?: (vars: TVars) => string | null;
}

export const OPERATIONS = {
  "orders.create": {
    serverType: "orders.create",
    execute: (vars: OrderCreatePayload) => createOrder(vars),
    toPayload: (vars: OrderCreatePayload) => vars as unknown as Record<string, unknown>,
  } as OperationDef<OrderCreatePayload, Order>,
  "orders.update": {
    serverType: "orders.update",
    execute: (vars: { order_id: number; patch: OrderUpdatePayload; expectedUpdatedAt?: string | null }) =>
      updateOrder(vars.order_id, vars.patch),
    toPayload: (vars: { order_id: number; patch: OrderUpdatePayload; expectedUpdatedAt?: string | null }) => ({
      order_id: vars.order_id,
      ...vars.patch,
    }),
    getExpectedVersion: (vars: { order_id: number; patch: OrderUpdatePayload; expectedUpdatedAt?: string | null }) =>
      vars.expectedUpdatedAt ?? null,
  } as OperationDef<{ order_id: number; patch: OrderUpdatePayload; expectedUpdatedAt?: string | null }, Order>,
  "orders.cancel": {
    serverType: "orders.cancel",
    execute: (vars: { order_id: number; reverse_stock: boolean }) => cancelOrder(vars.order_id, vars.reverse_stock),
    toPayload: (vars: { order_id: number; reverse_stock: boolean }) => vars,
  } as OperationDef<{ order_id: number; reverse_stock: boolean }, Order>,
  "orders.markPaid": {
    serverType: "orders.mark_paid",
    execute: (vars: { order_id: number; payment_method?: string }) => markPaid(vars.order_id, vars.payment_method),
    toPayload: (vars: { order_id: number; payment_method?: string }) => vars,
  } as OperationDef<{ order_id: number; payment_method?: string }, Order>,
  "orders.fulfill": {
    serverType: "orders.fulfill",
    execute: (vars: { order_id: number }) => fulfillOrder(vars.order_id),
    toPayload: (vars: { order_id: number }) => vars,
  } as OperationDef<{ order_id: number }, Order>,
  "orders.addNote": {
    serverType: "orders.add_note",
    execute: (vars: { order_id: number; text: string; type?: "general" | "payment" }) => addNote(vars.order_id, vars.text, vars.type),
    toPayload: (vars: { order_id: number; text: string; type?: "general" | "payment" }) => vars,
  } as OperationDef<{ order_id: number; text: string; type?: "general" | "payment" }, Order>,
  "orders.toggleNote": {
    serverType: "orders.toggle_note_done",
    execute: (vars: { order_id: number; note_id: number; done?: boolean }) =>
      toggleNoteDone(vars.order_id, vars.note_id, vars.done),
    toPayload: (vars: { order_id: number; note_id: number; done?: boolean }) => vars,
  } as OperationDef<{ order_id: number; note_id: number; done?: boolean }, Order>,
  "tasks.setDone": {
    serverType: "tasks.set_done",
    execute: (vars: { task_id: number; done: boolean }) => toggleTaskDone(vars.task_id, vars.done),
    toPayload: (vars: { task_id: number; done: boolean }) => vars,
  } as OperationDef<{ task_id: number; done: boolean }, Task>,
  "time.clockIn": {
    serverType: "time.clock_in",
    execute: () => clockIn(),
    toPayload: () => ({}),
  } as OperationDef<void, TimeEntry>,
  "time.clockOut": {
    serverType: "time.clock_out",
    execute: () => clockOut(),
    toPayload: () => ({}),
  } as OperationDef<void, TimeEntry>,
};

export type OpType = keyof typeof OPERATIONS;
