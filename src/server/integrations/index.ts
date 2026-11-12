import "server-only";

// Extension point for external services that Navi would ACT on (Google
// Calendar, Gmail, GitHub, Drive). Read-only calendar feeds (Canvas) live in
// ./feed-sync.ts, ./connections.ts and ./providers/: they import data and never
// act outside Navi, so they aren't listed here. None of these are connected yet: each entry reports
// isConnected() = false, so any external action Navi proposes is shown for
// approval but fails honestly instead of claiming success. To add one,
// implement OAuth with scoped permissions, store tokens server-side, and
// implement execute() to return the provider's confirmation.

export type Integration = {
  id: string;
  name: string;
  description: string;
  isConnected: () => boolean;
  execute: (actionType: string, details: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const notConnected = async (): Promise<never> => {
  throw new Error("Not connected");
};

export const integrations: Integration[] = [
  { id: "google_calendar", name: "Google Calendar", description: "Read events; propose changes with approval", isConnected: () => false, execute: notConnected },
  { id: "gmail", name: "Gmail", description: "Draft replies; send only with approval", isConnected: () => false, execute: notConnected },
  { id: "github", name: "GitHub", description: "Link issues and PRs to projects", isConnected: () => false, execute: notConnected },
  { id: "google_drive", name: "Google Drive", description: "Attach documents to projects", isConnected: () => false, execute: notConnected },
];
