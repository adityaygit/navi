"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Stone } from "./stone";
import { usePanel } from "./panel-context";
import { isApplePlatform } from "@/lib/viewing";
import { searchTasksAction } from "@/app/(app)/client-actions";

type Item = { id: string; group: "Do" | "Tasks" | "Go to" | "Ask Navi"; label: string; hint?: string; run: () => void };

const PAGES: { label: string; href: string; words: string }[] = [
  { label: "Home", href: "/", words: "home today" },
  { label: "Tasks", href: "/tasks", words: "tasks todo list" },
  { label: "My day", href: "/planner", words: "my day planner timeline schedule" },
  { label: "My day · Calendar", href: "/planner?view=calendar", words: "calendar week" },
  { label: "Inbox", href: "/inbox", words: "inbox review proposals" },
  { label: "Focus", href: "/focus", words: "focus timer" },
  { label: "Projects and goals", href: "/projects", words: "projects goals" },
  { label: "Memory", href: "/memory", words: "memory remember" },
  { label: "Settings", href: "/settings", words: "settings preferences notifications password" },
];

/**
 * ⌘K on a Mac, Ctrl K on Windows: search and commands. Everything here also
 * exists in the normal UI; this is a shortcut, never the only way.
 */
export function CommandPalette() {
  const router = useRouter();
  const panel = usePanel();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState(0);
  const [apple, setApple] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApple(isApplePlatform(nav.userAgentData?.platform ?? nav.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("navi:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("navi:palette", onOpen);
    };
  }, []);

  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setTasks([]);
      setSel(0);
    }
  }
  useEffect(() => {
    if (open) {
      lastFocus.current = document.activeElement as HTMLElement | null;
      inputRef.current?.focus();
    } else lastFocus.current?.focus?.();
  }, [open]);

  // Task search, debounced; stale answers are ignored.
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    let live = true;
    const t = setTimeout(async () => {
      if (!query) return live && setTasks([]);
      const r = await searchTasksAction(query);
      if (live && r.ok) setTasks(r.data ?? []);
    }, 140);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);

  const close = () => setOpen(false);
  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase();
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    const doItems = ([
      { id: "plan", group: "Do", label: "Plan my day", run: () => { close(); panel.ask("Plan my day"); } },
      { id: "capture", group: "Do", label: "Capture something", hint: "to your inbox", run: () => { close(); window.dispatchEvent(new Event("navi:open-capture")); } },
      { id: "focus", group: "Do", label: "Start focus", run: go("/focus") },
      { id: "calendar", group: "Do", label: "Open this week's calendar", run: go("/planner?view=calendar") },
    ] as Item[]).filter((i) => !query || i.label.toLowerCase().includes(query));
    const taskItems: Item[] = tasks.map((t) => ({ id: `t:${t.id}`, group: "Tasks", label: t.title, run: go(`/tasks?open=${t.id}`) }));
    const pageItems: Item[] = PAGES.filter((p) => !query || p.label.toLowerCase().includes(query) || p.words.includes(query)).map((p) => ({ id: `p:${p.href}`, group: "Go to", label: p.label, run: go(p.href) }));
    const askItems: Item[] = query ? [{ id: "ask", group: "Ask Navi", label: `Ask Navi: “${q.trim()}”`, run: () => { close(); panel.ask(q.trim()); } }] : [];
    return [...doItems, ...taskItems, ...pageItems, ...askItems];
  }, [q, tasks, router, panel]);
  const current = Math.min(sel, Math.max(0, items.length - 1));

  if (!open) return null;
  const mod = apple ? "⌘" : "Ctrl";
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="w-full max-w-[520px] overflow-hidden rounded-[22px] border border-white/10 bg-[#111113] shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") return close();
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((current + 1) % Math.max(1, items.length)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((current - 1 + items.length) % Math.max(1, items.length)); }
          if (e.key === "Enter") {
            e.preventDefault();
            if ((e.ctrlKey || e.metaKey) && q.trim()) { close(); panel.ask(q.trim()); return; }
            items[current]?.run();
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7C7C85" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder="Search tasks, pages, or ask Navi"
            className="h-14 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-dim focus-visible:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[current] ? `pal-${items[current].id}` : undefined}
            aria-label="Search and commands"
          />
          <span className="kbd">esc</span>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {header && <div className="px-3 pb-1.5 pt-2.5 text-[12.5px] text-dim" role="presentation">{header}</div>}
                <div
                  id={`pal-${it.id}`}
                  role="option"
                  aria-selected={i === current}
                  onMouseEnter={() => setSel(i)}
                  onClick={it.run}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] ${i === current ? "bg-white/[0.08]" : ""}`}
                >
                  {it.group === "Ask Navi" ? <Stone size={16} /> : <span className="h-4 w-4 rounded-full border border-white/25" aria-hidden="true" />}
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-[13px] text-dim">{it.hint}</span>}
                  {it.group === "Ask Navi" && <span className="kbd">{mod} ↵</span>}
                </div>
              </li>
            );
          })}
          {items.length === 0 && <li className="px-3 py-6 text-center text-[14px] text-dim">Nothing matches.</li>}
        </ul>
        <div className="flex gap-4 border-t border-white/[0.07] px-4 py-2.5 text-[12px] text-dim">
          <span>↑↓ move</span>
          <span>↵ run</span>
          <span>{mod} ↵ ask Navi</span>
        </div>
      </div>
    </div>
  );
}
