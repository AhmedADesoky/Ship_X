-- Password reset + optional TOTP MFA support.
ALTER TABLE "users" ADD COLUMN "reset_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "reset_token_expires_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "mfa_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "mfa_temp_secret" TEXT;
