import * as server from "./actions";
import { connectionError } from "@/lib/connection";

// Client-side versions of the server actions. A server action that can't
// reach the server throws, which would take down the whole page; these
// return the usual { ok: false, error } instead, so the screen stays usable
// and says plainly that the change didn't go through. Client components
// import from here; server components pass the originals to ActionButton,
// which handles the same failure itself.

type Failure = { ok: false; error: string };

function safe<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | Failure> => {
    try {
      return await action(...args);
    } catch {
      return { ok: false, error: connectionError() };
    }
  };
}

export const createTaskAction = safe(server.createTaskAction);
export const updateTaskAction = safe(server.updateTaskAction);
export const completeTaskAction = safe(server.completeTaskAction);
export const startFocusAction = safe(server.startFocusAction);
export const endFocusAction = safe(server.endFocusAction);
export const createItemAction = safe(server.createItemAction);
export const updateItemAction = safe(server.updateItemAction);
export const deleteItemAction = safe(server.deleteItemAction);
export const acceptProposalAction = safe(server.acceptProposalAction);
export const acceptManyAction = safe(server.acceptManyAction);
export const setProposalStatusAction = safe(server.setProposalStatusAction);
export const editProposalAction = safe(server.editProposalAction);
export const mergeProposalAction = safe(server.mergeProposalAction);
export const completeOnboardingAction = safe(server.completeOnboardingAction);
export const skipOnboardingAction = safe(server.skipOnboardingAction);
export const restartOnboardingAction = safe(server.restartOnboardingAction);
export const planDayAction = safe(server.planDayAction);
export const planWeekAction = safe(server.planWeekAction);
export const blockOutcomeAction = safe(server.blockOutcomeAction);
export const recoverPlanAction = safe(server.recoverPlanAction);
export const addMemoryAction = safe(server.addMemoryAction);
export const correctMemoryAction = safe(server.correctMemoryAction);
export const confirmMemoryAction = safe(server.confirmMemoryAction);
export const rejectMemoryAction = safe(server.rejectMemoryAction);
export const deleteMemoryAction = safe(server.deleteMemoryAction);
export const decideApprovalAction = safe(server.decideApprovalAction);
export const revertActivityAction = safe(server.revertActivityAction);
export const updateProfileAction = safe(server.updateProfileAction);
export const adoptBrowserTimezoneAction = safe(server.adoptBrowserTimezoneAction);
export const approveBudgetOverrideAction = safe(server.approveBudgetOverrideAction);
export const markBriefingReadAction = safe(server.markBriefingReadAction);
export const generateBriefingAction = safe(server.generateBriefingAction);
