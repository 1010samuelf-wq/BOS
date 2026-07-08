// Tasks (§2J/§11): Admin/Manager create + all-staff table with overdue red;
// checkbox toggles done. Assignee picker uses the public roster.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiRequestError } from "../api/client";
import { createTask, fetchRoster, listTasks, toggleTaskDone } from "../api/endpoints";
import { Loading, PageHead } from "../components/ui";

export default function Tasks() {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState<number | "">("");
  const [due, setDue] = useState("");

  // filters (§2J): assignee, status, and due-date
  const [fEmployee, setFEmployee] = useState<number | "">("");
  const [fStatus, setFStatus] = useState<"" | "open" | "done">("");
  const [fDate, setFDate] = useState("");
  const filterParams = {
    employee_id: fEmployee === "" ? undefined : Number(fEmployee),
    done: fStatus === "" ? undefined : fStatus === "done",
    date: fDate || undefined,
  };
  const filtersActive = fEmployee !== "" || fStatus !== "" || fDate !== "";

  const tasks = useQuery({ queryKey: ["tasks", "all", filterParams], queryFn: () => listTasks(filterParams) });
  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster });
  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    (roster.data ?? []).forEach((r) => m.set(r.id, r.name));
    return (id: number) => m.get(id) ?? `#${id}`;
  }, [roster.data]);

  const toggle = useMutation({
    mutationFn: (id: number) => toggleTaskDone(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Update failed."),
  });
  const create = useMutation({
    mutationFn: () =>
      createTask({ description: desc.trim(), assigned_to: Number(assignee), due_date: due ? due.replace(" ", "T") : null }),
    onSuccess: () => { setDesc(""); setAssignee(""); setDue(""); client.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Create failed."),
  });

  return (
    <div className="page">
      <PageHead title="Tasks" />
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>New task</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 2, minWidth: 220 }} />
          <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value ? Number(e.target.value) : "")} style={{ maxWidth: 200 }}>
            <option value="">Assign to…</option>
            {(roster.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input className="input" placeholder="Due (YYYY-MM-DD HH:MM)" value={due} onChange={(e) => setDue(e.target.value)} style={{ maxWidth: 220 }} />
          <button className="btn primary" disabled={!desc.trim() || assignee === "" || create.isPending} onClick={() => create.mutate()}>
            Create
          </button>
        </div>
      </div>

      <div className="card">
        <h2>All tasks</h2>
        <div className="row" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          <select className="input" value={fEmployee} onChange={(e) => setFEmployee(e.target.value ? Number(e.target.value) : "")} style={{ maxWidth: 200 }}>
            <option value="">Everyone</option>
            {(roster.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value as "" | "open" | "done")} style={{ maxWidth: 150 }}>
            <option value="">Any status</option>
            <option value="open">Not done</option>
            <option value="done">Done</option>
          </select>
          <input className="input" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} style={{ maxWidth: 160 }} title="Due date" />
          <button className="btn neutral" disabled={!filtersActive} onClick={() => { setFEmployee(""); setFStatus(""); setFDate(""); }}>Clear</button>
        </div>
        {tasks.isLoading ? (
          <Loading />
        ) : (
          <table>
            <thead><tr><th></th><th>Task</th><th>Assigned to</th><th>Due</th></tr></thead>
            <tbody>
              {(tasks.data ?? []).map((t) => (
                <tr key={t.id} className={t.is_overdue ? "overdue" : ""}>
                  <td>
                    <span className={`checkbox${t.done ? " on" : ""}`} onClick={() => toggle.mutate(t.id)} style={{ cursor: "pointer" }}>
                      {t.done ? "✓" : ""}
                    </span>
                  </td>
                  <td className={t.done ? "strike" : ""}>{t.description}</td>
                  <td>{nameOf(t.assigned_to)}</td>
                  <td>{t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}{t.is_overdue ? " · OVERDUE" : ""}</td>
                </tr>
              ))}
              {tasks.isSuccess && tasks.data.length === 0 && (
                <tr><td colSpan={4} className="muted">No matching tasks.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
