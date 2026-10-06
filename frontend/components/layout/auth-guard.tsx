"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSession } from "@/lib/session";

/**
 * Real client-side gate for the (dashboard) route group — until now the
 * only thing standing between an unauthenticated visitor and this whole
 * area was proxy.ts's non-httpOnly `session` cookie check, which its own
 * comment already documents as a UX hint, never a security boundary (a
 * cleared/missing cookie is easy to end up with, e.g. right after logout,
 * while stale React Query data is still rendered — see lib/session.tsx).
 * This renders nothing until a real access token is confirmed present,
 * and redirects to /login otherwise, so no protected page's content or
 * data-fetching effects ever run for a signed-out visitor.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { accessToken, hydrated } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !accessToken) {
      router.replace("/login");
    }
  }, [hydrated, accessToken, router]);

  if (!hydrated || !accessToken) {
    return null;
  }

  return <>{children}</>;
}
