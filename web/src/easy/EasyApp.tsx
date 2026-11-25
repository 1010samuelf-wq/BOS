// Just Cake Easy — every screen. Few words, big pictures, big buttons, one
// thing per screen. Anything that hands money over or closes an order asks for
// a second tap, so a brushed button can't do it by accident.
//
// What it deliberately leaves out: reports, settings, bookkeeping, and the
// problem checker (the owner's call — those live on the dashboard). The
// assistant is here, with the same confirm-before-anything-changes rule as on
// the dashboard.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { AssistantProposal, Order, Product } from "../api/types";
import { stablePrefix } from "../assistant/partial";
import { streamChat } from "../assistant/stream";
import { useAuth } from "../auth/AuthContext";
import {
  add,
  count,
  dayOf,
  dollars,
  emojiFor,
  missing,
  takeOne,
  toPayload,
  totalCents,
  type Cart,
  type Customer,
} from "./cart";
import { parseAmount, unpaidBills, vendorsByOwed } from "./books";
import { dayLabel, groupByDay, timeOf } from "./upcoming";

type Screen = "home" | "order" | "today" | "books" | "ask";

/** A PIN this long signs in without pressing ✓ (admin and manager PINs are 6). */
const AUTO_PIN = 6;

const PEOPLE_COLORS = ["#ff7a59", "#4f8cff", "#2bb673", "#a35cff", "#ffb020", "#ff5c8a", "#14b8c4", "#8a6b4f"];

const errorText = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Can't reach the shop's computer. Check the wifi.");

export default function EasyApp() {
  const { user } = useAuth();
  const [screen, setScreen] = useState<Screen>("home");
  // A new person starts at home, not on whatever the last one left open.
  useEffect(() => {
    setScreen("home");
  }, [user?.id]);

  if (!user) return <SignIn />;
  const back = () => setScreen("home");
  return (
    <div className="easy">
      {screen === "home" && <Home go={setScreen} />}
      {screen === "order" && <NewOrder onDone={back} />}
      {screen === "today" && <Today onBack={back} />}
      {screen === "books" && <Books onBack={back} />}
      {screen === "ask" && <Ask onBack={back} />}
    </div>
  );
}

/** `sub` for a screen inside a screen: its button goes back a step, not home. */
function TopBar({ title, onBack, sub = false }: { title: string; onBack: () => void; sub?: boolean }) {
  return (
    <div className="easy-top">
      <button className="easy-back" onClick={onBack}>{sub ? "← Back" : "← Home"}</button>
      <h1>{title}</h1>
    </div>
  );
}

// ---------------------------------------------------------------------------
// sign in
// ---------------------------------------------------------------------------
function SignIn() {
  const roster = useQuery({ queryKey: ["roster"], queryFn: api.fetchRoster });
  const { login } = useAuth();
  const [who, setWho] = useState<{ id: number; name: string; color: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async (full: string) => {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      await login({ user_id: who.id }, full);
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.code === "pin_not_set"
          ? "You don't have a PIN yet. Ask the manager to set one up."
          : errorText(e),
      );
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (!who) {
    return (
      <div className="easy easy-signin">
        <h1 className="easy-hello">👋 Who are you?</h1>
        {roster.isError && <p className="easy-error">{errorText(roster.error)}</p>}
        <div className="easy-people">
          {(roster.data ?? []).map((p, i) => {
            const color = PEOPLE_COLORS[i % PEOPLE_COLORS.length];
            return (
              <button key={p.id} className="easy-person" style={{ background: color }}
                onClick={() => setWho({ id: p.id, name: p.name, color })}>
                <span className="easy-initial">{p.name.trim().charAt(0).toUpperCase()}</span>
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="easy easy-signin">
      <h1 className="easy-hello">Hi {who.name}! Your PIN:</h1>
      <div className="easy-dots">
        {Array.from({ length: Math.max(AUTO_PIN, pin.length) }).map((_, i) => (
          <span key={i} className={i < pin.length ? "on" : ""} style={i < pin.length ? { background: who.color } : undefined} />
        ))}
      </div>
      {error && <p className="easy-error">{error}</p>}
      <div className="easy-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map((k) => (
          <button key={k} disabled={busy}
            className={k === "✓" ? "go" : k === "⌫" ? "erase" : ""}
            onClick={() => {
              if (k === "⌫") setPin(pin.slice(0, -1));
              else if (k === "✓") { if (pin) void enter(pin); }
              else if (pin.length < 8) {
                const next = pin + k;
                setPin(next);
                // Six digits is a whole PIN for everyone, so go straight in;
                // a shorter one (bakers can keep four) still uses ✓.
                if (next.length === AUTO_PIN) void enter(next);
              }
            }}>
            {k}
          </button>
        ))}
      </div>
      <button className="easy-link" onClick={() => { setWho(null); setPin(""); setError(null); }}>← Not me</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------
function Home({ go }: { go: (s: Screen) => void }) {
  const { user, logout } = useAuth();
  const sections = user?.sections ?? [];
  const ai = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus });

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const tiles: { screen: Screen; icon: string; label: string; color: string; show: boolean }[] = [
    { screen: "order", icon: "🛒", label: "New order", color: "#ff7a59", show: sections.includes("orders") },
    { screen: "today", icon: "📋", label: "Orders", color: "#4f8cff", show: sections.includes("orders") },
    { screen: "books", icon: "📒", label: "Bookkeeping", color: "#2bb673", show: sections.includes("bookkeeping") },
    { screen: "ask", icon: "💬", label: "Ask Claude", color: "#a35cff", show: !!ai.data?.enabled },
  ];

  return (
    <div className="easy-home">
      <div className="easy-greet">
        <div>
          <h1>Hi {user?.name}! 🎂</h1>
          <p>{today}</p>
        </div>
        <button className="easy-link" onClick={logout}>Sign out</button>
      </div>
      <div className="easy-tiles">
        {tiles.filter((t) => t.show).map((t) => (
          <button key={t.screen} className="easy-tile" style={{ background: t.color }} onClick={() => go(t.screen)}>
            <span className="easy-tile-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// new order
// ---------------------------------------------------------------------------
function ProductPicture({ p, size }: { p: Product; size: number }) {
  return p.photo_url ? (
    <img src={p.photo_url} alt="" style={{ width: size, height: size }} className="easy-photo" />
  ) : (
    <span className="easy-photo easy-emoji" style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {emojiFor(p.category)}
    </span>
  );
}

const blankCustomer = (): Customer => ({
  name: "", phone: "", when: "today", delivery: false, address: "", paying: "later", expect: null,
});

function NewOrder({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const products = useQuery({ queryKey: ["products", true], queryFn: () => api.listProducts(true) });
  const [step, setStep] = useState<"pick" | "who" | "saved">("pick");
  const [cart, setCart] = useState<Cart>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer>(blankCustomer);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  // One key per order attempt: a double tap or a retry after bad wifi can't
  // make two orders.
  const key = useRef(`easy-${crypto.randomUUID()}`);

  const categories = useMemo(
    () => [...new Set((products.data ?? []).map((p) => p.category ?? "Other"))].sort(),
    [products.data],
  );
  const shown = (products.data ?? []).filter((p) => !category || (p.category ?? "Other") === category);
  const qty = (id: number) => cart.find((l) => l.product.id === id)?.quantity ?? 0;

  const place = useMutation({
    mutationFn: () => api.createOrder(toPayload(cart, customer, key.current)),
    onSuccess: (o) => {
      setSavedId(o.id);
      setStep("saved");
      client.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => setProblem(errorText(e)),
  });

  const startOver = () => {
    setCart([]);
    setCustomer(blankCustomer());
    setCategory(null);
    setProblem(null);
    setSavedId(null);
    key.current = `easy-${crypto.randomUUID()}`;
    setStep("pick");
  };
  const set = (patch: Partial<Customer>) => setCustomer((c) => ({ ...c, ...patch }));

  if (step === "saved") {
    return (
      <div className="easy-done">
        <div className="easy-big-icon">✅</div>
        <h1>Order #{savedId} is saved!</h1>
        <p>{customer.name} · {dollars(totalCents(cart))}</p>
        <div className="easy-row">
          <button className="easy-btn" style={{ background: "#ff7a59" }} onClick={startOver}>🛒 Another order</button>
          <button className="easy-btn" style={{ background: "#4f8cff" }} onClick={onDone}>🏠 Home</button>
        </div>
      </div>
    );
  }

  if (step === "who") {
    return (
      <div className="easy-screen">
        <TopBar title="Who is it for?" onBack={() => setStep("pick")} sub />
        <div className="easy-form">
          <label>Name<input value={customer.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></label>
          <label>Phone<input value={customer.phone} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} /></label>

          <div className="easy-label">When?</div>
          <div className="easy-choice">
            <Choice on={customer.when === "today"} onClick={() => set({ when: "today" })}>📅 Today</Choice>
            <Choice on={customer.when === "tomorrow"} onClick={() => set({ when: "tomorrow" })}>⏭ Tomorrow</Choice>
            <label className={`easy-choice-btn${!["today", "tomorrow"].includes(customer.when) ? " on" : ""}`}>
              🗓 Other day
              <input type="date" value={["today", "tomorrow"].includes(customer.when) ? "" : customer.when}
                onChange={(e) => set({ when: e.target.value || "today" })} />
            </label>
          </div>

          <div className="easy-label">Pickup or delivery?</div>
          <div className="easy-choice">
            <Choice on={!customer.delivery} onClick={() => set({ delivery: false })}>🏪 Pickup</Choice>
            <Choice on={customer.delivery} onClick={() => set({ delivery: true })}>🚚 Delivery</Choice>
          </div>
          {customer.delivery && (
            <label>Address<input value={customer.address} onChange={(e) => set({ address: e.target.value })} /></label>
          )}

          <div className="easy-label">Paid?</div>
          <div className="easy-choice">
            <Choice on={customer.paying === "cash"} onClick={() => set({ paying: "cash" })}>💵 Cash now</Choice>
            <Choice on={customer.paying === "card"} onClick={() => set({ paying: "card" })}>💳 Card now</Choice>
            <Choice on={customer.paying === "later"} onClick={() => set({ paying: "later" })}>⏳ Later</Choice>
          </div>
          {customer.paying === "later" && (
            <>
              <div className="easy-label">How will they pay?</div>
              <div className="easy-choice">
                <Choice on={customer.expect === "cash"} onClick={() => set({ expect: "cash" })}>💵 Cash</Choice>
                <Choice on={customer.expect === "card"} onClick={() => set({ expect: "card" })}>💳 Card</Choice>
                <Choice on={customer.expect === "etransfer"} onClick={() => set({ expect: "etransfer" })}>📲 E-transfer</Choice>
                <Choice on={customer.expect === null} onClick={() => set({ expect: null })}>🤷 Not sure</Choice>
              </div>
            </>
          )}
        </div>
        <div className="easy-bar">
          <span>🧺 {count(cart)} · <b>{dollars(totalCents(cart))}</b> · {dayOf(customer.when)}</span>
          {problem && <span className="easy-error">{problem}</span>}
          <button className="easy-btn go" disabled={place.isPending}
            onClick={() => {
              const why = missing(cart, customer);
              if (why) setProblem(why);
              else { setProblem(null); place.mutate(); }
            }}>
            {place.isPending ? "Saving…" : "✓ Save order"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="easy-screen">
      <TopBar title="What are they ordering?" onBack={onDone} />
      <div className="easy-cats">
        <Choice on={category === null} onClick={() => setCategory(null)}>⭐ Everything</Choice>
        {categories.map((c) => (
          <Choice key={c} on={category === c} onClick={() => setCategory(c)}>{emojiFor(c)} {c}</Choice>
        ))}
      </div>
      {products.isError && <p className="easy-error">{errorText(products.error)}</p>}
      {products.isLoading && <p className="easy-wait">Loading…</p>}
      <div className="easy-products">
        {shown.map((p) => (
          <div key={p.id} className={`easy-product${qty(p.id) ? " picked" : ""}`}>
            <button className="easy-product-main" onClick={() => setCart((c) => add(c, p))}>
              <ProductPicture p={p} size={110} />
              <span className="easy-product-name">{p.name}</span>
              <span className="easy-price">${p.price}</span>
            </button>
            {qty(p.id) > 0 && (
              <div className="easy-qty">
                <button onClick={() => setCart((c) => takeOne(c, p.id))}>−</button>
                <b>{qty(p.id)}</b>
                <button onClick={() => setCart((c) => add(c, p))}>+</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="easy-bar">
        <span>🧺 {count(cart)} item{count(cart) === 1 ? "" : "s"} · <b>{dollars(totalCents(cart))}</b></span>
        <button className="easy-btn go" disabled={cart.length === 0} onClick={() => { setProblem(null); setStep("who"); }}>
          Next →
        </button>
      </div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`easy-choice-btn${on ? " on" : ""}`} onClick={onClick}>{children}</button>
  );
}

// ---------------------------------------------------------------------------
// today's orders
// ---------------------------------------------------------------------------
/** A button that needs a second tap within a few seconds. */
function TwoTap({ label, confirm, color, onConfirm, disabled }: {
  label: string; confirm: string; color: string; onConfirm: () => void; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`easy-btn small${armed ? " armed" : ""}`} style={{ background: armed ? "#222" : color }}
      disabled={disabled}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? confirm : label}
    </button>
  );
}

type OrdersView = "today" | "tomorrow" | "upcoming";

function Today({ onBack }: { onBack: () => void }) {
  const client = useQueryClient();
  const [which, setWhich] = useState<OrdersView>("today");
  const today = dayOf("today");
  const orders = useQuery({
    queryKey: ["orders", "easy", which, today],
    // date_field "needed": these are orders *due* on the day, not ones taken
    // on it — the list filters on the order date unless told otherwise.
    queryFn: () =>
      which === "upcoming"
        ? api.listOrders({
            from: today, date_field: "needed", sort: "needed_asc",
            fulfillment_status: "pending", exclude_cancelled: true, limit: 200,
          })
        : api.listOrders({
            from: dayOf(which), to: dayOf(which), date_field: "needed",
            exclude_cancelled: true, limit: 200,
          }),
    refetchInterval: 30_000,
  });
  const [problem, setProblem] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setProblem(null); client.invalidateQueries({ queryKey: ["orders"] }); },
    onError: (e) => setProblem(errorText(e)),
  });

  const items = orders.data?.items ?? [];
  const card = (o: Order) => <OrderCard key={o.id} o={o} busy={act.isPending} act={(fn) => act.mutate(fn)} />;
  const empty = { today: "No orders today. 🎉", tomorrow: "No orders tomorrow.", upcoming: "Nothing coming up. 🎉" }[which];
  return (
    <div className="easy-screen">
      <TopBar title="Orders" onBack={onBack} />
      <div className="easy-choice" style={{ padding: "0 20px" }}>
        <Choice on={which === "today"} onClick={() => setWhich("today")}>📅 Today</Choice>
        <Choice on={which === "tomorrow"} onClick={() => setWhich("tomorrow")}>⏭ Tomorrow</Choice>
        <Choice on={which === "upcoming"} onClick={() => setWhich("upcoming")}>🗓 Coming up</Choice>
      </div>
      {problem && <p className="easy-error">{problem}</p>}
      {orders.isError && (
        <p className="easy-error">{errorText(orders.error)} <button className="easy-link" onClick={() => orders.refetch()}>Try again</button></p>
      )}
      {orders.isLoading && <p className="easy-wait">Loading…</p>}
      {orders.data && items.length === 0 && <p className="easy-wait">{empty}</p>}
      {which === "upcoming" ? (
        <div className="easy-days">
          {groupByDay(items).map((g) => (
            <section key={g.day}>
              <h2 className="easy-day">
                {g.label} <span>{g.orders.length} order{g.orders.length === 1 ? "" : "s"}</span>
              </h2>
              <div className="easy-orders">{g.orders.map(card)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="easy-orders scroll">
          {[...items]
            .sort((a, b) => rank(a) - rank(b) || (a.needed_for_date ?? "").localeCompare(b.needed_for_date ?? ""))
            .map(card)}
        </div>
      )}
    </div>
  );
}

function OrderCard({ o, busy, act }: { o: Order; busy: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const done = o.fulfillment_status === "fulfilled";
  const ready = o.status === "ready";
  const unpaid = o.paid_status === "unpaid";
  const color = done ? "#2bb673" : ready ? "#4f8cff" : "#ff7a59";
  const time = timeOf(o.needed_for_date);
  return (
    <div className="easy-order" style={{ borderColor: color }}>
      <div className="easy-order-head" style={{ background: color }}>
        <span>{time && <>🕑 {time} · </>}#{o.id} {o.client_name}</span>
        <span>{done ? "✅ Done" : ready ? "📦 Ready" : "🥣 Not ready"}</span>
      </div>
      <ul>
        {o.items.map((i) => <li key={i.id}><b>{i.quantity}×</b> {i.product_name}</li>)}
      </ul>
      <div className="easy-order-foot">
        <span>{o.fulfillment_type === "delivery" ? "🚚 Delivery" : "🏪 Pickup"}</span>
        <span className={unpaid ? "easy-owes" : "easy-paid"}>
          {unpaid ? `💰 Owes $${o.balance_due}` : "💵 Paid"}
        </span>
      </div>
      {!done && (
        <div className="easy-row">
          {!ready && (
            <button key="ready" className="easy-btn small" style={{ background: "#4f8cff" }} disabled={busy}
              onClick={() => act(() => api.updateOrderStatus(o.id, "ready"))}>
              📦 Ready
            </button>
          )}
          {unpaid && (
            <TwoTap key="paid" label={`💵 Paid $${o.balance_due}`} confirm="Tap again: paid?" color="#2bb673"
              disabled={busy}
              onConfirm={() => act(() => api.markPaid(o.id))} />
          )}
          {/* Keyed: when Ready disappears the others shift left, and an
              unkeyed TwoTap would be rebuilt and forget its first tap. */}
          <TwoTap key="done" label={o.fulfillment_type === "delivery" ? "🚚 Delivered" : "🙌 Picked up"}
            confirm="Tap again: done?" color="#a35cff" disabled={busy}
            onConfirm={() => act(() => api.fulfillOrder(o.id))} />
        </div>
      )}
    </div>
  );
}

/** Still to do first, then ready, then done. */
function rank(o: Order): number {
  if (o.fulfillment_status === "fulfilled") return 2;
  return o.status === "ready" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// bookkeeping: vendor bills and expenses
// ---------------------------------------------------------------------------
type BooksView = { kind: "list" } | { kind: "vendor"; id: number } | { kind: "expense" };

function Books({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const canExpense = (user?.sections ?? []).includes("reports");
  const [view, setView] = useState<BooksView>({ kind: "list" });
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => api.listCompanies() });

  if (view.kind === "vendor") return <Vendor id={view.id} onBack={() => setView({ kind: "list" })} />;
  if (view.kind === "expense") return <AddExpense onBack={() => setView({ kind: "list" })} />;

  const vendors = vendorsByOwed(companies.data ?? []);
  return (
    <div className="easy-screen">
      <TopBar title="Bookkeeping" onBack={onBack} />
      <div className="easy-scroll">
        {canExpense && (
          <button className="easy-btn wide" style={{ background: "#ff7a59" }} onClick={() => setView({ kind: "expense" })}>
            💸 Add an expense
          </button>
        )}
        <h2 className="easy-day">Vendors <span>tap one to see and pay its bills</span></h2>
        {companies.isError && (
          <p className="easy-error">{errorText(companies.error)} <button className="easy-link" onClick={() => companies.refetch()}>Try again</button></p>
        )}
        {companies.isLoading && <p className="easy-wait">Loading…</p>}
        {companies.data && vendors.length === 0 && <p className="easy-wait">No vendors yet — add them on the dashboard.</p>}
        <div className="easy-vendors">
          {vendors.map((c) => {
            const owed = Number(c.balance) > 0;
            return (
              <button key={c.id} className="easy-vendor" onClick={() => setView({ kind: "vendor", id: c.id })}>
                <span className="easy-vendor-name">🏭 {c.name}</span>
                <span className={owed ? "easy-owes" : "easy-paid"}>{owed ? `We owe $${c.balance}` : "✅ All paid"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Vendor({ id, onBack }: { id: number; onBack: () => void }) {
  const client = useQueryClient();
  const vendor = useQuery({ queryKey: ["company", id], queryFn: () => api.getCompany(id) });
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [day, setDay] = useState(dayOf("today"));
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["company", id] });
    client.invalidateQueries({ queryKey: ["companies"] });
  };
  const pay = useMutation({
    mutationFn: (entryId: number) => api.markLedgerPaid(id, entryId, dayOf("today")),
    onSuccess: () => { setProblem(null); refresh(); },
    onError: (e) => setProblem(errorText(e)),
  });
  const addBill = useMutation({
    mutationFn: (amt: string) =>
      api.addLedgerEntry(id, { entry_date: day, type: "charge", amount: amt, invoice_number: invoice.trim() || null }),
    onSuccess: () => { setAdding(false); setAmount(""); setInvoice(""); setProblem(null); refresh(); },
    onError: (e) => setProblem(errorText(e)),
  });

  const bills = unpaidBills(vendor.data?.entries ?? []);
  return (
    <div className="easy-screen">
      <TopBar title={vendor.data?.name ?? "Vendor"} onBack={onBack} sub />
      <div className="easy-scroll">
        {vendor.isError && <p className="easy-error">{errorText(vendor.error)}</p>}
        {vendor.data && (
          <p className="easy-total">
            {Number(vendor.data.balance) > 0 ? <>We owe <b className="easy-owes">${vendor.data.balance}</b></> : "✅ Nothing owed"}
          </p>
        )}
        {problem && <p className="easy-error">{problem}</p>}
        {!adding ? (
          <button className="easy-btn wide" style={{ background: "#4f8cff" }} onClick={() => setAdding(true)}>➕ New bill from them</button>
        ) : (
          <div className="easy-form inline">
            <label>Amount<input value={amount} inputMode="decimal" placeholder="$" onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
            <label>Invoice number<input value={invoice} onChange={(e) => setInvoice(e.target.value)} /></label>
            <label>Date on the bill<input type="date" value={day} onChange={(e) => setDay(e.target.value || dayOf("today"))} /></label>
            <div className="easy-row">
              <button className="easy-btn go" disabled={addBill.isPending}
                onClick={() => {
                  const amt = parseAmount(amount);
                  if (!amt) setProblem("Type the amount, like 120 or 45.50.");
                  else addBill.mutate(amt);
                }}>
                ✓ Save bill
              </button>
              <button className="easy-btn" style={{ background: "#8a8f98" }} onClick={() => { setAdding(false); setProblem(null); }}>✖ Cancel</button>
            </div>
          </div>
        )}
        <h2 className="easy-day">Not paid yet <span>{bills.length}</span></h2>
        {vendor.data && bills.length === 0 && <p className="easy-wait">No unpaid bills. 🎉</p>}
        <div className="easy-orders">
          {bills.map((b) => (
            <div key={b.id} className="easy-order" style={{ borderColor: "#ff7a59" }}>
              <div className="easy-order-head" style={{ background: "#ff7a59" }}>
                <span>{b.invoice_number ? `Invoice ${b.invoice_number}` : "Bill"}</span>
                <span>${b.amount}</span>
              </div>
              <div className="easy-order-foot" style={{ paddingTop: 10 }}>
                <span>🗓 {dayLabel(b.entry_date)}</span>
              </div>
              <div className="easy-row">
                <TwoTap label={`💵 Paid $${b.amount}`} confirm="Tap again: paid today?" color="#2bb673"
                  disabled={pay.isPending} onConfirm={() => pay.mutate(b.id)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddExpense({ onBack }: { onBack: () => void }) {
  const client = useQueryClient();
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(dayOf("today"));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (amt: string) => api.createExpense({ description: what.trim(), amount: amt, spent_on: day }),
    onSuccess: (_, amt) => {
      setSaved(`${what.trim()} — $${amt}`);
      setWhat(""); setAmount(""); setProblem(null);
      client.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => setProblem(errorText(e)),
  });
  return (
    <div className="easy-screen">
      <TopBar title="Add an expense" onBack={onBack} sub />
      <div className="easy-form">
        {saved && <p className="easy-saved">✅ Saved: {saved}</p>}
        <label>What was it for?<input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Eggs from the market" autoFocus /></label>
        <label>How much?<input value={amount} inputMode="decimal" placeholder="$" onChange={(e) => setAmount(e.target.value)} /></label>
        <label>When?<input type="date" value={day} onChange={(e) => setDay(e.target.value || dayOf("today"))} /></label>
        {problem && <p className="easy-error">{problem}</p>}
        <button className="easy-btn go" disabled={save.isPending}
          onClick={() => {
            const amt = parseAmount(amount);
            if (!what.trim()) setProblem("Say what it was for.");
            else if (!amt) setProblem("Type the amount, like 25 or 12.50.");
            else save.mutate(amt);
          }}>
          {save.isPending ? "Saving…" : "✓ Save expense"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ask Claude
// ---------------------------------------------------------------------------
interface Said { who: "me" | "ai" | "done"; text: string }

const STARTERS = [
  "🥐 What do we need to bake today?",
  "💰 Who still has to pay?",
  "🚚 What deliveries are today?",
  "🛒 Help me take an order",
];

type Recognizer = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function speechRecognizer(): Recognizer | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function Ask({ onBack }: { onBack: () => void }) {
  const client = useQueryClient();
  const [said, setSaid] = useState<Said[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [streamed, setStreamed] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<Recognizer | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const canListen = useMemo(() => speechRecognizer() !== null, []);

  // Braces matter: newer Chrome returns a promise from scrollIntoView, and an
  // effect that returns anything but a cleanup function crashes React.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [said, streamed, proposals]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setProposals([]);
    setSaid((s) => [...s, { who: "me", text: message }]);
    setBusy(true);
    setStreamed("");
    setStatus("Thinking…");
    try {
      let full = "";
      const out = await streamChat(message, conversationId, (event) => {
        if (event.type === "status") setStatus(event.text);
        else if (event.type === "delta") {
          full += event.text;
          setStatus(null);
          setStreamed(stablePrefix(full));
        }
      });
      setConversationId(out.conversation_id);
      setSaid((s) => [...s, { who: "ai", text: out.reply }]);
      setProposals(out.proposals);
    } catch (e) {
      setSaid((s) => [...s, { who: "ai", text: `Sorry — ${errorText(e)}` }]);
    } finally {
      setBusy(false);
      setStreamed("");
      setStatus(null);
    }
  };

  const confirm = async (p: AssistantProposal) => {
    setBusy(true);
    try {
      const out = await api.assistantAct(p.action, p.args);
      setSaid((s) => [...s, { who: "done", text: `✅ ${out.result}` }]);
      setProposals((ps) => ps.filter((x) => x !== p));
      client.invalidateQueries();
    } catch (e) {
      setSaid((s) => [...s, { who: "done", text: `❌ ${errorText(e)}` }]);
    } finally {
      setBusy(false);
    }
  };

  const listen = () => {
    if (listening) { recognizer.current?.stop(); return; }
    const r = speechRecognizer();
    if (!r) return;
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((res) => res[0].transcript).join("");
      setDraft(text);
    };
    r.onend = () => setListening(false);
    recognizer.current = r;
    setListening(true);
    r.start();
  };

  return (
    <div className="easy-screen easy-ask">
      <TopBar title="Ask Claude" onBack={onBack} />
      <div className="easy-chat">
        {said.length === 0 && (
          <div className="easy-starters">
            <p>Ask me anything about the shop, or tell me what to do. I always check with you before changing anything.</p>
            {STARTERS.map((s) => (
              <button key={s} className="easy-starter" onClick={() => void send(s.replace(/^\S+\s/, ""))}>{s}</button>
            ))}
          </div>
        )}
        {said.map((m, i) => (
          <div key={i} className={`easy-msg ${m.who}`}>{m.who === "ai" ? <Markdown text={m.text} /> : m.text}</div>
        ))}
        {busy && (streamed
          ? <div className="easy-msg ai"><Markdown text={streamed} /></div>
          : <div className="easy-msg ai wait">{status ?? "…"}</div>)}
        {proposals.map((p, i) => (
          <div key={i} className="easy-proposal">
            <p>{p.summary}</p>
            <div className="easy-row">
              <button className="easy-btn go" disabled={busy} onClick={() => void confirm(p)}>✅ Yes, do it</button>
              <button className="easy-btn" style={{ background: "#8a8f98" }} disabled={busy}
                onClick={() => setProposals((ps) => ps.filter((x) => x !== p))}>✖ No</button>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form className="easy-say" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        {canListen && (
          <button type="button" className={`easy-mic${listening ? " on" : ""}`} onClick={listen}
            aria-label={listening ? "Stop listening" : "Speak"}>
            {listening ? "⏺" : "🎤"}
          </button>
        )}
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? "Listening…" : "Type or tap 🎤 and talk"} />
        <button type="submit" className="easy-btn go" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}

/** The assistant's markdown. No raw HTML, as on the dashboard: it's model output. */
function Markdown({ text }: { text: string }) {
  return (
    <div className="easy-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
