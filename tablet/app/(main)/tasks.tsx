// Tasks (§2J/§11): everyone sees their own tasks with a done checkbox (greyed
// when done); Admin/Manager also get a create form + an all-staff table with
// overdue rows flagged red. Assignee picker uses the public roster so managers
// (who can't call the Admin-only /employees) can still assign.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ApiRequestError } from "../../src/api/client";
import { createTask, fetchRoster, listTasks, toggleTaskDone } from "../../src/api/endpoints";
import type { RosterEntry, Task } from "../../src/api/types";
import { useAuth } from "../../src/auth/AuthContext";
import { RequiresConnection } from "../../src/components/Chrome";
import { Button, Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

function TaskRow({ task, name, onToggle }: { task: Task; name?: string; onToggle: () => void }) {
  return (
    <Pressable style={[styles.task, task.is_overdue && styles.taskOverdue]} onPress={onToggle}>
      <View style={[styles.checkbox, task.done && styles.checkboxOn]}>
        {task.done && <Text style={styles.check}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.taskText, task.done && styles.taskDone]}>{task.description}</Text>
        <Text style={styles.taskMeta}>
          {name ? `${name} · ` : ""}
          {task.due_date ? `due ${new Date(task.due_date).toLocaleDateString()}` : "no due date"}
          {task.is_overdue ? " · OVERDUE" : ""}
        </Text>
      </View>
    </Pressable>
  );
}

export default function TasksScreen() {
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mine = useQuery({ queryKey: ["tasks", "mine"], queryFn: () => listTasks({ employee_id: user?.id }) });

  // "All tasks" filters (§2J): assignee, status, due-date.
  const [fEmployee, setFEmployee] = useState<number | null>(null);
  const [fStatus, setFStatus] = useState<"" | "open" | "done">("");
  const [fDate, setFDate] = useState("");
  const filtersActive = fEmployee !== null || fStatus !== "" || fDate !== "";
  const allFilters = {
    employee_id: fEmployee ?? undefined,
    done: fStatus === "" ? undefined : fStatus === "done",
    date: fDate.trim() || undefined,
  };
  const all = useQuery({
    queryKey: ["tasks", "all", allFilters],
    queryFn: () => listTasks(allFilters),
    enabled: isManager,
  });
  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster, enabled: isManager });
  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    (roster.data ?? []).forEach((r: RosterEntry) => m.set(r.id, r.name));
    return (id: number) => m.get(id) ?? `#${id}`;
  }, [roster.data]);

  const toggle = useMutation({
    mutationFn: (id: number) => toggleTaskDone(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Update failed."),
  });

  // create form
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState<number | null>(null);
  const [due, setDue] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createTask({
        description: desc.trim(),
        assigned_to: assignee!,
        due_date: due.trim() ? due.replace(" ", "T") : null,
      }),
    onSuccess: () => {
      setDesc("");
      setAssignee(null);
      setDue("");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Create failed."),
  });

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <ScreenHeader title="Tasks" />
        {error && <ErrorText>{error}</ErrorText>}

        <Card>
          <Text style={styles.section}>My tasks</Text>
          {mine.isLoading ? (
            <Loading />
          ) : (mine.data ?? []).length === 0 ? (
            <Text style={styles.muted}>Nothing assigned to you.</Text>
          ) : (
            (mine.data ?? []).map((t: Task) => (
              <TaskRow key={t.id} task={t} onToggle={() => toggle.mutate(t.id)} />
            ))
          )}
        </Card>

        {isManager && (
          <>
            <Card>
              <Text style={styles.section}>New task</Text>
              <TextInput
                style={styles.input}
                placeholder="Description"
                value={desc}
                onChangeText={setDesc}
              />
              <Text style={styles.label}>Assign to</Text>
              <View style={styles.assignees}>
                {(roster.data ?? []).map((r: RosterEntry) => (
                  <Pressable
                    key={r.id}
                    style={[styles.pill, assignee === r.id && styles.pillOn]}
                    onPress={() => setAssignee(r.id)}
                  >
                    <Text style={assignee === r.id ? styles.pillTextOn : styles.pillText}>{r.name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Due (YYYY-MM-DD HH:MM, optional)"
                value={due}
                onChangeText={setDue}
              />
              <Button
                label="Create task"
                busy={create.isPending}
                disabled={!desc.trim() || assignee === null}
                onPress={() => create.mutate()}
              />
            </Card>

            <Card>
              <Text style={styles.section}>All tasks</Text>
              <View style={styles.assignees}>
                <Pressable
                  style={[styles.pill, fEmployee === null && styles.pillOn]}
                  onPress={() => setFEmployee(null)}
                >
                  <Text style={fEmployee === null ? styles.pillTextOn : styles.pillText}>Everyone</Text>
                </Pressable>
                {(roster.data ?? []).map((r: RosterEntry) => (
                  <Pressable
                    key={r.id}
                    style={[styles.pill, fEmployee === r.id && styles.pillOn]}
                    onPress={() => setFEmployee(r.id)}
                  >
                    <Text style={fEmployee === r.id ? styles.pillTextOn : styles.pillText}>{r.name}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.assignees}>
                {([
                  { key: "", label: "Any status" },
                  { key: "open", label: "Not done" },
                  { key: "done", label: "Done" },
                ] as const).map((o) => (
                  <Pressable
                    key={o.key}
                    style={[styles.pill, fStatus === o.key && styles.pillOn]}
                    onPress={() => setFStatus(o.key)}
                  >
                    <Text style={fStatus === o.key ? styles.pillTextOn : styles.pillText}>{o.label}</Text>
                  </Pressable>
                ))}
                <TextInput
                  style={[styles.input, { width: 130 }]}
                  placeholder="Due date (YYYY-MM-DD)"
                  value={fDate}
                  onChangeText={setFDate}
                />
                {filtersActive && (
                  <Pressable
                    style={styles.pill}
                    onPress={() => { setFEmployee(null); setFStatus(""); setFDate(""); }}
                  >
                    <Text style={styles.pillText}>Clear</Text>
                  </Pressable>
                )}
              </View>
              {all.isLoading ? (
                <Loading />
              ) : (all.data ?? []).length === 0 ? (
                <Text style={styles.muted}>No matching tasks.</Text>
              ) : (
                (all.data ?? []).map((t: Task) => (
                  <TaskRow key={t.id} task={t} name={nameOf(t.assigned_to)} onToggle={() => toggle.mutate(t.id)} />
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  muted: { color: colors.textMuted },
  task: { flexDirection: "row", alignItems: "center", gap: spacing.m, paddingVertical: spacing.s },
  taskOverdue: { backgroundColor: "#fdf1ef", borderRadius: radius.m, paddingHorizontal: spacing.s },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.s,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.success, borderColor: colors.success },
  check: { color: "#fff", fontWeight: "800" },
  taskText: { color: colors.text, fontSize: 15 },
  taskDone: { textDecorationLine: "line-through", color: colors.textMuted },
  taskMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  label: { color: colors.textMuted, fontSize: 12 },
  assignees: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.text },
  pillTextOn: { color: "#fff", fontWeight: "700" },
});
