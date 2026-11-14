import { useEffect, useState } from "react";
import { api } from "../api/client";
import { supabase } from "../auth/supabase";

export type Me = { name: string | null; timezone: string };

let cache: Me | null = null;

/** The signed-in person's basics. Falls back to the sign-in record until the server answers. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(cache);
  useEffect(() => {
    let live = true;
    void supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
      if (live && !cache) setMe({ name: meta?.full_name ?? meta?.name ?? null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    });
    api<Me>("/api/m/me")
      .then((m) => {
        cache = m;
        if (live) setMe(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return me;
}
