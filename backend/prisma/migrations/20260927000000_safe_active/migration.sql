-- Soft-delete support for Safe: deleting a safe deactivates it (never a
-- hard delete, since it has FK history in transactions/drawings/
-- reconciliations that must survive for audit/reporting).
ALTER TABLE "safes" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
