require("dotenv").config();
const { randomUUID } = require("crypto");
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * One-off data fix for Phase 24: 'manage_couriers' was added to
 * role-permissions.ts's ROLE_PERMISSIONS for MANAGER/ACCOUNTANT (and
 * OWNER, which is hardcoded-full and unaffected by this script). Since
 * Phase 19, MANAGER/ACCOUNTANT/EMPLOYEE permissions are fully row-driven
 * (ROLE_PERMISSIONS is only the suggested default for a NEW user of that
 * role) — an existing MANAGER/ACCOUNTANT user's role_permissions rows were
 * already backfilled once (scripts/backfill-role-permissions.js, Phase 19)
 * and won't pick up this new permission automatically. This grants it to
 * every existing MANAGER/ACCOUNTANT user as an explicit row, matching the
 * same pattern.
 *
 * Safe to re-run — ON CONFLICT DO NOTHING skips rows that already exist.
 */
const ROLES_TO_GRANT = ["MANAGER", "ACCOUNTANT"];

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    let totalInserted = 0;
    for (const role of ROLES_TO_GRANT) {
      const { rows: users } = await client.query('SELECT id, name, email FROM "users" WHERE role = $1', [role]);
      if (users.length === 0) {
        console.log(`No ${role} users found — skipping.`);
        continue;
      }
      console.log(`Granting manage_couriers to ${users.length} ${role} user(s)...`);
      for (const user of users) {
        const { rowCount } = await client.query(
          `INSERT INTO "role_permissions" (id, role, permission, user_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, permission) DO NOTHING`,
          [randomUUID(), role, "manage_couriers", user.id],
        );
        if (rowCount > 0) totalInserted++;
        console.log(`  - ${user.name} <${user.email}>`);
      }
    }
    console.log(`Done. Inserted ${totalInserted} new role_permissions row(s) (existing rows left untouched).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
