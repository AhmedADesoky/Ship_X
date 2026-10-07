require("dotenv").config();
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * Retires the MERCHANT_REDEPOSIT ("إعادة إدخال مبلغ مسحوب") system
 * category. The old "إعادة إدخال" redeposit flow it backed was fully
 * replaced (Phase 22) by the real settlement/withdrawal-application
 * ledger — confirmed via a repo-wide grep that no code anywhere still
 * references this systemKey, so it's safe to retire from active use.
 *
 * Soft-retires only (this app's established convention — never a hard
 * delete): strips system_key to NULL (so settings.service.ts's
 * resetSystem() reseed, which no longer lists this key in
 * SYSTEM_CATEGORIES, can never recreate a duplicate) and sets
 * active=false (so it stops appearing in every category picker). Any real
 * historical transaction already posted under this category keeps its
 * category_id FK fully intact — nothing is deleted.
 *
 * Safe to re-run — only touches a row that's still active and/or still
 * tagged, so a second run reports nothing to do.
 */
async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, name, active, system_key FROM categories WHERE system_key = 'MERCHANT_REDEPOSIT'`,
    );
    if (rows.length === 0) {
      console.log("No category tagged MERCHANT_REDEPOSIT found — nothing to do (already retired, or never seeded).");
      return;
    }

    const { count: txnCount } = (
      await client.query(`SELECT count(*)::int AS count FROM transactions WHERE category_id = $1`, [rows[0].id])
    ).rows[0];

    for (const row of rows) {
      await client.query(`UPDATE categories SET system_key = NULL, active = false WHERE id = $1`, [row.id]);
      console.log(
        `Retired "${row.name}" (${row.id}) — system_key cleared, active=false. ${txnCount} historical transaction(s) under it kept intact.`,
      );
    }
    console.log("Done.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
