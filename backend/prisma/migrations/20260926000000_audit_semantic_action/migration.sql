-- Adds a human-readable semantic action layer to audit_logs (Phase 6c).
-- The existing `action`/`entity_type` columns keep recording the raw HTTP
-- method / route path exactly as before (kept for power-user/debugging
-- visibility) — these two new nullable columns are an additional label
-- computed by backend/src/common/audit-descriptions.ts at write time.
--
-- Applied directly against the live database via a raw pg client (see
-- CRITICAL environment notes — `prisma migrate`/`db push` hang indefinitely
-- here); this file mirrors what was run so Prisma's migration history stays
-- accurate.

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "semantic_action" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "entity_label" TEXT;
