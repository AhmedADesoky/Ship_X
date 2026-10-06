"use client";

import { useSession } from "./session";
import { hasPermission } from "./permissions";
import type { Permission } from "./api-client";

/** `usePermission(null)` always returns true — matches hasPermission's
 * "no specific permission required" semantics for self-service pages.
 * Accepts either a single permission (the common case, for gating one
 * button/action) or an array (any one of which unlocks it). */
export function usePermission(permission: Permission | Permission[] | null): boolean {
  const { user } = useSession();
  return hasPermission(user, permission);
}
