require("dotenv").config();
const { randomUUID } = require("crypto");
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * One-off data fix for Phase 32: 'view_dashboard'/'view_safes' were added
 * to role-permissions.ts's ROLE_PERMISSIONS for MANAGER (and OWNER, which
 * is hardcoded-full and unaffected by this script) — confirmed via
 * AskUserQuestion: ACCOUNTANT and EMPLOYEE must have these explicitly
 * granted, they get NO automatic access, unlike manage_couriers's earlier
 * backfill which also covered ACCOUNTANT.
 *
 * Since Phase 19, MANAGER/ACCOUNTANT/EMPLOYEE permissions are fully
 * row-driven (ROLE_PERMISSIONS is only the suggested default for a NEW
 * user of that role) — an existing MANAGER user's role_permissions rows
 * won't pick up this new permission automatically. This grants both to
 * every existing MANAGER user as explicit rows, matching the same pattern
 * as scripts/backfill-manage-couriers-permission.js.
 *
 * Safe to re-run — ON CONFLICT DO NOTHING skips rows that already exist.
 */
const ROLE_TO_GRANT = "MANAGER";
const PERMISSIONS_TO_GRANT = ["view_dashboard", "view_safes"];

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: users } = await client.query('SELECT id, name, email FROM "users" WHERE role = $1', [
      ROLE_TO_GRANT,
    ]);
    if (users.length === 0) {
      console.log(`No ${ROLE_TO_GRANT} users found — nothing to do.`);
      return;
    }
    console.log(`Granting ${PERMISSIONS_TO_GRANT.join(", ")} to ${users.length} ${ROLE_TO_GRANT} user(s)...`);
    let totalInserted = 0;
    for (const user of users) {
      for (const permission of PERMISSIONS_TO_GRANT) {
        const { rowCount } = await client.query(
          `INSERT INTO "role_permissions" (id, role, permission, user_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, permission) DO NOTHING`,
          [randomUUID(), ROLE_TO_GRANT, permission, user.id],
        );
        if (rowCount > 0) totalInserted++;
      }
      console.log(`  - ${user.name} <${user.email}>`);
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
