/**
 * Maps a raw (HTTP method, route pattern) pair recorded by AuditInterceptor
 * into a semantic, translatable action key such as `user.login` or
 * `client.drawing.created`. The raw method/route are still stored alongside
 * this (see AuditInterceptor) — this is purely an additional, human-friendly
 * label consumed by the frontend's audit log page (messages.*.auditActions).
 *
 * Route patterns use NestJS's `:param` syntax exactly as `request.route.path`
 * reports it (leading slash stripped to match the interceptor's entityType).
 */

export interface AuditActionMatch {
  method: string;
  /** Route pattern with NestJS `:param` placeholders, no leading slash. */
  pattern: string;
  /** Semantic action key, dot-namespaced, e.g. `safe.created`. */
  action: string;
  /** Which request/response field to pull a display name from, if any. */
  entityLabel?: 'body.name' | 'body.title' | 'param.id';
}

const RULES: AuditActionMatch[] = [
  // auth
  { method: 'POST', pattern: 'auth/login', action: 'user.login' },
  { method: 'POST', pattern: 'auth/refresh', action: 'user.session.refreshed' },

  // users
  { method: 'POST', pattern: 'users', action: 'user.created', entityLabel: 'body.name' },
  { method: 'PATCH', pattern: 'users/me', action: 'user.profile.updated' },
  { method: 'POST', pattern: 'users/me/avatar', action: 'user.avatar.updated' },
  { method: 'DELETE', pattern: 'users/me/avatar', action: 'user.avatar.removed' },
  { method: 'PATCH', pattern: 'users/:id', action: 'user.updated' },
  { method: 'DELETE', pattern: 'users/:id', action: 'user.deactivated' },

  // safes
  { method: 'POST', pattern: 'safes', action: 'safe.created', entityLabel: 'body.name' },
  { method: 'POST', pattern: 'safes/transfer', action: 'safe.transfer.created' },
  { method: 'POST', pattern: 'safes/:id/adjust-balance', action: 'safe.balance.adjusted' },
  { method: 'POST', pattern: 'safes/:id/deposit', action: 'safe.deposited' },
  { method: 'DELETE', pattern: 'safes/:id', action: 'safe.deleted' },

  // categories
  { method: 'POST', pattern: 'categories', action: 'category.created', entityLabel: 'body.name' },
  { method: 'PATCH', pattern: 'categories/:id', action: 'category.updated' },
  { method: 'DELETE', pattern: 'categories/:id', action: 'category.deleted' },

  // parties (+ sub-resources)
  { method: 'POST', pattern: 'parties', action: 'party.created', entityLabel: 'body.name' },
  { method: 'PATCH', pattern: 'parties/:id', action: 'party.updated' },
  { method: 'DELETE', pattern: 'parties/:id', action: 'party.deleted' },
  { method: 'POST', pattern: 'parties/:id/drawings', action: 'party.drawing.created' },
  { method: 'POST', pattern: 'parties/:id/deferred', action: 'party.deferred.created' },
  {
    method: 'POST',
    pattern: 'parties/:id/deferred/:deferredId/payments',
    action: 'party.deferred.paymentAdded',
  },
  { method: 'POST', pattern: 'parties/:id/settlements', action: 'party.settlement.created' },
  { method: 'POST', pattern: 'parties/:id/drawings/:drawingId/cancel', action: 'party.drawing.cancelled' },

  // couriers (مناديب القاهرة والجيزة)
  { method: 'POST', pattern: 'couriers', action: 'courier.created', entityLabel: 'body.name' },
  { method: 'PATCH', pattern: 'couriers/:id', action: 'courier.updated' },
  { method: 'DELETE', pattern: 'couriers/:id', action: 'courier.deleted' },
  { method: 'POST', pattern: 'couriers/sheet-collections', action: 'courier.sheetCollection.created' },
  { method: 'POST', pattern: 'couriers/:id/advances', action: 'courier.advance.created' },
  { method: 'POST', pattern: 'couriers/:id/advances/:advanceId/repayments', action: 'courier.advance.repaid' },

  // transactions
  { method: 'POST', pattern: 'transactions', action: 'transaction.created' },
  { method: 'PATCH', pattern: 'transactions/:id', action: 'transaction.updated' },
  { method: 'POST', pattern: 'transactions/:id/void', action: 'transaction.voided' },

  // reconciliations
  { method: 'POST', pattern: 'reconciliations', action: 'reconciliation.created' },

  // settings
  { method: 'PUT', pattern: 'settings', action: 'settings.updated' },
  { method: 'POST', pattern: 'settings/reset', action: 'settings.systemReset' },

  // pending actions
  { method: 'POST', pattern: 'pending-actions/:id/approve', action: 'pendingAction.approved' },
  { method: 'POST', pattern: 'pending-actions/:id/reject', action: 'pendingAction.rejected' },

  // import
  { method: 'POST', pattern: 'import/inspect', action: 'import.inspected' },
  { method: 'POST', pattern: 'import/commit', action: 'import.committed' },
];

/** Fallback when no rule matches: `<method>.<firstSegment>` e.g. `post.widgets`. */
function fallbackAction(method: string, routePath: string): string {
  const firstSegment = routePath.split('/')[0] || 'unknown';
  return `${method.toLowerCase()}.${firstSegment}`;
}

export function resolveAuditAction(method: string, routePath: string): string {
  const normalized = routePath.replace(/^\/+/, '');
  const match = RULES.find((r) => r.method === method && r.pattern === normalized);
  return match?.action ?? fallbackAction(method, normalized);
}

export function resolveEntityLabel(
  method: string,
  routePath: string,
  body: Record<string, unknown> | undefined,
  params: Record<string, unknown> | undefined,
): string | undefined {
  const normalized = routePath.replace(/^\/+/, '');
  const match = RULES.find((r) => r.method === method && r.pattern === normalized);
  if (!match?.entityLabel) return undefined;

  switch (match.entityLabel) {
    case 'body.name':
      return typeof body?.name === 'string' ? body.name : undefined;
    case 'body.title':
      return typeof body?.title === 'string' ? body.title : undefined;
    case 'param.id':
      return typeof params?.id === 'string' ? params.id : undefined;
    default:
      return undefined;
  }
}
