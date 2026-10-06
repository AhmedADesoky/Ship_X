require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const migrationName = process.argv[2];
  if (!migrationName) throw new Error("Usage: node apply-migration.js <migration_dir_name>");
  const sqlPath = path.join(__dirname, "..", "prisma", "migrations", migrationName, "migration.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid(), '', $1, now(), now(), 1)`,
      [migrationName],
    );
    console.log(`Applied and recorded migration ${migrationName}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
