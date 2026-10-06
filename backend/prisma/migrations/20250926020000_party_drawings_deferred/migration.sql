-- Party gets its own drawings/deferred ledger, mirroring Client's
-- client_drawings / client_deferred / client_deferred_payments tables.

CREATE TABLE "party_drawings" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "safe_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transaction_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_drawings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_deferred" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "original_amount" DECIMAL(14,2) NOT NULL,
    "remaining_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_deferred_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_deferred_payments" (
    "id" TEXT NOT NULL,
    "deferred_id" TEXT NOT NULL,
    "safe_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transaction_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_deferred_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "party_drawings_party_id_idx" ON "party_drawings"("party_id");
CREATE INDEX "party_drawings_safe_id_idx" ON "party_drawings"("safe_id");
CREATE INDEX "party_drawings_created_at_idx" ON "party_drawings"("created_at");

CREATE INDEX "party_deferred_party_id_idx" ON "party_deferred"("party_id");
CREATE INDEX "party_deferred_created_at_idx" ON "party_deferred"("created_at");

CREATE INDEX "party_deferred_payments_deferred_id_idx" ON "party_deferred_payments"("deferred_id");
CREATE INDEX "party_deferred_payments_safe_id_idx" ON "party_deferred_payments"("safe_id");
CREATE INDEX "party_deferred_payments_created_at_idx" ON "party_deferred_payments"("created_at");

ALTER TABLE "party_drawings" ADD CONSTRAINT "party_drawings_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_drawings" ADD CONSTRAINT "party_drawings_safe_id_fkey" FOREIGN KEY ("safe_id") REFERENCES "safes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "party_deferred" ADD CONSTRAINT "party_deferred_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "party_deferred_payments" ADD CONSTRAINT "party_deferred_payments_deferred_id_fkey" FOREIGN KEY ("deferred_id") REFERENCES "party_deferred"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_deferred_payments" ADD CONSTRAINT "party_deferred_payments_safe_id_fkey" FOREIGN KEY ("safe_id") REFERENCES "safes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
