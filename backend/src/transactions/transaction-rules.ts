import { BadRequestException } from '@nestjs/common';

/**
 * Pure port of the old app's validate_tx() (app/main.py), now keyed off
 * Category.partyType rather than matching category *names* — name matching
 * silently breaks the moment someone renames a category from the UI (this
 * happened on live data: the seeded "تحصيل من وكلاء المحافظات" category
 * had been renamed to "وكلاء المحافظات", desyncing every name-based check
 * in the app without any error). Kept dependency-free (no Prisma/DB calls)
 * so the rules can be unit tested directly.
 *
 * Rules:
 * 1. kind must be IN or OUT.
 * 2. category must exist, be active, and its kind must match the tx kind.
 * 3. category.partyType (if set) requires a party of the matching type.
 * 4. any other category must have no party attached.
 * 5. category.requiresCourier (if set) requires a courier — parallel to
 *    rule 3, but for مناديب القاهرة والجيزة instead of Party. Mutually
 *    exclusive with partyType (enforced in CategoriesService, not here).
 * 6. any category not requiring a courier must have no courier attached.
 */

// Still exported for callers that need to look up a specific well-known
// category by name (e.g. seeding, one-off data scripts) — no longer used
// for validation itself.
export const CATEGORY_REQUIRES_AGENT = 'تحصيل من وكلاء المحافظات';
export const CATEGORY_REQUIRES_MERCHANT = 'تحصيل للتاجر / الراسل';
export const CATEGORY_REDEPOSIT = 'إعادة إدخال مبلغ مسحوب';

export interface CategoryLike {
  kind: 'IN' | 'OUT';
  name: string;
  active: boolean;
  partyType?: string | null;
  requiresCourier?: boolean | null;
}

export interface PartyLike {
  partyType: 'AGENT' | 'MERCHANT';
  active: boolean;
}

export interface CourierLike {
  active: boolean;
}

export function validateTxRules(
  kind: 'IN' | 'OUT',
  category: CategoryLike | null | undefined,
  party: PartyLike | null | undefined,
  courier?: CourierLike | null,
): void {
  if (kind !== 'IN' && kind !== 'OUT') {
    throw new BadRequestException('اختر داخل أو خارج');
  }
  if (!category || !category.active) {
    throw new BadRequestException('اختر بند العملية');
  }
  if (category.kind !== kind) {
    throw new BadRequestException('البند لا ينتمي لهذا النوع');
  }

  const requiredPartyType = category.partyType;
  if (requiredPartyType) {
    if (!party || party.partyType !== requiredPartyType) {
      throw new BadRequestException(
        requiredPartyType === 'AGENT' ? 'اختر وكيل محافظة' : 'اختر الراسل',
      );
    }
  } else if (party) {
    throw new BadRequestException('لا يمكن ربط هذه الجهة بهذا البند');
  }

  if (category.requiresCourier) {
    if (!courier) {
      throw new BadRequestException('اختر المندوب');
    }
  } else if (courier) {
    throw new BadRequestException('لا يمكن ربط مندوب بهذا البند');
  }
}
