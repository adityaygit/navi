import { DateTime } from "luxon";
import type { TaskStatus } from "@/lib/types";
import type { LinearIssue } from "./api";

// How a Linear issue becomes a Navi task. Linear is the source of truth for
// the issue's own fields (LINEAR_OWNED); Navi owns everything about planning
// (estimate, commitment, not-before, hard-deadline flag, notes, steps, space,
// plan blocks), which the sync never touches.

/** Task columns Linear owns. People change these in Linear, not Navi. */
export const LINEAR_OWNED = ["title", "priority", "due_at", "project_id"] as const;
/** Changing these in Navi would break the link (a repeat would copy the issue). */
export const LINEAR_BLOCKED = ["recurrence", "parent_task_id"] as const;

export const OPEN_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked"];

/** Linear workflow state type → Navi task status. */
export function mapStatus(stateType: string): TaskStatus {
  switch (stateType) {
    case "started":
      return "in_progress";
    case "completed":
      return "done";
    case "canceled":
    case "duplicate":
      return "cancelled";
    default: // triage, backlog, unstarted
      return "todo";
  }
}

/**
 * Linear priority (0 none, 1 urgent, 2 high, 3 medium, 4 low) → Navi (1 highest … 3 normal).
 * Navi's 4 means "Someday" (parked), which assigned Linear work isn't, so Low stays 3;
 * the original label is kept and shown.
 */
export function mapPriority(p: number): 1 | 2 | 3 {
  if (p === 1) return 1;
  if (p === 2) return 2;
  return 3;
}

/** A Linear due date (a calendar day) is due at the end of that day in the person's zone, like Navi's own dated tasks. */
export function dueAtFor(dueDate: string | null, zone: string): string | null {
  if (!dueDate) return null;
  const d = DateTime.fromISO(dueDate, { zone });
  if (!d.isValid) return null;
  return d.set({ hour: 23, minute: 59, second: 0, millisecond: 0 }).toUTC().toISO();
}

/** Linear project status type → Navi project status. */
export function mapProjectStatus(type: string | null | undefined): "active" | "paused" | "done" | "archived" {
  if (type === "completed") return "done";
  if (type === "canceled") return "archived";
  if (type === "paused") return "paused";
  return "active";
}

export type LinearOwnedValues = { title: string; priority: 1 | 2 | 3; due_at: string | null; project_id: string | null; status: TaskStatus };

export function linearValues(issue: LinearIssue, zone: string, projectId: string | null): LinearOwnedValues {
  return {
    title: issue.title.trim().slice(0, 500) || issue.identifier,
    priority: mapPriority(issue.priority),
    due_at: dueAtFor(issue.dueDate, zone),
    project_id: projectId,
    status: mapStatus(issue.state.type),
  };
}

/** Why an imported issue no longer belongs in the person's Linear work. */
export type DetachReason = "unassigned" | "archived" | "missing";

/** What Navi remembers about the issue (shown in the task, available to Navi as context). */
export type LinearSnapshot = {
  org_id: string;
  identifier: string;
  team_key: string;
  team_name: string;
  state_name: string;
  state_type: string;
  priority_label: string;
  linear_priority: number;
  estimate: number | null;
  due_date: string | null;
  project_name: string | null;
  cycle: { number: number; name: string | null; ends_at: string } | null;
  description: string | null;
  updated_at: string;
  /** The Linear-owned values as last applied. A field is re-applied only when Linear's value moves away from this. */
  synced: LinearOwnedValues;
  detached?: DetachReason | null;
};

export function snapshotOf(issue: LinearIssue, orgId: string, values: LinearOwnedValues): LinearSnapshot {
  return {
    org_id: orgId,
    identifier: issue.identifier,
    team_key: issue.team.key,
    team_name: issue.team.name,
    state_name: issue.state.name,
    state_type: issue.state.type,
    priority_label: issue.priorityLabel,
    linear_priority: issue.priority,
    estimate: issue.estimate ?? null,
    due_date: issue.dueDate,
    project_name: issue.project?.name ?? null,
    cycle: issue.cycle ? { number: issue.cycle.number, name: issue.cycle.name, ends_at: issue.cycle.endsAt } : null,
    description: issue.description ? issue.description.slice(0, 2000) : null,
    updated_at: issue.updatedAt,
    synced: values,
    detached: null,
  };
}

type TaskLike = { title: string; priority: number; due_at: string | null; project_id: string | null; status: TaskStatus };

const sameInstant = (a: string | null, b: string | null) => (a && b ? Date.parse(a) === Date.parse(b) : a === b);

/**
 * The changes to apply to an existing imported task. Linear-owned columns
 * always follow Linear (Navi doesn't let people edit them). Status follows
 * Linear only when Linear's status changed since the last sync, so marking a
 * task done (or dropping it) in Navi sticks until the issue moves in Linear.
 */
export function taskPatch(task: TaskLike, prev: LinearOwnedValues | null | undefined, next: LinearOwnedValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (task.title !== next.title) patch.title = next.title;
  if (task.priority !== next.priority) patch.priority = next.priority;
  if (!sameInstant(task.due_at, next.due_at)) patch.due_at = next.due_at;
  if (task.project_id !== next.project_id) patch.project_id = next.project_id;
  const linearMoved = !prev || prev.status !== next.status;
  if (linearMoved && task.status !== next.status) patch.status = next.status;
  return patch;
}
