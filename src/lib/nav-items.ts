export type NavItem = { href: string; label: string; mobile?: boolean; badge?: "inbox" | "approvals" };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", mobile: true },
  { href: "/chat", label: "Navi", mobile: true },
  { href: "/inbox", label: "Inbox", mobile: true, badge: "inbox" },
  { href: "/planner", label: "Planner", mobile: true },
  { href: "/tasks", label: "Tasks" },
  { href: "/projects", label: "Projects & Goals" },
  { href: "/insights", label: "Insights" },
  { href: "/memory", label: "Memory" },
  { href: "/notes", label: "Notes" },
  { href: "/activity", label: "Activity", badge: "approvals" },
  { href: "/settings", label: "Settings" },
];

export const MORE_LINKS = NAV_ITEMS.filter((i) => !i.mobile);
