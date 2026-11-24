// "Needs attention": the problem checker's list (GET /problems) at the top of
// the dashboard's Orders page, for managers and admins only. Deliberately not
// in the easy tablet app — the owner's call, it would confuse the people that
// app is for. The assistant reads the same list through its find_problems tool.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listProblems } from "../api/endpoints";
import type { Problem } from "../api/types";
import { useAuth } from "../auth/AuthContext";

/** Where each problem's "Open" goes. A screen the client doesn't know gets no link. */
const SCREEN: Record<string, string> = {
  orders: "/orders",
  today: "/orders",
  inquiries: "/inquiries",
  stock: "/production",
  time: "/settings?tab=employees",
  tasks: "/tasks",
  vendors: "/bookkeeping",
  products: "/settings?tab=products",
};

const COLOR: Record<string, string> = { high: "#b3261e", medium: "#b26a00", low: "#5f6b7a" };

export default function NeedsAttention() {
  const { user } = useAuth();
  const allowed = user?.role === "manager" || user?.role === "admin";
  const q = useQuery({ queryKey: ["problems"], queryFn: listProblems, enabled: allowed, refetchInterval: 120_000 });
  const [open, setOpen] = useState(true);

  // Quiet when there's nothing to say or it can't be read: this is a helper
  // on top of the Orders page, not the page's own content.
  if (!allowed || !q.data || q.data.length === 0) return null;

  const worst = q.data[0].severity;
  return (
    <div className="card" style={{ borderLeft: `5px solid ${COLOR[worst]}` }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Needs attention ({q.data.length})</h2>
        <button className="btn neutral sm" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {q.data.map((p: Problem) => (
            <li key={p.kind} style={{ padding: "8px 0", borderTop: "1px solid var(--border, #eee)" }}>
              <div style={{ fontWeight: 600, color: COLOR[p.severity] }}>{p.title}</div>
              <div className="muted" style={{ fontSize: 13 }}>{p.detail}</div>
              <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                {p.order_ids.map((id) => (
                  <Link key={id} className="btn neutral sm" to={`/orders/${id}`}>Order #{id}</Link>
                ))}
                {p.order_ids.length === 0 && SCREEN[p.screen] && (
                  <Link className="btn neutral sm" to={SCREEN[p.screen]}>Open</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
