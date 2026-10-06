/**
 * Fixed role -> permission capability matrix. Keeping the role enum small
 * (OWNER/MANAGER/ACCOUNTANT/EMPLOYEE) while permissions can grow here
 * without needing new roles or migrations.
 */
export type Role = 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'EMPLOYEE';

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  OWNER: [
    'view_reports',
    'view_dashboard',
    'view_safes',
    'edit_transactions',
    'manage_users',
    'view_audit_log',
    'manage_safes',
    'delete_safes',
    'manage_categories',
    'manage_parties',
    'manage_couriers',
    'manage_transactions',
    'manage_reconciliations',
    'manage_settings',
    'manage_import',
    'manage_pending_actions',
    'reset_system',
    'delete_users',
  ],
  // view_dashboard/view_safes included here as MANAGER's suggested-default
  // checklist state (per the comment on effectivePermissions() below) —
  // existing Manager accounts need scripts/backfill-view-dashboard-safes-permission.js
  // run once to actually receive these as stored rows; this array alone
  // does nothing for them at runtime.
  MANAGER: [
    'view_reports',
    'view_dashboard',
    'view_safes',
    'edit_transactions',
    'manage_users',
    'view_audit_log',
    'manage_safes',
    'manage_categories',
    'manage_parties',
    'manage_couriers',
    'manage_transactions',
    'manage_reconciliations',
    'manage_settings',
    'manage_import',
    'manage_pending_actions',
  ],
  ACCOUNTANT: [
    'view_reports',
    'edit_transactions',
    'manage_safes',
    'manage_categories',
    'manage_parties',
    'manage_couriers',
    'manage_transactions',
    'manage_reconciliations',
    'manage_import',
  ],
  // Deliberately empty — EMPLOYEE is the "hand-pick everything" role. Unlike
  // the other three (trusted staff roles with a sensible operational
  // baseline), an Employee gets ONLY what's explicitly granted as an extra
  // permission at creation/edit time. effectivePermissions() below is a
  // union of this default + those extras, so a non-empty default here would
  // be a floor no admin could ever remove — exactly the bug this fixes.
  EMPLOYEE: [],
};

export function roleHasPermission(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// Every permission string the system understands, for building an "extra
// permissions" picker in the UI. Keep in sync with the values used above
// and with any new @Permissions(...) decorators added to controllers.
export const ALL_PERMISSIONS = [
  'view_reports',
  'view_dashboard',
  'view_safes',
  'edit_transactions',
  'manage_users',
  'view_audit_log',
  'manage_safes',
  'delete_safes',
  'manage_categories',
  'manage_parties',
  'manage_couriers',
  'manage_transactions',
  'manage_reconciliations',
  'manage_settings',
  'manage_import',
  'manage_pending_actions',
  'reset_system',
  'delete_users',
] as const;

// OWNER is the one role whose permissions are NOT row-driven — always the
// full fixed list, unconditionally, so the system can never end up with
// zero fully-privileged accounts (confirmed safe choice: RolesGuard has no
// separate role===OWNER bypass anywhere, so if this weren't hardcoded an
// edited-down Owner would genuinely lose API access with no escape hatch).
// Every other role (MANAGER/ACCOUNTANT/EMPLOYEE) is fully free-form: this
// returns exactly their explicit RolePermission rows, nothing unioned in
// from ROLE_PERMISSIONS — that map is now only used as the suggested
// starting checklist state when an Owner creates a new user of that role
// (see users/page.tsx), never as a runtime floor. (Existing MANAGER/
// ACCOUNTANT/EMPLOYEE users had their then-current role-default
// permissions backfilled into explicit rows by
// scripts/backfill-role-permissions.js before this function changed, so
// this is not a regression for accounts that existed before this change.)
export function effectivePermissions(role: Role, extra: string[]): string[] {
  if (role === 'OWNER') return [...ROLE_PERMISSIONS.OWNER];
  return Array.from(new Set(extra));
}

// Actions gated behind the pending-approval workflow (see
// common/interceptors/approval.interceptor.ts): edit/delete routes an
// EMPLOYEE cannot execute directly — they get queued for OWNER/MANAGER
// review instead. Creates are intentionally excluded (still immediate).
export const APPROVAL_GATED_ROLE: Role = 'EMPLOYEE';
