-- User: account lockout fields
ALTER TABLE "users" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);

-- RefreshToken: real rotation + revocation backing table
CREATE TABLE "refresh_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "replaced_by_token_id" TEXT,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AuditLog: status code on the new failure-path logging
ALTER TABLE "audit_logs" ADD COLUMN "status_code" INTEGER;
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- Category: composite index matching actual query shape
CREATE INDEX "categories_party_type_kind_idx" ON "categories"("party_type", "kind");

-- PartyDeferred: composite index for the FIFO open-balance query
CREATE INDEX "party_deferred_party_id_remaining_amount_idx" ON "party_deferred"("party_id", "remaining_amount");

-- Transaction: composite indexes matching hot query shapes
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");
CREATE INDEX "transactions_party_id_status_idx" ON "transactions"("party_id", "status");
CREATE INDEX "transactions_safe_id_status_idx" ON "transactions"("safe_id", "status");
CREATE INDEX "transactions_category_id_status_idx" ON "transactions"("category_id", "status");
CREATE INDEX "transactions_related_transaction_id_idx" ON "transactions"("related_transaction_id");
