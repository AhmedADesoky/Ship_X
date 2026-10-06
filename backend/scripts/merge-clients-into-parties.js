// One-off data migration: copies Client rows (and their drawings/deferred
// ledgers) into Party, remaps Transaction.client_id -> party_id, then hands
// off to the DDL in prisma/migrations/20260927010000_.../migration.sql to
// drop the old tables. Run once, manually, before that migration's DDL.
require("dotenv").config();
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");

    const { rows: clients } = await client.query('SELECT * FROM "clients"');
    const clientToParty = new Map();

    for (const c of clients) {
      const partyType = c.party_type || "MERCHANT";
      let partyId;
      const existing = await client.query('SELECT id FROM "parties" WHERE name = $1', [c.name]);
      if (existing.rows.length > 0) {
        partyId = existing.rows[0].id;
      } else {
        const inserted = await client.query(
          `INSERT INTO "parties" (id, name, party_type, phone, notes, active, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING id`,
          [c.name, partyType, c.phone, c.notes, c.active, c.created_at],
        );
        partyId = inserted.rows[0].id;
      }
      clientToParty.set(c.id, partyId);
    }

    const { rows: drawings } = await client.query('SELECT * FROM "client_drawings"');
    for (const d of drawings) {
      const partyId = clientToParty.get(d.client_id);
      if (!partyId) continue;
      await client.query(
        `INSERT INTO "party_drawings" (id, party_id, safe_id, amount, transaction_id, date, note, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [partyId, d.safe_id, d.amount, d.transaction_id, d.date, d.note, d.created_at],
      );
    }

    const { rows: deferreds } = await client.query('SELECT * FROM "client_deferred"');
    const deferredToParty = new Map();
    for (const def of deferreds) {
      const partyId = clientToParty.get(def.client_id);
      if (!partyId) continue;
      const inserted = await client.query(
        `INSERT INTO "party_deferred" (id, party_id, original_amount, remaining_amount, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
        [partyId, def.original_amount, def.remaining_amount, def.created_at],
      );
      deferredToParty.set(def.id, inserted.rows[0].id);
    }

    const { rows: payments } = await client.query('SELECT * FROM "client_deferred_payments"');
    for (const p of payments) {
      const newDeferredId = deferredToParty.get(p.deferred_id);
      if (!newDeferredId) continue;
      await client.query(
        `INSERT INTO "party_deferred_payments" (id, deferred_id, safe_id, amount, transaction_id, date, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [newDeferredId, p.safe_id, p.amount, p.transaction_id, p.date, p.created_at],
      );
    }

    // Remap transactions that pointed at a client (and had no party) onto
    // the merged party instead, so the transaction ledger stays intact.
    const { rows: txs } = await client.query(
      'SELECT id, client_id FROM "transactions" WHERE client_id IS NOT NULL AND party_id IS NULL',
    );
    for (const tx of txs) {
      const partyId = clientToParty.get(tx.client_id);
      if (!partyId) continue;
      await client.query('UPDATE "transactions" SET party_id = $1 WHERE id = $2', [partyId, tx.id]);
    }

    await client.query("COMMIT");
    console.log(`Migrated ${clients.length} clients, ${drawings.length} drawings, ${deferreds.length} deferred, ${payments.length} payments, remapped ${txs.length} transactions.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
