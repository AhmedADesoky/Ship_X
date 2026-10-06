-- Phase 22: withdrawal-application settlement ledger
-- Additive only (no drops) — see backend/scripts/backfill-redeposit-applications.js
-- for the separate, later migration that drops party_drawings.redeposit_transaction_id.

ALTER TABLE "party_drawings"
  ADD COLUMN "cancelled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_by" TEXT,
  ADD COLUMN "cancelled_note" TEXT;

CREATE TABLE "party_settlements" (
  "id" TEXT NOT NULL,
  "party_id" TEXT NOT NULL,
  "safe_id" TEXT NOT NULL,
  "gross_amount" DECIMAL(14,2) NOT NULL,
  "applied_amount" DECIMAL(14,2) NOT NULL,
  "net_amount" DECIMAL(14,2) NOT NULL,
  "transaction_id" TEXT,
  "note" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "client_request_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "party_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "party_settlements_client_request_id_key" ON "party_settlements"("client_request_id");
CREATE INDEX "party_settlements_party_id_idx" ON "party_settlements"("party_id");
CREATE INDEX "party_settlements_safe_id_idx" ON "party_settlements"("safe_id");
CREATE INDEX "party_settlements_created_at_idx" ON "party_settlements"("created_at");
CREATE INDEX "party_settlements_transaction_id_idx" ON "party_settlements"("transaction_id");

ALTER TABLE "party_settlements"
  ADD CONSTRAINT "party_settlements_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "party_settlements_safe_id_fkey" FOREIGN KEY ("safe_id") REFERENCES "safes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "party_settlements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "withdrawal_applications" (
  "id" TEXT NOT NULL,
  "drawing_id" TEXT NOT NULL,
  "settlement_id" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "withdrawal_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "withdrawal_applications_drawing_id_idx" ON "withdrawal_applications"("drawing_id");
CREATE INDEX "withdrawal_applications_settlement_id_idx" ON "withdrawal_applications"("settlement_id");

ALTER TABLE "withdrawal_applications"
  ADD CONSTRAINT "withdrawal_applications_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "party_drawings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "withdrawal_applications_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "party_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
