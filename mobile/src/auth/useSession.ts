import { useEffect, useState } from "react";
import { supabase, type Session } from "./supabase";

/** undefined while the stored session is being read, null when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data }) => live && setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return session;
}
