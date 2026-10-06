require("dotenv").config();
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * One-off data migration for Phase 22 (withdrawal-application settlement
 * ledger): the retired "إعادة إدخال" flow left party_drawings.redeposit_
 * transaction_id set on any drawing a user redeposited through that old
 * per-row button. The new model has no equivalent "redeposit" concept —
 * outstanding/applied is derived entirely from withdrawal_applications —
 * so every such row needs a one-time decision before that column is
 * eventually dropped (in a SEPARATE later migration, not this script):
 *
 *   - EXACT match (drawing.amount === linked redeposit transaction's
 *     amount): safe to treat as "fully handled under the old flow". There
 *     is no real settlement to attach a withdrawal_applications row to
 *     (the old flow never had a settlement concept), so fabricating one
 *     would invent history that didn't happen — instead this marks the
 *     drawing `cancelled = true` with an explanatory note, which correctly
 *     drops it off the new outstanding list without a fake application.
 *
 *   - MISMATCH (amounts differ — the old redeposit dialog allowed editing
 *     the amount, so this is genuinely ambiguous: partial redeposit? an
 *     unrelated adjustment? data entry drift?): this script takes NO
 *     automatic action on these rows. It only logs them. They stay OPEN in
 *     the new system until a human decides what actually happened.
 *
 * Safe to re-run: already-cancelled rows are excluded from the working set
 * on a second pass.
 */
async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT pd.id, pd.amount AS drawing_amount, pd.date, p.name AS party_name,
             t.amount AS redeposit_amount, t.id AS redeposit_transaction_id
      FROM party_drawings pd
      JOIN parties p ON p.id = pd.party_id
      LEFT JOIN transactions t ON t.id = pd.redeposit_transaction_id
      WHERE pd.redeposit_transaction_id IS NOT NULL
        AND pd.cancelled = false
      ORDER BY pd.date ASC
    `);

    if (rows.length === 0) {
      console.log("No un-reviewed legacy-redeposited drawings found — nothing to do.");
      return;
    }

    console.log(`Found ${rows.length} drawing(s) with a legacy redeposit_transaction_id:`);

    const exactMatches = [];
    const mismatches = [];
    for (const r of rows) {
      const drawingAmount = Number(r.drawing_amount);
      const redepositAmount = r.redeposit_amount === null ? null : Number(r.redeposit_amount);
      if (redepositAmount !== null && Math.abs(drawingAmount - redepositAmount) < 0.005) {
        exactMatches.push(r);
      } else {
        mismatches.push({ ...r, redepositAmount });
      }
    }

    if (exactMatches.length) {
      console.log(`\n${exactMatches.length} exact match(es) — marking cancelled (historical, fully handled under the old flow):`);
      for (const r of exactMatches) {
        console.log(`  - ${r.party_name}: ${r.drawing_amount} on ${r.date.toISOString().slice(0, 10)}`);
      }
      const ids = exactMatches.map((r) => r.id);
      await client.query(
        `UPDATE party_drawings
         SET cancelled = true, cancelled_at = now(),
             cancelled_note = 'تمت معالجته عبر إعادة الإدخال القديمة (ترحيل تاريخي)'
         WHERE id = ANY($1)`,
        [ids],
      );
      console.log(`  Marked ${ids.length} row(s) cancelled.`);
    }

    if (mismatches.length) {
      console.log(
        `\n${mismatches.length} MISMATCH(ES) — amount differs from the linked redeposit transaction, or the transaction no longer exists. NO automatic action taken; these remain OPEN. Review manually:`,
      );
      for (const r of mismatches) {
        console.log(
          `  - ${r.party_name}: drawing=${r.drawing_amount} on ${r.date.toISOString().slice(0, 10)}, ` +
            `redeposit_tx=${r.redeposit_transaction_id ?? "MISSING"} amount=${r.redepositAmount ?? "N/A"}`,
        );
      }
      console.log(
        "\nBring this list to the user before running the follow-up migration that drops the redeposit_transaction_id column.",
      );
    } else {
      console.log("\nNo mismatches — every legacy-redeposited row was an exact match.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
