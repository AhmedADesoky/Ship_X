-- Phase 24: مناديب القاهرة والجيزة (Cairo & Giza Couriers)
-- Additive only — no existing data destroyed. The category UPDATE below
-- only sets a previously-null column on an existing row.

CREATE TABLE "couriers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "couriers_name_key" ON "couriers"("name");

CREATE TABLE "courier_sheet_collections" (
  "id" TEXT NOT NULL,
  "courier_id" TEXT,
  "safe_id" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "transaction_id" TEXT,
  "note" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "courier_sheet_collections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "courier_sheet_collections_courier_id_idx" ON "courier_sheet_collections"("courier_id");
CREATE INDEX "courier_sheet_collections_safe_id_idx" ON "courier_sheet_collections"("safe_id");
CREATE INDEX "courier_sheet_collections_created_at_idx" ON "courier_sheet_collections"("created_at");
ALTER TABLE "courier_sheet_collections"
  ADD CONSTRAINT "courier_sheet_collections_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "courier_sheet_collections_safe_id_fkey" FOREIGN KEY ("safe_id") REFERENCES "safes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "courier_advances" (
  "id" TEXT NOT NULL,
  "courier_id" TEXT NOT NULL,
  "safe_id" TEXT NOT NULL,
  "original_amount" DECIMAL(14,2) NOT NULL,
  "remaining_amount" DECIMAL(14,2) NOT NULL,
  "transaction_id" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "courier_advances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "courier_advances_courier_id_idx" ON "courier_advances"("courier_id");
CREATE INDEX "courier_advances_safe_id_idx" ON "courier_advances"("safe_id");
CREATE INDEX "courier_advances_created_at_idx" ON "courier_advances"("created_at");
CREATE INDEX "courier_advances_courier_id_remaining_amount_idx" ON "courier_advances"("courier_id", "remaining_amount");
ALTER TABLE "courier_advances"
  ADD CONSTRAINT "courier_advances_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "courier_advances_safe_id_fkey" FOREIGN KEY ("safe_id") REFERENCES "safes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "courier_advance_repayments" (
  "id" TEXT NOT NULL,
  "advance_id" TEXT NOT NULL,
  "safe_id" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "transaction_id" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "courier_advance_repayments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "courier_advance_repayments_advance_id_idx" ON "courier_advance_repayments"("advance_id");
CREATE INDEX "courier_advance_repayments_safe_id_idx" ON "courier_advance_repayments"("safe_id");
CREATE INDEX "courier_advance_repayments_created_at_idx" ON "courier_advance_repayments"("created_at");
ALTER TABLE "courier_advance_repayments"
  ADD CONSTRAINT "courier_advance_repayments_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "courier_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "courier_advance_repayments_safe_id_fkey" FOREIGN KEY ("safe_id") REFERENCES "safes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Repurpose the existing plain category (already seeded, unlinked) as the
-- fixed-role courier sheet-collection category. No existing transaction
-- history is affected — only this previously-null column changes.
UPDATE "categories"
SET "system_key" = 'COURIER_SHEET_COLLECTION'
WHERE "name" = 'تحصيل من مندوبي القاهرة والجيزة' AND "kind" = 'IN' AND "system_key" IS NULL;

INSERT INTO "categories" ("id", "name", "kind", "system_key", "active", "created_at")
SELECT gen_random_uuid(), 'سلفة مناديب', 'OUT', 'COURIER_ADVANCE', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "categories" WHERE "system_key" = 'COURIER_ADVANCE');

INSERT INTO "categories" ("id", "name", "kind", "system_key", "active", "created_at")
SELECT gen_random_uuid(), 'توريد سلفة مناديب', 'IN', 'COURIER_ADVANCE_REPAYMENT', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "categories" WHERE "system_key" = 'COURIER_ADVANCE_REPAYMENT');
