require("dotenv").config();
const { randomUUID } = require("crypto");
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * One-off data fix for Phase 19: effectivePermissions() (role-permissions.ts)
 * used to union a hardcoded ROLE_PERMISSIONS[role] list into every user's
 * effective permissions, for every role. That floor is now removed for
 * MANAGER/ACCOUNTANT/EMPLOYEE (OWNER stays hardcoded-full, unaffected by
 * this script) — their effective permissions become exactly their explicit
 * role_permissions rows, nothing implicit. Before that code change ships,
 * every such user needs their CURRENT role-default permissions backfilled
 * as real rows, or they'd silently lose access to everything the role used
 * to grant for free. Mirrors role-permissions.ts's ROLE_PERMISSIONS map —
 * keep these two in sync if that map ever changes.
 *
 * Safe to re-run — ON CONFLICT DO NOTHING skips rows that already exist
 * (the unique constraint is (user_id, permission)).
 */
const ROLE_PERMISSIONS = {
  MANAGER: [
    "view_reports",
    "edit_transactions",
    "manage_users",
    "view_audit_log",
    "manage_safes",
    "manage_categories",
    "manage_parties",
    "manage_transactions",
    "manage_reconciliations",
    "manage_settings",
    "manage_import",
    "manage_pending_actions",
  ],
  ACCOUNTANT: [
    "view_reports",
    "edit_transactions",
    "manage_safes",
    "manage_categories",
    "manage_parties",
    "manage_transactions",
    "manage_reconciliations",
    "manage_import",
  ],
  // EMPLOYEE's default is already [] — nothing to backfill for that role.
};

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    let totalInserted = 0;
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const { rows: users } = await client.query('SELECT id, name, email FROM "users" WHERE role = $1', [role]);
      if (users.length === 0) {
        console.log(`No ${role} users found — skipping.`);
        continue;
      }
      console.log(`Backfilling ${permissions.length} permission(s) for ${users.length} ${role} user(s)...`);
      for (const user of users) {
        for (const permission of permissions) {
          const { rowCount } = await client.query(
            `INSERT INTO "role_permissions" (id, role, permission, user_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, permission) DO NOTHING`,
            [randomUUID(), role, permission, user.id],
          );
          if (rowCount > 0) totalInserted++;
        }
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
