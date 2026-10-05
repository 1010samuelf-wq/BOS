// Money taken against one order.
//
// The shop's case: "$100 today, $300 on collection". So each payment needs its
// own amount, method and **date** — the date is what the reports use, and money
// isn't always keyed in on the day it arrived.
//
// Deliberately not a single "amount paid" box. A running list is what makes a
// disputed balance answerable: you can see the $100 went in on the 3rd in cash,
// and take it off again if it was entered against the wrong order.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiRequestError } from "../api/client";
import { addOrderPayment, deleteOrderPayment } from "../api/endpoints";
import type { Order, PaymentMethod } from "../api/types";
import { withCents } from "./money";

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "etransfer", label: "E-transfer" },
];

/** Today as yyyy-mm-dd in the browser's own clock, for the date input. */
function todayValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function PaymentsPanel({
  order,
  onChanged,
  onError,
}: {
  order: Order;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [receivedOn, setReceivedOn] = useState(todayValue());
  const [note, setNote] = useState("");

  const settled = () => {
    setOpen(false);
    setAmount("");
    setMethod("");
    setReceivedOn(todayValue());
    setNote("");
    onChanged();
    client.invalidateQueries();
  };

  const fail = (e: unknown) =>
    onError(e instanceof ApiRequestError ? e.message : "That payment didn't go through.");

  const add = useMutation({
    mutationFn: () =>
      addOrderPayment(order.id, {
        amount: withCents(amount.trim()),
        method: method || null,
        received_on: receivedOn,
        note: note.trim() || null,
      }),
    onSuccess: settled,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (paymentId: number) => deleteOrderPayment(order.id, paymentId),
    onSuccess: settled,
    onError: fail,
  });

  const balance = Number(order.balance_due);
  // Guard here as well as on the server: an overpayment is almost always a
  // typo, and saying so before the request is kinder than a red error after it.
  const typed = Number(withCents(amount.trim()));
  const tooMuch = amount.trim() !== "" && Number.isFinite(typed) && typed > balance;
  const valid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && typed > 0 && !tooMuch;

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center" }}>
        <h2 style={{ margin: 0, flex: 1 }}>Payments</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          ${order.amount_paid} of ${order.total}
          {balance > 0 && (
            <>
              {" · "}
              <strong>${order.balance_due} owing</strong>
            </>
          )}
        </div>
      </div>

      {order.payments.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Nothing collected yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Amount</th>
              <th>Method</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {order.payments.map((p) => (
              <tr key={p.id}>
                <td>{p.received_on}</td>
                <td className="num">${p.amount}</td>
                <td>{p.method === "etransfer" ? "E-transfer" : p.method ?? "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>{p.note ?? ""}</td>
                <td>
                  <button
                    className="btn neutral sm"
                    disabled={remove.isPending}
                    title="Remove this payment — it goes to the Deleted page"
                    onClick={() => {
                      // Worth a confirm: removing a payment can take a settled
                      // order back to unpaid and changes the day's takings.
                      if (
                        window.confirm(
                          `Remove the $${p.amount} payment from ${p.received_on}? ` +
                            `It comes off this order's total paid and can be found on the Deleted page.`,
                        )
                      ) {
                        remove.mutate(p.id);
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {balance <= 0 ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Fully paid.
        </p>
      ) : !open ? (
        <button className="btn primary sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
          ＋ Record a payment
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "block" }}>
              <div className="muted" style={{ fontSize: 12 }}>Amount</div>
              <input
                className="input"
                autoFocus
                inputMode="decimal"
                placeholder="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                // Finish the cents on the way out, so "100" reads back as
                // 100.00 — the same behaviour as every other money field here.
                onBlur={() => setAmount((v) => withCents(v))}
                style={{ maxWidth: 110, textAlign: "right" }}
              />
            </label>
            <label style={{ display: "block" }}>
              <div className="muted" style={{ fontSize: 12 }}>Date received</div>
              <input
                className="input"
                type="date"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
                style={{ maxWidth: 160 }}
              />
            </label>
            <label style={{ display: "block" }}>
              <div className="muted" style={{ fontSize: 12 }}>Method</div>
              <select
                className="input"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
                style={{ maxWidth: 150 }}
              >
                <option value="">Not recorded</option>
                {METHODS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", flex: 1, minWidth: 160 }}>
              <div className="muted" style={{ fontSize: 12 }}>Note (optional)</div>
              <input
                className="input"
                placeholder="Deposit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>

          {tooMuch && (
            <p className="muted" style={{ fontSize: 12, color: "var(--warn)", marginTop: 6 }}>
              That's more than the ${order.balance_due} still owing.
            </p>
          )}

          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn primary sm"
              disabled={!valid || add.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? "Recording…" : "Record payment"}
            </button>
            <button
              className="btn neutral sm"
              onClick={() => { setOpen(false); setAmount(""); setNote(""); }}
            >
              Cancel
            </button>
            <button
              className="btn neutral sm"
              title="Fill in whatever is still owed"
              onClick={() => setAmount(order.balance_due)}
            >
              The rest (${order.balance_due})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
