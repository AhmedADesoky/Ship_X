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
      path.join(__dirname, "..", "prisma", "migrations", "20260930000000_category_system_key", "migration.sql"),
      "utf8",
    );
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid(), '', $1, now(), now(), 1)
       ON CONFLICT DO NOTHING`,
      ["20260930000000_category_system_key"],
    );

    // 2. Data patch: tag the four fixed-role categories with their
    // systemKey, and split the merged رواسل/مسحوبات concept into two
    // separate rows — renaming the existing merchant/OUT row in place
    // (preserves its transaction history/FKs) rather than deleting it, and
    // inserting a brand-new مسحوبات row alongside it.
    const { rows } = await client.query('SELECT id, name, kind, party_type FROM "categories"');
    console.log("Current categories:", rows.map((r) => `${r.kind}:${r.name}`).join(", "));

    const agentRow = rows.find((r) => r.kind === "IN" && r.name.includes("وكلاء"));
    const merchantRow = rows.find((r) => r.kind === "OUT" && (r.name.includes("راسل") || r.name.includes("تاجر")));
    const redepositRow = rows.find((r) => r.kind === "IN" && r.name.includes("إعادة إدخال"));

    if (agentRow) {
      await client.query('UPDATE "categories" SET system_key = $1 WHERE id = $2', ["AGENT_COLLECTION", agentRow.id]);
      console.log(`Tagged ${agentRow.name} (${agentRow.kind}) -> systemKey=AGENT_COLLECTION`);
    } else {
      console.warn("No matching AGENT_COLLECTION category row found — skipped, needs manual fix.");
    }

    if (merchantRow) {
      await client.query('UPDATE "categories" SET name = $1, system_key = $2 WHERE id = $3', [
        "رواسل",
        "MERCHANT_SENDER",
        merchantRow.id,
      ]);
      console.log(`Renamed ${merchantRow.name} (${merchantRow.kind}) -> 'رواسل', systemKey=MERCHANT_SENDER`);
    } else {
      console.warn("No matching MERCHANT_SENDER category row found — skipped, needs manual fix.");
    }

    const existingDrawing = rows.find((r) => r.kind === "OUT" && r.name === "مسحوبات");
    if (!existingDrawing) {
      await client.query(
        `INSERT INTO "categories" (id, name, kind, active, party_type, system_key, created_at)
         VALUES (gen_random_uuid(), $1, 'OUT', true, $2, $3, now())`,
        ["مسحوبات", "MERCHANT", "MERCHANT_DRAWING"],
      );
      console.log("Created new category 'مسحوبات' (OUT) -> systemKey=MERCHANT_DRAWING");
    } else {
      console.log("'مسحوبات' category already exists — leaving as-is.");
    }

    if (redepositRow) {
      await client.query('UPDATE "categories" SET system_key = $1 WHERE id = $2', [
        "MERCHANT_REDEPOSIT",
        redepositRow.id,
      ]);
      console.log(`Tagged ${redepositRow.name} (${redepositRow.kind}) -> systemKey=MERCHANT_REDEPOSIT`);
    } else {
      console.warn("No matching MERCHANT_REDEPOSIT category row found — skipped, needs manual fix.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
