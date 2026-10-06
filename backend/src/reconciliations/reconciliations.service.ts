import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';

@Injectable()
export class ReconciliationsService {
  constructor(
    private prisma: PrismaService,
    private safesService: SafesService,
  ) {}

  findAll() {
    return this.prisma.reconciliation.findMany({
      include: { safe: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * expectedBalance is ALWAYS computed server-side from the live safe
   * balance at submit time — never trusted from the client — matching the
   * plan's requirement. difference = actual - expected.
   */
  async create(dto: CreateReconciliationDto, createdById: string | undefined) {
    const safe = await this.prisma.safe.findUnique({ where: { id: dto.safeId } });
    if (!safe) throw new NotFoundException('Safe not found');

    const expectedBalance = await this.safesService.getBalance(dto.safeId);
    const difference = dto.actualBalance - expectedBalance;

    return this.prisma.reconciliation.create({
      data: {
        safeId: dto.safeId,
        reconDate: new Date(dto.reconDate),
        expectedBalance,
        actualBalance: dto.actualBalance,
        difference,
        note: dto.note,
        createdById,
      },
      include: { safe: true },
    });
  }
}
