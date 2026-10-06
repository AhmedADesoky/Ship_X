-- Parallel "requires a courier" option on Category, mirroring partyType —
-- mutually exclusive with it (enforced in CategoriesService, not at the DB
-- level, same convention as the rest of this schema's cross-field rules).

ALTER TABLE "categories" ADD COLUMN "requires_courier" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "transactions" ADD COLUMN "courier_id" TEXT;
CREATE INDEX "transactions_courier_id_idx" ON "transactions"("courier_id");
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
