-- Data migration (Client -> Party) is performed by a companion Node script
-- (see backend/scripts/merge-clients-into-parties.js) before this DDL runs,
-- because it requires row-by-row matching/merging logic that plain SQL
-- would make far less readable. This file only contains the final DDL.

ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_client_id_fkey";
DROP INDEX IF EXISTS "transactions_client_id_idx";
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "client_id";

DROP TABLE IF EXISTS "client_deferred_payments";
DROP TABLE IF EXISTS "client_deferred";
DROP TABLE IF EXISTS "client_drawings";
DROP TABLE IF EXISTS "clients";

DO $$ BEGIN
  CREATE TYPE "PendingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "pending_actions" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "payload" JSONB NOT NULL,
  "status" "PendingStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pending_actions_status_idx" ON "pending_actions"("status");
CREATE INDEX IF NOT EXISTS "pending_actions_actor_id_idx" ON "pending_actions"("actor_id");

ALTER TABLE "pending_actions"
  ADD CONSTRAINT "pending_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_actions"
  ADD CONSTRAINT "pending_actions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
