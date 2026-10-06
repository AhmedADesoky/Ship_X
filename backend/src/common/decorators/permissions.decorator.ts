import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Marks a route/controller as requiring one or more capability strings
 * (e.g. 'manage_users', 'view_audit_log'). Checked by RolesGuard against
 * the fixed role -> permission matrix in role-permissions.ts. When more
 * than one permission is listed, holding ANY ONE of them is sufficient
 * (OR semantics).
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
