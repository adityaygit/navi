"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Shared between the chat (centre of Home, or the Navi panel on other pages)
 * and the pages: whether the panel is open, and a way for a page ("Ask Navi to
 * help", Home's suggestion, the command palette) to hand Navi a message. The
 * chat lives in the app layout, so this state survives moving between pages.
 */
type Ask = { id: number; text: string };
type PanelApi = {
  /** The person's saved choice for pages other than Home. */
  pref: "open" | "collapsed";
  setPref: (v: "open" | "collapsed") => void;
  /** Open the panel (off Home) and send this to Navi. */
  ask: (text: string) => void;
  /** Open the panel (off Home) with this text in the box, not sent. */
  draft: (text: string) => void;
  pendingAsk: Ask | null;
  pendingDraft: Ask | null;
  consume: (id: number) => void;
};

const PanelContext = createContext<PanelApi | null>(null);

export const PANEL_COOKIE = "navi_panel";
export const NAV_COOKIE = "navi_nav";

export function setShellCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

export function PanelProvider({ initialPref, children }: { initialPref: "open" | "collapsed"; children: React.ReactNode }) {
  const [pref, setPrefState] = useState(initialPref);
  const [pendingAsk, setPendingAsk] = useState<Ask | null>(null);
  const [pendingDraft, setPendingDraft] = useState<Ask | null>(null);
  const setPref = useCallback((v: "open" | "collapsed") => {
    setPrefState(v);
    setShellCookie(PANEL_COOKIE, v);
  }, []);
  const api = useMemo<PanelApi>(
    () => ({
      pref,
      setPref,
      ask: (text) => {
        setPref("open");
        setPendingAsk({ id: Date.now() + Math.random(), text });
      },
      draft: (text) => {
        setPref("open");
        setPendingDraft({ id: Date.now() + Math.random(), text });
      },
      pendingAsk,
      pendingDraft,
      consume: (id) => {
        setPendingAsk((a) => (a?.id === id ? null : a));
        setPendingDraft((d) => (d?.id === id ? null : d));
      },
    }),
    [pref, setPref, pendingAsk, pendingDraft],
  );
  return <PanelContext.Provider value={api}>{children}</PanelContext.Provider>;
}

export function usePanel(): PanelApi {
  const v = useContext(PanelContext);
  if (!v) throw new Error("usePanel outside PanelProvider");
  return v;
}

/** For components that may render outside the app shell (e.g. /welcome). */
export function usePanelOptional(): PanelApi | null {
  return useContext(PanelContext);
}
