require("dotenv").config();
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "categories" (id, name, kind, active, created_at)
       VALUES (gen_random_uuid(), $1, 'IN', true, now())
       ON CONFLICT (name, kind) DO NOTHING`,
      ["إعادة إدخال مبلغ مسحوب"],
    );
    console.log("done");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
