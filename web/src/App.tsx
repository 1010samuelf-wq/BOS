import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

import { clockIn, clockOut, myHours, unreadCount } from "./api/endpoints";
import { useAuth } from "./auth/AuthContext";
import { useRealtime } from "./realtime/RealtimeProvider";
import Login from "./pages/Login";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import OrderDetail from "./pages/OrderDetail";
import Reports from "./pages/Reports";
import Production from "./pages/Production";
import Deliveries from "./pages/Deliveries";
import Stock from "./pages/Stock";
import EmployeesHours from "./pages/EmployeesHours";
import Tasks from "./pages/Tasks";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";

// Each nav item maps to a section; the sidebar and route guards show/allow only
// the sections in the logged-in employee's effective set (per-employee override
// of role defaults — configured on the Employees screen, enforced server-side).
const NAV = [
  { to: "/orders", label: "Orders", icon: "🧾", section: "orders" },
  { to: "/production", label: "Production", icon: "🥐", section: "production" },
  { to: "/deliveries", label: "Deliveries", icon: "🚚", section: "deliveries" },
  { to: "/stock", label: "Stock", icon: "📦", section: "stock" },
  { to: "/reports", label: "Reports", icon: "📊", section: "reports" },
  { to: "/employees", label: "Employees & hours", icon: "👥", section: "employees" },
  { to: "/tasks", label: "Tasks", icon: "✅", section: "tasks" },
  { to: "/notifications", label: "Notifications", icon: "🔔", section: "notifications" },
  { to: "/settings", label: "Admin / Settings", icon: "⚙️", section: "settings" },
];

function firstAllowed(sections: string[]): string {
  const item = NAV.find((n) => sections.includes(n.section));
  return item ? item.to : "/no-access";
}

function Toasts() {
  const { toasts, dismiss } = useRealtime();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>{t.message}</div>
      ))}
    </div>
  );
}

function ClockControl() {
  const client = useQueryClient();
  const hours = useQuery({ queryKey: ["hours", "me"], queryFn: myHours });
  const open = !!hours.data?.open_entry;
  const punch = useMutation({
    mutationFn: () => (open ? clockOut() : clockIn()),
    onSuccess: () => client.invalidateQueries({ queryKey: ["hours"] }),
  });
  return (
    <button className={`btn ${open ? "danger" : "success"} sm clock-btn`} disabled={punch.isPending} onClick={() => punch.mutate()}>
      {open ? "● Clock out" : "Clock in"}
    </button>
  );
}

/** Redirect to the first allowed section if the employee lacks this one. */
function RequireSection({ section, children }: { section: string; children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.sections.includes(section)) return <Navigate to={firstAllowed(user?.sections ?? [])} replace />;
  return <>{children}</>;
}

function Shell() {
  const { user, logout } = useAuth();
  const { online } = useRealtime();
  const navigate = useNavigate();
  const sections = user?.sections ?? [];
  const unread = useQuery({ queryKey: ["notifications", "unread-count"], queryFn: unreadCount, refetchInterval: 60_000, enabled: sections.includes("notifications") });

  return (
    <div className="app">
      <nav className="sidebar">
        <img src="/logo.png" alt="Just Cake" className="brand-logo" />
        {NAV.filter((n) => sections.includes(n.section)).map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            <span>{n.icon}</span>
            <span>{n.label}</span>
            {n.section === "notifications" && (unread.data?.unread ?? 0) > 0 && (
              <span className="nav-badge">{unread.data!.unread}</span>
            )}
          </NavLink>
        ))}
        <div className="user-chip">
          <div className="name">{user?.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>{user?.role}</div>
          {sections.includes("time") && <ClockControl />}
          <button onClick={() => { logout(); navigate("/login"); }} style={{ marginTop: 6 }}>log out</button>
        </div>
      </nav>
      <div className="main">
        {!online && <div className="offline-banner">Offline — reconnecting to the server…</div>}
        <Outlet />
      </div>
      <Toasts />
    </div>
  );
}

function NoAccess() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="login">
      <div className="box">
        <p>Your account has no sections enabled. Ask an admin to grant access.</p>
        <button className="btn neutral" onClick={() => { logout(); navigate("/login"); }}>Log out</button>
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  const home = user ? firstAllowed(user.sections) : "/login";
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={home} replace /> : <Login />} />
      <Route path="/no-access" element={user ? <NoAccess /> : <Navigate to="/login" replace />} />
      <Route element={user ? <Shell /> : <Navigate to="/login" replace />}>
        <Route path="/orders" element={<RequireSection section="orders"><Orders /></RequireSection>} />
        <Route path="/orders/new" element={<RequireSection section="orders"><NewOrder /></RequireSection>} />
        <Route path="/orders/:id" element={<RequireSection section="orders"><OrderDetail /></RequireSection>} />
        <Route path="/production" element={<RequireSection section="production"><Production /></RequireSection>} />
        <Route path="/deliveries" element={<RequireSection section="deliveries"><Deliveries /></RequireSection>} />
        <Route path="/stock" element={<RequireSection section="stock"><Stock /></RequireSection>} />
        <Route path="/reports" element={<RequireSection section="reports"><Reports /></RequireSection>} />
        <Route path="/employees" element={<RequireSection section="employees"><EmployeesHours /></RequireSection>} />
        <Route path="/tasks" element={<RequireSection section="tasks"><Tasks /></RequireSection>} />
        <Route path="/notifications" element={<RequireSection section="notifications"><Notifications /></RequireSection>} />
        <Route path="/settings" element={<RequireSection section="settings"><Settings /></RequireSection>} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
