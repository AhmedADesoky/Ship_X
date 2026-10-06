require("dotenv").config();
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * One-off data fix for Phase 15 (split مسحوبات from رواسل): before this
 * change, ANY OUT transaction against a MERCHANT party — whether under
 * رواسل or مسحوبات — created a party_drawings row. That's no longer
 * correct: only transactions under the MERCHANT_DRAWING systemKey category
 * should have one. This finds and deletes any party_drawings row whose
 * linked transaction's category is NOT MERCHANT_DRAWING (or has no
 * category at all, which shouldn't happen via createDrawing() but is
 * checked defensively), so existing test/dev data matches the corrected
 * model. Safe to re-run — reports zero rows on a second pass.
 */
async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT pd.id, pd.party_id, pd.amount, pd.date, p.name AS party_name, c.name AS category_name, c.system_key
      FROM party_drawings pd
      JOIN transactions t ON t.id = pd.transaction_id
      JOIN parties p ON p.id = pd.party_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE c.system_key IS DISTINCT FROM 'MERCHANT_DRAWING'
      ORDER BY pd.date DESC
    `);

    if (rows.length === 0) {
      console.log("No stray رواسل-sourced party_drawings rows found — nothing to clean up.");
      return;
    }

    console.log(`Found ${rows.length} party_drawings row(s) sourced from a non-مسحوبات category:`);
    for (const r of rows) {
      console.log(
        `  - ${r.party_name}: ${r.amount} on ${r.date.toISOString().slice(0, 10)} (category: ${r.category_name ?? "none"})`,
      );
    }

    const ids = rows.map((r) => r.id);
    await client.query('DELETE FROM "party_drawings" WHERE id = ANY($1)', [ids]);
    console.log(`Deleted ${ids.length} row(s). The underlying transactions themselves are untouched.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
