"use client";
import { ActionButton } from "@/components/action-button";
import { acceptManyAction } from "../actions";

export function InboxBulk({ ids }: { ids: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="muted text-sm">{ids.length} to review</span>
      <ActionButton className="btn btn-sm ml-auto" confirm={`Accept all ${ids.length} items as they are?`} action={() => acceptManyAction(ids)}>
        Accept all
      </ActionButton>
    </div>
  );
}
