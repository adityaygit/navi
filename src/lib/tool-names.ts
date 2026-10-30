// Tools that only read. Their calls aren't listed as "actions taken" in the
// shared history (text chat and the voice client both use this list).
export const READ_ONLY_TOOLS: readonly string[] = ["get_overview", "get_plan", "get_inbox", "search_items", "recall"];
