-- Full initial schema (Phases 1-3 combined) applied directly against a
-- fresh database via a raw pg client, since `prisma migrate`/`db push`
-- hung indefinitely in this environment (unrelated to DB connectivity,
-- which was verified working via a plain `pg` client). This file's content
-- is generated to exactly match prisma/schema.prisma so that Prisma's own
-- migration history / `prisma migrate resolve --applied` can adopt it later.

CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE');
CREATE TYPE "TransactionKind" AS ENUM ('IN', 'OUT', 'TRANSFER');
CREATE TYPE "CategoryKind" AS ENUM ('IN', 'OUT');
CREATE TYPE "PartyType" AS ENUM ('AGENT', 'MERCHANT');

CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT,
  "name" TEXT NOT NULL,
  "title" TEXT,
  "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "role_permissions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "role" "Role" NOT NULL,
  "permission" TEXT NOT NULL,
  "user_id" TEXT REFERENCES "users"("id"),
  UNIQUE ("user_id", "permission")
);
CREATE INDEX "role_permissions_role_idx" ON "role_permissions"("role");

CREATE TABLE "safes" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'CASH',
  "is_main" BOOLEAN NOT NULL DEFAULT false,
  "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "categories" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "kind" "CategoryKind" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  UNIQUE ("name", "kind")
);

CREATE TABLE "parties" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL UNIQUE,
  "party_type" "PartyType" NOT NULL,
  "province" TEXT,
  "phone" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "parties_party_type_idx" ON "parties"("party_type");

CREATE TABLE "reconciliations" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "safe_id" TEXT NOT NULL REFERENCES "safes"("id"),
  "recon_date" TIMESTAMP(3) NOT NULL,
  "expected_balance" DECIMAL(14,2) NOT NULL,
  "actual_balance" DECIMAL(14,2) NOT NULL,
  "difference" DECIMAL(14,2) NOT NULL,
  "note" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "reconciliations_safe_id_idx" ON "reconciliations"("safe_id");

CREATE TABLE "app_settings" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "import_batches" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "filename" TEXT NOT NULL,
  "file_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "rows_read" INTEGER NOT NULL DEFAULT 0,
  "rows_imported" INTEGER NOT NULL DEFAULT 0,
  "rows_skipped" INTEGER NOT NULL DEFAULT 0,
  "rows_review" INTEGER NOT NULL DEFAULT 0,
  "income_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "expense_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMP(3),
  UNIQUE ("file_hash")
);

CREATE TABLE "clients" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "notes" TEXT,
  "created_by" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "clients_created_at_idx" ON "clients"("created_at");

CREATE TABLE "transactions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "safe_id" TEXT NOT NULL REFERENCES "safes"("id"),
  "kind" "TransactionKind" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "category_id" TEXT REFERENCES "categories"("id"),
  "party_id" TEXT REFERENCES "parties"("id"),
  "reference_no" TEXT,
  "notes" TEXT,
  "client_id" TEXT REFERENCES "clients"("id"),
  "description" TEXT,
  "created_by" TEXT REFERENCES "users"("id"),
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "related_transaction_id" TEXT REFERENCES "transactions"("id"),
  "import_batch_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "transactions_safe_id_idx" ON "transactions"("safe_id");
CREATE INDEX "transactions_client_id_idx" ON "transactions"("client_id");
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");
CREATE INDEX "transactions_party_id_idx" ON "transactions"("party_id");
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");

CREATE TABLE "client_drawings" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "client_id" TEXT NOT NULL REFERENCES "clients"("id"),
  "safe_id" TEXT NOT NULL REFERENCES "safes"("id"),
  "amount" DECIMAL(14,2) NOT NULL,
  "transaction_id" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "client_drawings_client_id_idx" ON "client_drawings"("client_id");
CREATE INDEX "client_drawings_safe_id_idx" ON "client_drawings"("safe_id");
CREATE INDEX "client_drawings_created_at_idx" ON "client_drawings"("created_at");

CREATE TABLE "client_deferred" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "client_id" TEXT NOT NULL REFERENCES "clients"("id"),
  "original_amount" DECIMAL(14,2) NOT NULL,
  "remaining_amount" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "client_deferred_client_id_idx" ON "client_deferred"("client_id");
CREATE INDEX "client_deferred_created_at_idx" ON "client_deferred"("created_at");

CREATE TABLE "client_deferred_payments" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "deferred_id" TEXT NOT NULL REFERENCES "client_deferred"("id"),
  "safe_id" TEXT NOT NULL REFERENCES "safes"("id"),
  "amount" DECIMAL(14,2) NOT NULL,
  "transaction_id" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "client_deferred_payments_deferred_id_idx" ON "client_deferred_payments"("deferred_id");
CREATE INDEX "client_deferred_payments_safe_id_idx" ON "client_deferred_payments"("safe_id");
CREATE INDEX "client_deferred_payments_created_at_idx" ON "client_deferred_payments"("created_at");

CREATE TABLE "audit_logs" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "actor_id" TEXT REFERENCES "users"("id"),
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
