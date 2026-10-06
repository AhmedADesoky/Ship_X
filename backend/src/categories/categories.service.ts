import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  findAll(kind?: 'IN' | 'OUT') {
    return this.prisma.category.findMany({
      where: { active: true, ...(kind ? { kind } : {}) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CreateCategoryDto) {
    if (dto.partyType && dto.requiresCourier) {
      throw new BadRequestException('لا يمكن أن يتطلب البند جهة ومندوبًا في نفس الوقت');
    }
    const existing = await this.prisma.category.findUnique({
      where: { name_kind: { name: dto.name.trim(), kind: dto.kind } },
    });
    if (existing) throw new ConflictException('Category already exists');
    await this.assertNameNotShadowingSystemCategory(dto.name.trim());
    return this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        kind: dto.kind,
        partyType: dto.partyType ?? null,
        requiresCourier: dto.requiresCourier ?? false,
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const category = await this.findOne(id);
    // A fixed/system category's linkage (its role in drawing/deferred/
    // courier/reset flows) must stay intact — renaming its display name is
    // fine, but it can never be deactivated through the normal Categories
    // UI, and neither partyType nor requiresCourier can be changed on it
    // either: both are load-bearing for how its dedicated flow finds it
    // (findCategoryIdByPartyType/findCategoryIdBySystemKey), and editing
    // either here can only ever be accidental/confusing — it has no real
    // effect for the 3 courier systemKeys (their linkage is systemKey-only,
    // never routed through this generic form), and would silently break
    // validateTxRules enforcement for the party-linked ones (e.g.
    // AGENT_COLLECTION, MERCHANT_SENDER) if cleared.
    if (category.systemKey) {
      if (dto.active === false) {
        throw new BadRequestException('لا يمكن تعطيل بند نظامي ثابت');
      }
      if (
        (dto.partyType !== undefined && dto.partyType !== category.partyType) ||
        (dto.requiresCourier !== undefined && dto.requiresCourier !== category.requiresCourier)
      ) {
        throw new BadRequestException('لا يمكن تعديل نوع الجهة أو ربط المندوب لبند نظامي ثابت');
      }
    }
    const nextPartyType = dto.partyType !== undefined ? dto.partyType : category.partyType;
    const nextRequiresCourier = dto.requiresCourier !== undefined ? dto.requiresCourier : category.requiresCourier;
    if (nextPartyType && nextRequiresCourier) {
      throw new BadRequestException('لا يمكن أن يتطلب البند جهة ومندوبًا في نفس الوقت');
    }
    if (dto.name !== undefined && dto.name.trim() !== category.name) {
      await this.assertNameNotShadowingSystemCategory(dto.name.trim(), id);
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  /**
   * Prevents the exact trap found in Phase 36: a plain (non-system)
   * category silently sharing a display name with a real system category
   * (systemKey-tagged) — the frontend/backend both detect courier/party
   * linkage purely by systemKey, so a same-named plain category looks
   * identical in the UI but silently never reaches the real linked flow.
   * `excludeId` lets a system category rename itself without tripping on
   * its own name.
   */
  private async assertNameNotShadowingSystemCategory(name: string, excludeId?: string) {
    const clash = await this.prisma.category.findFirst({
      where: {
        name,
        active: true,
        systemKey: { not: null },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (clash) {
      throw new BadRequestException('هذا الاسم مستخدم لبند نظامي ثابت — اختر اسمًا آخر');
    }
  }

  async remove(id: string) {
    const category = await this.findOne(id);
    if (category.systemKey) {
      throw new BadRequestException('لا يمكن حذف بند نظامي ثابت');
    }
    // Soft-delete: preserve history for any transaction still referencing it.
    return this.prisma.category.update({ where: { id }, data: { active: false } });
  }

  /** Mirrors the old app's /api/categories/{cid}/summary endpoint. */
  async summary(id: string, start?: string, end?: string) {
    const category = await this.findOne(id);
    const where: any = { categoryId: id, status: 'POSTED' };
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = new Date(start);
      if (end) where.createdAt.lte = new Date(end);
    }
    const [agg, transactions] = await Promise.all([
      this.prisma.transaction.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { safe: true, party: true },
      }),
    ]);
    return {
      category,
      total: Number(agg._sum.amount ?? 0),
      count: agg._count,
      firstDate: agg._min.createdAt,
      lastDate: agg._max.createdAt,
      transactions,
    };
  }

  /** Rules ported from the old app's validate_tx(): category must exist,
   * be active, and its kind must match the transaction kind. */
  async assertUsable(categoryId: string, kind: 'IN' | 'OUT') {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || !category.active) throw new BadRequestException('اختر بند العملية');
    if (category.kind !== kind) throw new BadRequestException('البند لا ينتمي لهذا النوع');
    return category;
  }
}
