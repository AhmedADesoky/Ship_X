import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { APPROVAL_GATED_ROLE } from '../role-permissions';
import { REQUIRES_APPROVAL_KEY } from '../decorators/requires-approval.decorator';

/**
 * Global interceptor that queues an EMPLOYEE's edit/delete request instead
 * of letting it execute, when the route carries @RequiresApproval(). Must
 * be registered before AuditInterceptor (see app.module.ts) so a queued
 * request never reaches the controller and never gets an audit-log entry
 * of its own — only the eventual approve/reject action does.
 */
@Injectable()
export class ApprovalInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requiresApproval = this.reflector.getAllAndOverride<boolean>(REQUIRES_APPROVAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiresApproval) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId?: string; role?: string } | undefined;

    if (!user?.userId || user.role !== APPROVAL_GATED_ROLE) {
      return next.handle();
    }

    const route = (request.route?.path ?? request.url ?? 'unknown').toString().replace(/^\/+/, '');
    const entityType = route.split('/')[0] || 'unknown';

    return new Observable((subscriber) => {
      this.prisma.pendingAction
        .create({
          data: {
            actorId: user.userId!,
            method: request.method,
            route,
            entityType,
            entityId: request.params?.id ?? null,
            payload: request.body ? JSON.parse(JSON.stringify(request.body)) : {},
          },
        })
        .then((created) => {
          subscriber.next({ queued: true, pendingActionId: created.id });
          subscriber.complete();
        })
        .catch((err) => subscriber.error(err));
    });
  }
}
