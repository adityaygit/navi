import { blockCategory, type BlockCategory } from "@/lib/outcomes";

type Block = { id: string; title: string; status: string; outcome_reason: string | null; starts_at: string; ends_at: string };

const GROUPS: { key: string; label: string; cats: BlockCategory[]; cls: string }[] = [
  { key: "done", label: "Done", cats: ["done"], cls: "bg-[#f2f2f2]" },
  { key: "partial", label: "Partly done", cats: ["partial"], cls: "bg-white/40" },
  { key: "outside", label: "Outside reason (not counted)", cats: ["interrupted", "missing_info", "estimate"], cls: "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.35)_0_3px,transparent_3px_7px)] border border-white/30" },
  { key: "rest", label: "Rest", cats: ["rest"], cls: "bg-recovery" },
  { key: "skipped", label: "Skipped, no outside reason", cats: ["avoided", "missed"], cls: "bg-clash" },
  { key: "unmarked", label: "Not marked yet", cats: ["unmarked"], cls: "border border-dashed border-white/45" },
];

const mins = (b: Block) => Math.max(1, Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000));

/**
 * The day at a glance: every planned block in time order, as wide as it was
 * long, coloured by what happened to it. Legend lists only what's present.
 */
export function DayStrip({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null;
  const sorted = [...blocks].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const group = (b: Block) => GROUPS.find((g) => g.cats.includes(blockCategory(b)))!;
  const present = GROUPS.map((g) => ({ ...g, n: sorted.filter((b) => group(b).key === g.key).length })).filter((g) => g.n > 0);
  const label = `The day's ${sorted.length} block${sorted.length === 1 ? "" : "s"} in order: ${present.map((g) => `${g.n} ${g.label.toLowerCase()}`).join(", ")}.`;
  return (
    <div className="flex flex-col gap-2.5">
      <div role="img" aria-label={label} className="flex h-7 w-full gap-1">
        {sorted.map((b) => (
          <span key={b.id} className={`h-full min-w-1.5 rounded-[4px] ${group(b).cls}`} style={{ flexGrow: mins(b), flexBasis: 0 }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted" aria-hidden>
        {present.map((g) => (
          <li key={g.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[3px] ${g.cls}`} />
            {g.label} <span className="num">{g.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
