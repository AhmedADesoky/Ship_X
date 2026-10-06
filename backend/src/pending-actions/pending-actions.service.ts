import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PartiesService } from '../parties/parties.service';
import { CategoriesService } from '../categories/categories.service';
import { SafesService } from '../safes/safes.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CouriersService } from '../couriers/couriers.service';
import { resolveAuditAction, resolveEntityLabel } from '../common/audit-descriptions';

/**
 * Re-dispatches an approved PendingAction's stored (method, route, payload)
 * through the same service methods the original controller would have
 * called. Mirrors audit-descriptions.ts's route-pattern-matching approach —
 * the pattern is the literal NestJS `:id` route as recorded by
 * ApprovalInterceptor, not a runtime path.
 */
@Injectable()
export class PendingActionsService {
  constructor(
    private prisma: PrismaService,
    private parties: PartiesService,
    private categories: CategoriesService,
    private safes: SafesService,
    private transactions: TransactionsService,
    private couriers: CouriersService,
  ) {}

  async list(status?: string) {
    const actions = await this.prisma.pendingAction.findMany({
      where: status ? { status: status as any } : undefined,
      include: { actor: { select: { name: true, email: true } }, reviewedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Mirrors what AuditInterceptor does for AuditLog — attach a semantic,
    // translatable action + a display label, so the frontend never has to
    // render the raw method/route/payload as the primary text.
    return actions.map((action) => ({
      ...action,
      semanticAction: resolveAuditAction(action.method, action.route),
      entityLabel: resolveEntityLabel(action.method, action.route, action.payload as Record<string, unknown>, {
        id: action.entityId,
      }),
    }));
  }

  private async dispatch(action: {
    method: string;
    route: string;
    entityId: string | null;
    payload: any;
    actorId: string;
  }) {
    const key = `${action.method} ${action.route}`;
    switch (key) {
      case 'POST parties':
        return this.parties.create(action.payload);
      case 'POST categories':
        return this.categories.create(action.payload);
      case 'POST safes':
        return this.safes.create(action.payload);
      case 'POST transactions':
        return this.transactions.create(action.payload, action.actorId);
      case 'POST transactions/batch':
        return this.transactions.createBatch(action.payload, action.actorId);
      case 'PATCH parties/:id':
        return this.parties.update(action.entityId!, action.payload);
      case 'DELETE parties/:id':
        return this.parties.remove(action.entityId!);
      case 'PATCH categories/:id':
        return this.categories.update(action.entityId!, action.payload);
      case 'DELETE categories/:id':
        return this.categories.remove(action.entityId!);
      case 'DELETE safes/:id':
        return this.safes.remove(action.entityId!);
      case 'POST safes/:id/adjust-balance':
        return this.safes.adjustBalance(action.entityId!, action.payload, action.actorId);
      case 'PATCH transactions/:id':
        return this.transactions.update(action.entityId!, action.payload);
      case 'POST transactions/:id/void':
        return this.transactions.void(action.entityId!);
      case 'POST parties/:id/settlements':
        return this.parties.createSettlement(action.entityId!, action.payload, action.actorId);
      case 'POST couriers':
        return this.couriers.create(action.payload);
      case 'PATCH couriers/:id':
        return this.couriers.update(action.entityId!, action.payload);
      case 'DELETE couriers/:id':
        return this.couriers.remove(action.entityId!);
      case 'POST couriers/sheet-collections':
        return this.couriers.createSheetCollection(action.payload, action.actorId);
      case 'PATCH couriers/sheet-collections/:collectionId/assign':
        return this.couriers.assignSheetCollection(action.payload.collectionId, action.payload.courierId);
      case 'POST couriers/:id/advances':
        return this.couriers.createAdvance(action.entityId!, action.payload, action.actorId);
      case 'POST couriers/:id/advances/:advanceId/repayments':
        return this.couriers.createRepayment(action.entityId!, action.payload.advanceId, action.payload, action.actorId);
      default:
        throw new BadRequestException(`No dispatcher registered for ${key}`);
    }
  }

  async approve(id: string, reviewerId: string) {
    const action = await this.prisma.pendingAction.findUnique({ where: { id } });
    if (!action) throw new NotFoundException('Pending action not found');
    if (action.status !== 'PENDING') throw new BadRequestException('Action already reviewed');

    // Atomically claim the action (PENDING -> APPROVED) BEFORE dispatching,
    // rather than after: dispatch() calls into other services that run
    // their own Prisma transactions, so it can't be wrapped in the same
    // outer transaction as this status update. Claiming first with a
    // conditional updateMany closes the race where two concurrent approve
    // calls both pass the findUnique check above and both dispatch —
    // whichever call updates 0 rows loses the race and is rejected before
    // it can double-execute the underlying action (e.g. double-void).
    const claim = await this.prisma.pendingAction.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Action already reviewed');
    }

    try {
      return await this.dispatch(action as any);
    } catch (err) {
      // Dispatch failed after the action was claimed — revert to PENDING so
      // it can be retried instead of being stuck APPROVED with no effect.
      await this.prisma.pendingAction.update({
        where: { id },
        data: { status: 'PENDING', reviewedById: null, reviewedAt: null },
      });
      throw err;
    }
  }

  async reject(id: string, reviewerId: string) {
    const action = await this.prisma.pendingAction.findUnique({ where: { id } });
    if (!action) throw new NotFoundException('Pending action not found');
    if (action.status !== 'PENDING') throw new BadRequestException('Action already reviewed');

    const claim = await this.prisma.pendingAction.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Action already reviewed');
    }

    return this.prisma.pendingAction.findUnique({ where: { id } });
  }
}
