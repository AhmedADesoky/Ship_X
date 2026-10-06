-- Party.partyType converted from a fixed enum (AGENT/MERCHANT) to a
-- free-form string, same pattern as Safe.type, so users can add their own
-- party types from the UI. "AGENT"/"MERCHANT" remain the two canonical
-- values with special meaning to PartiesService.assertUsable().
--
-- Client also gains an optional, purely informational partyType field
-- (shared type list with Party) so the client-creation UI can offer the
-- same "+ add new type" picker as the parties page.
--
-- Applied directly against the live database via a raw pg client (see
-- chat history — `prisma migrate`/`db push` hang indefinitely in this
-- environment for unrelated reasons); this file mirrors what was run so
-- Prisma's migration history stays accurate.

ALTER TABLE "parties" ALTER COLUMN "party_type" TYPE TEXT USING "party_type"::text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "party_type" TEXT;
DROP TYPE IF EXISTS "PartyType";
