import Link from "next/link";

export function BudgetBanner({ spent, cap, exceeded }: { spent: number; cap: number; exceeded: boolean }) {
  return (
    <div role="status" className={`border-b border-border px-4 py-2 text-sm ${exceeded ? "bg-danger-soft" : "bg-warn-soft"}`}>
      {exceeded
        ? `AI testing budget used up for today (≈$${spent.toFixed(2)} of $${cap.toFixed(2)}). AI replies are paused; everything else works. `
        : `AI testing spend today is ≈$${spent.toFixed(2)} of $${cap.toFixed(2)}. `}
      <Link href="/settings#budget" className="underline">Details</Link>
    </div>
  );
}
