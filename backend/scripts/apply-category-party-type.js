require("dotenv").config();
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { assertNotProduction } = require("./_guard");

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // 1. Column migration.
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "prisma", "migrations", "20260928000000_category_party_type", "migration.sql"),
      "utf8",
    );
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid(), '', $1, now(), now(), 1)
       ON CONFLICT DO NOTHING`,
      ["20260928000000_category_party_type"],
    );

    // 2. Data patch: flag whichever category rows are actually being used
    // for agent/merchant linkage on THIS live database today, whatever
    // their current display name is (confirmed via API query — the names
    // have drifted from prisma/seed.ts's defaults through in-app renames).
    const { rows } = await client.query('SELECT id, name, kind FROM "categories"');
    console.log("Current categories:", rows.map((r) => `${r.kind}:${r.name}`).join(", "));

    const agentRow = rows.find((r) => r.kind === "IN" && r.name.includes("وكلاء"));
    const merchantDrawingRow = rows.find((r) => r.kind === "OUT" && (r.name.includes("راسل") || r.name.includes("تاجر")));
    const redepositRow = rows.find((r) => r.kind === "IN" && r.name.includes("إعادة إدخال"));

    for (const [row, type] of [
      [agentRow, "AGENT"],
      [merchantDrawingRow, "MERCHANT"],
      [redepositRow, "MERCHANT"],
    ]) {
      if (!row) {
        console.warn(`No matching category row found for ${type} — skipped, needs manual fix.`);
        continue;
      }
      await client.query('UPDATE "categories" SET party_type = $1 WHERE id = $2', [type, row.id]);
      console.log(`Set ${row.name} (${row.kind}) -> partyType=${type}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
