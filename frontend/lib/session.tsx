"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import { api } from "./api-client";
import type { SessionUser } from "./api-client";
import { clearStoredSession, readStoredSession } from "./session-store";

interface Session {
  user: SessionUser | null;
  accessToken: string | null;
}

interface SessionContextValue extends Session {
  // False until the initial localStorage read has run — lets consumers
  // (AuthGuard) tell "not logged in yet" from "haven't checked yet" apart,
  // so a real session isn't bounced to /login on the very first render.
  hydrated: boolean;
  login: (session: { user: SessionUser; accessToken: string }) => void;
  logout: () => void;
  updateUser: (user: SessionUser) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * TODO(supabase-auth): this is a client-side stub session store. The
 * refresh token itself now lives only in an httpOnly, secure (in
 * production) cookie set by the backend (see auth.controller.ts) — never
 * in localStorage — so an XSS payload can at worst read the short-lived
 * access token, not the 7-day refresh token. Real Supabase session
 * handling (role claims verified server-side rather than trusted from
 * client storage) is still the eventual target; the non-httpOnly `session`
 * cookie below remains a route-protection UX hint only, never a security
 * boundary — proxy.ts must not be the only thing enforcing access.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({ user: null, accessToken: null });
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    const stored = readStoredSession();
    if (stored) {
      setSession({ user: stored.user as SessionUser, accessToken: stored.accessToken });
    }
    setHydrated(true);

    // A silent refresh from api-client.ts updates localStorage directly
    // (it has no React state to set); pick up the new access token here so
    // the session context stays in sync without a page reload.
    function onTokenRefreshed(e: Event) {
      const detail = (e as CustomEvent<{ accessToken: string }>).detail;
      if (detail?.accessToken) {
        setSession((prev) => (prev.user ? { ...prev, accessToken: detail.accessToken } : prev));
      }
    }
    // Fired by api-client.ts when a 401 can't be silently refreshed (e.g.
    // the refresh token expired/was revoked) — the session is just as gone
    // as an explicit logout, so it needs the exact same cleanup: clear any
    // cached query data and leave the protected area entirely, not just
    // clear local state while the current page keeps rendering its stale
    // last-fetched data.
    function onAuthLogout() {
      setSession({ user: null, accessToken: null });
      queryClient.clear();
      router.push("/login");
    }
    window.addEventListener("fs-token-refreshed", onTokenRefreshed as EventListener);
    window.addEventListener("fs-auth-logout", onAuthLogout);
    return () => {
      window.removeEventListener("fs-token-refreshed", onTokenRefreshed as EventListener);
      window.removeEventListener("fs-auth-logout", onAuthLogout);
    };
  }, [queryClient, router]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...session,
      hydrated,
      login: ({ user, accessToken }) => {
        setSession({ user, accessToken });
        try {
          localStorage.setItem("fs-session", JSON.stringify({ user, accessToken }));
          // Non-httpOnly cookie readable by proxy.ts for the route-protection
          // stub only — never store real secrets/tokens here in production.
          // Carries `permissions` (not just role) so proxy.ts can gate every
          // route by its actual required permission, not just OWNER/MANAGER
          // vs. everyone else.
          document.cookie = `session=${encodeURIComponent(JSON.stringify({ role: user.role, permissions: user.permissions ?? [] }))}; path=/; max-age=${60 * 60 * 24 * 7}`;
        } catch {
          // ignore storage errors (private browsing, etc.)
        }
      },
      logout: () => {
        setSession({ user: null, accessToken: null });
        clearStoredSession();
        // Every cached query result belongs to the session that's ending —
        // without this, the currently-rendered page (and anything else
        // still mounted) keeps showing that data until it's manually
        // refetched, which looks exactly like "logout didn't work."
        queryClient.clear();
        // Best-effort — clears the httpOnly refresh-token cookie server-
        // side too, so a stolen access token can't be silently refreshed
        // again after the user explicitly logs out.
        api.logout().catch(() => {});
        router.push("/login");
      },
      // Patches the stored user (e.g. after a profile name/avatar edit)
      // without touching the tokens, keeping localStorage + context in sync.
      updateUser: (user) => {
        setSession((prev) => ({ ...prev, user }));
        try {
          const stored = readStoredSession();
          if (stored) {
            localStorage.setItem("fs-session", JSON.stringify({ ...stored, user }));
          }
        } catch {
          // ignore storage errors
        }
      },
    }),
    [session, hydrated, queryClient, router],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
