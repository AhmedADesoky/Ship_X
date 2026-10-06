import type { Permission, SessionUser } from "./api-client";

/**
 * Single source of truth for "what permission(s) does this route need to be
 * viewed." Mirrors the backend's per-controller @Permissions(...) guards
 * (see backend/src/ controllers) for the primary view permission, PLUS
 * (Phase 34a) a fallback list of manage_-prefixed/edit_-prefixed permissions that also
 * imply the page should be visible — an Employee granted `manage_parties`
 * but not `view_reports`, for example, can now see `/parties` too, since
 * there'd otherwise be no way for them to use the permission they were
 * actually given. Each value is an array: holding ANY ONE of its entries
 * unlocks the route. Kept in one place so the sidebar, page-level gates
 * (RequirePermission, which auto-derives from the current path), and the
 * Edge middleware (proxy.ts) can never drift out of sync with each other.
 * `null` means "no specific permission needed beyond being logged in"
 * (e.g. a self-service page like /profile).
 */
export const ROUTE_PERMISSIONS: Record<string, Permission[] | null> = {
  "/dashboard": ["view_dashboard"],
  "/reports": ["view_reports"],
  "/safes": ["view_safes", "manage_safes"],
  "/transactions": ["view_reports", "edit_transactions", "manage_transactions"],
  "/expenses": ["view_reports", "manage_categories", "manage_transactions"],
  "/income": ["view_reports", "manage_categories", "manage_transactions"],
  "/senders": ["view_reports", "manage_parties"],
  "/agents": ["view_reports", "manage_parties"],
  "/couriers": ["view_reports", "manage_couriers"],
  "/drawings": ["view_reports", "manage_parties"],
  "/deferred": ["view_reports", "manage_parties"],
  "/clients": ["view_reports", "manage_parties", "manage_couriers"],
  "/parties": ["view_reports", "manage_parties"],
  "/categories": ["view_reports", "manage_categories"],
  "/reconciliation": ["view_reports", "manage_reconciliations"],
  "/import": ["manage_import"],
  "/users": ["manage_users"],
  "/audit": ["view_audit_log"],
  "/pending": ["manage_pending_actions"],
  "/settings": ["view_reports", "manage_settings"],
  "/profile": null,
};

/** Longest-prefix match against ROUTE_PERMISSIONS, e.g. "/parties/abc-123"
 * resolves via the "/parties" entry. Routes not listed default to `null`
 * (no gate) rather than silently locking out a page nobody mapped yet. */
export function permissionForRoute(pathname: string): Permission[] | null {
  const withoutLocale = pathname.replace(/^\/(en|ar)(?=\/|$)/, "") || "/";
  const match = Object.keys(ROUTE_PERMISSIONS)
    .filter((prefix) => withoutLocale === prefix || withoutLocale.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_PERMISSIONS[match] : null;
}

export function hasPermission(
  user: SessionUser | null | undefined,
  permission: Permission | Permission[] | null,
): boolean {
  if (permission === null) return true;
  const required = Array.isArray(permission) ? permission : [permission];
  if (required.length === 0) return true;
  return required.some((p) => !!user?.permissions?.includes(p));
}
