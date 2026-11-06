"use client";
import { ActionButton } from "@/components/action-button";
import { acceptManyAction } from "@/app/(app)/client-actions";

/** Accept everything at once, or only what you said yourself (Navi's guesses stay for a closer look). */
export function InboxBulk({ ids, statedIds = [] }: { ids: string[]; statedIds?: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {statedIds.length > 0 && (
        <ActionButton className="btn btn-sm" confirm={`Accept the ${statedIds.length} items you said, as they are?`} action={() => acceptManyAction(statedIds)}>
          Accept the {statedIds.length} you said
        </ActionButton>
      )}
      <ActionButton className="btn btn-sm" confirm={`Accept all ${ids.length} items as they are?`} action={() => acceptManyAction(ids)}>
        Accept all
      </ActionButton>
    </div>
  );
}
