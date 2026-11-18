import type { MActivityList, MMemoryList, MNoteList, MProgress, MSpaceList } from "@shared/mobile-api-you";
import { useResource } from "./plan";

// Progress and the You screens (M6 step 4). Each screen loads its own list
// when it opens; changes answer with the new list or are refreshed after.

export const useProgress = (on: boolean) => useResource<MProgress>(on ? "/api/m/progress" : null);
export const useMemory = () => useResource<MMemoryList>("/api/m/memory");
export const useNotes = () => useResource<MNoteList>("/api/m/notes");
export const useActivity = () => useResource<MActivityList>("/api/m/activity");
export const useSpaces = () => useResource<MSpaceList>("/api/m/spaces");

/** A 404 here means the server hasn't got these screens yet (an older deployment). */
export const notOnServer = (error: string | null) => !!error && /not found/i.test(error);
