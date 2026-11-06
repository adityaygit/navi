/** A thin progress bar for a goal or project, with the plain count beside it. */
export function ProjectsProgress({ done, total, label }: { done: number; total: number; label: string }) {
  if (total === 0) return <span className="text-[13px] text-dim">No tasks linked yet</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`${label}: ${done} of ${total} tasks done`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-focus" style={{ width: `${pct}%` }} />
      </div>
      <span className="num shrink-0 text-[13px] text-muted">
        {done}/{total} tasks
      </span>
    </div>
  );
}
