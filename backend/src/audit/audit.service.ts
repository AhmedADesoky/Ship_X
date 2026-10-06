import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditFilters {
  actorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  findAll(page = 1, pageSize = 50, filters: AuditFilters = {}) {
    const skip = (page - 1) * pageSize;
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
  }
}
