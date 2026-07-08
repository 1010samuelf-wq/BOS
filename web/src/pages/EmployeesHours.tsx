// Employees & hours (§2E/§2G/§11). Admin adds accounts, resets PIN, deactivates,
// and sets **per-employee section access** (checkboxes below) that overrides the
// role's defaults — e.g. limit someone to Orders only. Everyone with the reports
// section sees the all-staff weekly hours.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiRequestError } from "../api/client";
import {
  createEmployee,
  deactivateEmployee,
  getStaffHours,
  grantableSections,
  listEmployees,
  resetPin,
  updateEmployee,
} from "../api/endpoints";
import type { Employee, Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Loading, PageHead } from "../components/ui";

const ROLES: Role[] = ["cashier", "manager", "admin"];

function SectionsEditor({
  emp,
  sections,
  onSet,
  onReset,
}: {
  emp: Employee;
  sections: string[];
  onSet: (perms: string[]) => void;
  onReset: () => void;
}) {
  if (emp.role === "admin") {
    return <span className="pill paid">Full access (admin)</span>;
  }
  const active = new Set(emp.effective_sections);
  const toggle = (s: string) => {
    const next = new Set(active);
    next.has(s) ? next.delete(s) : next.add(s);
    onSet([...next]);
  };
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {sections.map((s) => (
          <label key={s} className="row" style={{ gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={active.has(s)} onChange={() => toggle(s)} />
            {s}
          </label>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {emp.permissions === null ? "using role default" : "custom"}
        {emp.permissions !== null && (
          <button className="btn neutral sm" style={{ marginLeft: 8 }} onClick={onReset}>Reset to role default</button>
        )}
      </div>
    </div>
  );
}

export default function EmployeesHours() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("cashier");

  const hours = useQuery({ queryKey: ["staff-hours"], queryFn: () => getStaffHours() });
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees(true), enabled: isAdmin });
  const sections = useQuery({ queryKey: ["grantable-sections"], queryFn: grantableSections, enabled: isAdmin });
  const invalidate = () => client.invalidateQueries({ queryKey: ["employees"] });
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");

  const create = useMutation({
    mutationFn: () => createEmployee({ name: name.trim(), role }),
    onSuccess: () => { setName(""); setRole("cashier"); invalidate(); },
    onError: onErr,
  });
  const reset = useMutation({ mutationFn: resetPin, onSuccess: invalidate, onError: onErr });
  const deactivate = useMutation({ mutationFn: deactivateEmployee, onSuccess: invalidate, onError: onErr });
  const setPerms = useMutation({
    mutationFn: (v: { id: number; permissions: string[] | null }) => updateEmployee(v.id, { permissions: v.permissions }),
    onSuccess: invalidate,
    onError: onErr,
  });

  return (
    <div className="page">
      <PageHead title="Employees & hours" />
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>Hours this week (all staff)</h2>
        {hours.isLoading ? (
          <Loading />
        ) : hours.isError ? (
          <p className="error">Hours require the reports section.</p>
        ) : (
          <table>
            <thead><tr><th>Employee</th><th className="num">Total hours</th></tr></thead>
            <tbody>
              {(hours.data?.rows ?? []).map((r) => (
                <tr key={r.user_id}><td>{r.name}</td><td className="num">{r.total_hours.toFixed(1)}</td></tr>
              ))}
              {hours.data && (
                <tr><td><strong>Total</strong></td><td className="num"><strong>{hours.data.grand_total_hours.toFixed(1)}</strong></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {isAdmin && (
        <>
          <div className="card">
            <h2>Add employee</h2>
            <div className="row">
              <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 260 }} />
              <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ maxWidth: 160 }}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Add employee</button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>They set their own PIN on first login (web or tablet).</p>
          </div>

          <div className="card">
            <h2>Staff & access</h2>
            {employees.isLoading || sections.isLoading ? <Loading /> : (
              (employees.data ?? []).map((e) => (
                <div key={e.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0", opacity: e.active ? 1 : 0.5 }}>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <strong>{e.name}</strong>{!e.active ? " · inactive" : ""}
                      <span className="muted"> · {e.role} · PIN {e.pin_set ? "set" : "awaiting first login"}</span>
                    </div>
                    {e.active && (
                      <>
                        <button className="btn neutral sm" onClick={() => reset.mutate(e.id)}>Reset PIN</button>
                        <button className="btn danger sm" onClick={() => deactivate.mutate(e.id)}>Deactivate</button>
                      </>
                    )}
                  </div>
                  {e.active && (
                    <div style={{ marginTop: 8 }}>
                      <SectionsEditor
                        emp={e}
                        sections={sections.data ?? []}
                        onSet={(permissions) => setPerms.mutate({ id: e.id, permissions })}
                        onReset={() => setPerms.mutate({ id: e.id, permissions: null })}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
