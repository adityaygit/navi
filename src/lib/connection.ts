/** What to tell someone when a request to the server didn't go through. */
export function connectionError() {
  return typeof navigator !== "undefined" && !navigator.onLine
    ? "You're offline, so this didn't go through. Try again when you're back online (captures still save offline)."
    : "Couldn't reach Navi, so this may not have gone through. Check your connection and try again.";
}
