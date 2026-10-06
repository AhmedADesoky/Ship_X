import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveAuditAction, resolveEntityLabel } from '../audit-descriptions';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Field names (case-insensitive, matched anywhere in a nested object) that
// must never be persisted in the audit trail — passwords and auth tokens
// are secrets, not business data, and showing them in a "what changed"
// record (even to an OWNER) is a real exposure, not just a display bug.
const SENSITIVE_KEYS = /^(password|passwordhash|.*token|.*secret|.*apikey)$/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(val),
      ]),
    );
  }
  return value;
}

/**
 * Global interceptor that writes an audit_logs row for every mutating
 * request (POST/PATCH/PUT/DELETE) — both successful (tap, statusCode null)
 * and rejected (catchError, statusCode set to the actual HTTP status).
 * Logging failed attempts is what makes brute-force/probing behavior
 * (repeated 401/403/400 on login, MFA, or any guarded route) forensically
 * visible after the fact — a success-only log can't show that at all.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method: string = request.method;

    if (!MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseBody) => this.writeLog(request, method, responseBody, null)),
      catchError((err) => {
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        this.writeLog(request, method, undefined, statusCode);
        return throwError(() => err);
      }),
    );
  }

  private writeLog(request: any, method: string, responseBody: unknown, statusCode: number | null) {
    const user = request.user as { userId?: string } | undefined;
    const entityType = (request.route?.path ?? request.url ?? 'unknown').toString();
    const routePath = entityType.replace(/^\/+/, '');
    const semanticAction = resolveAuditAction(method, routePath);
    const entityLabel =
      resolveEntityLabel(method, routePath, request.body, request.params) ??
      // Fall back to a name pulled from the response body, useful for
      // creates where the response echoes the new row (e.g. safe/client/
      // party creation) even though the request body already had it too.
      (responseBody && typeof (responseBody as any).name === 'string' ? (responseBody as any).name : undefined);

    this.prisma.auditLog
      .create({
        data: {
          actorId: user?.userId ?? null,
          action: method,
          entityType: routePath,
          entityId: request.params?.id ?? null,
          semanticAction,
          entityLabel,
          before: request.body ? this.safeJson(request.body) : undefined,
          after: responseBody ? this.safeJson(responseBody) : undefined,
          statusCode,
        },
      })
      .catch(() => {
        // Audit logging must never break the primary request flow.
      });
  }

  // Prisma's JSON column type is intentionally permissive input-side; the
  // redact() step above is what actually keeps secrets out, not this type.
  private safeJson(value: unknown): Prisma.InputJsonValue | undefined {
    try {
      return redact(JSON.parse(JSON.stringify(value))) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
}
