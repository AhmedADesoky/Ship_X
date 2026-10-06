require("dotenv").config();
const { randomUUID } = require("crypto");
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * Phase 36 one-off data fix. Root cause (confirmed via a live read-only
 * investigation): no category on this DB ever carried
 * system_key='COURIER_SHEET_COLLECTION' — Phase 24's original migration
 * matched on the name 'تحصيل من مندوبي القاهرة والجيزة', but the category
 * actually seeded here is named 'تحصيل من مناديب القاهرة والجيزة' (one
 * word different), so the UPDATE silently matched zero rows. Meanwhile the
 * user has actually been using a separate, untagged plain category named
 * 'تحصيل شيتات مناديب القاهرة والجيزة' (requires_courier=true) — it shows
 * a courier picker and looks correct, but since isCourierSheetCollection
 * (frontend) and assertNotCourierLedgerCategory (backend) both key only on
 * systemKey, every transaction under it is a plain Transaction with
 * courierId set directly, never a real CourierSheetCollection ledger row.
 *
 * This script (confirmed with the user):
 *   1. Tags the category the user has actually been using as the one true
 *      system category (system_key='COURIER_SHEET_COLLECTION',
 *      requires_courier=false — the two are mutually exclusive per the
 *      Phase 28 guard).
 *   2. Deactivates the older-named stray category (not deleted — FK
 *      history on its transactions is preserved).
 *   3. Backfills a real CourierSheetCollection row for every POSTED
 *      transaction under either category that doesn't already have one,
 *      preserving each transaction's OWN courier_id (unlike Phase 35's
 *      backfill-orphaned-sheet-collections.js, which only ever handled
 *      fully-unassigned orphans with no courier_id at all).
 *
 * Safe to re-run — every step's WHERE clause only touches rows not
 * already in their target state.
 */

const CANONICAL_NAME = "تحصيل شيتات مناديب القاهرة والجيزة";
const STRAY_NAME = "تحصيل من مناديب القاهرة والجيزة";

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // 1. Tag the canonical category.
    const { rows: canonicalRows } = await client.query(
      `SELECT id, name, system_key, requires_courier FROM categories WHERE name = $1 AND kind = 'IN' AND active = true`,
      [CANONICAL_NAME],
    );
    if (canonicalRows.length === 0) {
      console.log(`No active category named "${CANONICAL_NAME}" found — nothing to tag.`);
    } else if (canonicalRows[0].system_key === "COURIER_SHEET_COLLECTION") {
      console.log(`"${CANONICAL_NAME}" (${canonicalRows[0].id}) is already tagged COURIER_SHEET_COLLECTION — skipping.`);
    } else {
      const canonical = canonicalRows[0];
      await client.query(
        `UPDATE categories SET system_key = 'COURIER_SHEET_COLLECTION', requires_courier = false WHERE id = $1`,
        [canonical.id],
      );
      console.log(`Tagged "${CANONICAL_NAME}" (${canonical.id}) as system_key=COURIER_SHEET_COLLECTION, requires_courier=false.`);
    }

    // Re-read the canonical id (covers the "already tagged" branch too).
    const { rows: confirmed } = await client.query(
      `SELECT id FROM categories WHERE system_key = 'COURIER_SHEET_COLLECTION'`,
    );
    if (confirmed.length === 0) {
      console.log("No category carries system_key=COURIER_SHEET_COLLECTION after step 1 — aborting backfill.");
      return;
    }
    const canonicalId = confirmed[0].id;

    // 2. Deactivate the older-named stray, if still active.
    const { rows: strayRows } = await client.query(
      `SELECT id, active FROM categories WHERE name = $1 AND kind = 'IN' AND id != $2`,
      [STRAY_NAME, canonicalId],
    );
    let strayId = null;
    if (strayRows.length > 0) {
      strayId = strayRows[0].id;
      if (strayRows[0].active) {
        await client.query(`UPDATE categories SET active = false WHERE id = $1`, [strayId]);
        console.log(`Deactivated stray category "${STRAY_NAME}" (${strayId}).`);
      } else {
        console.log(`Stray category "${STRAY_NAME}" (${strayId}) already inactive — skipping deactivation.`);
      }
    } else {
      console.log(`No stray category named "${STRAY_NAME}" found.`);
    }

    // 3. Backfill CourierSheetCollection rows for every affected, POSTED,
    // not-yet-linked transaction under either category.
    const categoryIds = [canonicalId, ...(strayId ? [strayId] : [])];
    const { rows: orphaned } = await client.query(
      `
      SELECT t.id, t.safe_id, t.amount, t.description, t.courier_id, t.created_by, t.created_at
      FROM "transactions" t
      LEFT JOIN "courier_sheet_collections" csc ON csc.transaction_id = t.id
      WHERE t.category_id = ANY($1::text[])
        AND t.status = 'POSTED'
        AND csc.id IS NULL
      `,
      [categoryIds],
    );

    if (orphaned.length === 0) {
      console.log("No orphaned transactions found under either category — nothing to backfill.");
      return;
    }

    console.log(`Found ${orphaned.length} transaction(s) needing a CourierSheetCollection row. Backfilling...`);
    for (const t of orphaned) {
      await client.query(
        `INSERT INTO "courier_sheet_collections"
           (id, courier_id, safe_id, amount, note, transaction_id, date, created_by, source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'INCOME_PAGE', now())`,
        [randomUUID(), t.courier_id, t.safe_id, t.amount, t.description, t.id, t.created_at, t.created_by],
      );
      console.log(
        `  - transaction ${t.id} (${t.amount} on ${t.created_at.toISOString().slice(0, 10)}, courier=${t.courier_id ?? "unassigned"}) -> backfilled`,
      );
    }
    console.log(`Done. ${orphaned.length} row(s) backfilled.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
