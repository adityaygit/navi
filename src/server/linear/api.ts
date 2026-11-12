import "server-only";
import { LINEAR_GRAPHQL_URL } from "./config";
import type { FetchLike } from "./oauth";

// Minimal Linear GraphQL client (https://linear.app/developers/graphql).
// Read-only queries only. Errors are classified so the caller can tell
// "reconnect needed" from "try again later".

/** The token was rejected (expired, revoked, app uninstalled). */
export class LinearAuthError extends Error {}
/** Linear asked us to slow down. Retry on a later sync. */
export class LinearRateLimitError extends Error {}
export class LinearApiError extends Error {}

type GqlError = { message?: string; extensions?: { code?: string; type?: string } };

export async function linearGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}, f: FetchLike = fetch): Promise<T> {
  let res: Response;
  try {
    res = await f(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new LinearApiError(`Couldn't reach Linear (${(err as Error).name === "TimeoutError" ? "timed out" : "network error"})`);
  }
  let body: { data?: T; errors?: GqlError[] } = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page: classified by status below.
  }
  const codes = (body.errors ?? []).map((e) => String(e.extensions?.code ?? e.extensions?.type ?? "").toUpperCase());
  if (res.status === 401 || codes.some((c) => c.includes("AUTHENTICATION"))) throw new LinearAuthError("Linear rejected the access token");
  if (res.status === 429 || codes.includes("RATELIMITED")) throw new LinearRateLimitError("Linear rate limit reached");
  if (codes.some((c) => c === "FORBIDDEN")) throw new LinearAuthError("Navi no longer has access to this Linear workspace");
  if (!res.ok || body.errors?.length || !body.data) {
    const msg = body.errors?.[0]?.message?.slice(0, 200);
    throw new LinearApiError(`Linear API error ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return body.data;
}

// --- Queries -------------------------------------------------------------------

export const VIEWER_QUERY = /* GraphQL */ `
  query NaviViewer {
    viewer { id name displayName email organization { id name urlKey } }
  }
`;

export type LinearViewer = {
  viewer: { id: string; name: string; displayName: string; email: string; organization: { id: string; name: string; urlKey: string } };
};

const ISSUE_FIELDS = /* GraphQL */ `
  id identifier title url priority priorityLabel dueDate estimate
  updatedAt archivedAt completedAt canceledAt trashed
  description
  assignee { id }
  state { id name type }
  team { id key name }
  cycle { id number name endsAt }
  project { id name url targetDate status { type name } }
`;

/** The person's open assigned issues (not completed or canceled), newest change first. */
export const ASSIGNED_ISSUES_QUERY = /* GraphQL */ `
  query NaviAssignedIssues($after: String) {
    viewer {
      assignedIssues(
        first: 100
        after: $after
        orderBy: updatedAt
        filter: { state: { type: { nin: ["completed", "canceled"] } } }
      ) {
        nodes { ${ISSUE_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/** Specific issues by id (incl. archived), to reconcile ones that left the open/assigned set. */
export const ISSUES_BY_ID_QUERY = /* GraphQL */ `
  query NaviIssuesById($ids: [ID!]!) {
    issues(first: 100, includeArchived: true, filter: { id: { in: $ids } }) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`;

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  priorityLabel: string;
  dueDate: string | null;
  estimate: number | null;
  updatedAt: string;
  archivedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  trashed: boolean | null;
  description: string | null;
  assignee: { id: string } | null;
  state: { id: string; name: string; type: string };
  team: { id: string; key: string; name: string };
  cycle: { id: string; number: number; name: string | null; endsAt: string } | null;
  project: { id: string; name: string; url: string; targetDate: string | null; status: { type: string; name: string } | null } | null;
};

export type AssignedIssuesPage = {
  viewer: { assignedIssues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
};
export type IssuesByIdPage = { issues: { nodes: LinearIssue[] } };
