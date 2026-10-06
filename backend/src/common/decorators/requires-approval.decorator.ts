import { SetMetadata } from '@nestjs/common';

export const REQUIRES_APPROVAL_KEY = 'requiresApproval';

/**
 * Marks an edit/delete route as gated by the pending-approval workflow: an
 * EMPLOYEE's request to this route is queued as a PendingAction instead of
 * executing immediately (see ApprovalInterceptor). OWNER/MANAGER/ACCOUNTANT
 * bypass this and execute directly, same as today.
 */
export const RequiresApproval = () => SetMetadata(REQUIRES_APPROVAL_KEY, true);
