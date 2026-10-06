require("dotenv").config();
const { randomUUID } = require("crypto");
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * One-off data fix (Phase 35): before the Phase 27/34b backstop was added
 * (TransactionsService.assertNotCourierLedgerCategory()), a تحصيل شيتات
 * مناديب القاهرة والجيزة transaction could be posted through the generic
 * POST /transactions endpoint, creating a plain `Transaction` row under
 * the COURIER_SHEET_COLLECTION category with NO corresponding
 * `CourierSheetCollection` row at all — not even an unassigned one. These
 * transactions are real and correctly categorized, but are permanently
 * invisible to the Couriers module (every courier-page/list query is
 * driven by CourierSheetCollection, never by Transaction directly).
 *
 * This finds every such orphaned Transaction and creates the missing
 * CourierSheetCollection row for it, with courierId left null (unassigned)
 * — exactly as if it had gone through "تحصيل تاريخي" at the time. The new
 * "غير محدد" view + assign-to-courier action (couriers.service.ts's
 * listUnassignedSheetCollections()/assignSheetCollection()) is then how an
 * admin reviews these and attaches each to the correct courier, if known.
 *
 * Safe to re-run — only touches transactions with no existing
 * CourierSheetCollection row (LEFT JOIN ... IS NULL), so nothing is ever
 * double-backfilled.
 */
async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: orphaned } = await client.query(`
      SELECT t.id, t.safe_id, t.amount, t.description, t.created_at
      FROM "transactions" t
      JOIN "categories" c ON c.id = t.category_id
      LEFT JOIN "courier_sheet_collections" csc ON csc.transaction_id = t.id
      WHERE c.system_key = 'COURIER_SHEET_COLLECTION'
        AND t.status = 'POSTED'
        AND csc.id IS NULL
    `);

    if (orphaned.length === 0) {
      console.log("No orphaned تحصيل شيتات transactions found — nothing to do.");
      return;
    }

    console.log(`Found ${orphaned.length} orphaned transaction(s) with no CourierSheetCollection row. Backfilling as unassigned...`);
    for (const t of orphaned) {
      await client.query(
        `INSERT INTO "courier_sheet_collections"
           (id, courier_id, safe_id, amount, note, transaction_id, date, created_at)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, now())`,
        [randomUUID(), t.safe_id, t.amount, t.description, t.id, t.created_at],
      );
      console.log(`  - transaction ${t.id} (${t.amount} on ${t.created_at.toISOString().slice(0, 10)}) -> backfilled as unassigned`);
    }
    console.log(`Done. ${orphaned.length} row(s) backfilled — review them under "غير محدد" on /couriers and assign each to the correct courier.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
