require("dotenv").config();
const { Client } = require("pg");
const { assertNotProduction } = require("./_guard");

/**
 * One-off data fix: renames the real COURIER_SHEET_COLLECTION system
 * category from its original seed name ('تحصيل من مندوبي القاهرة والجيزة')
 * to 'تحصيل شيتات مناديب القاهرة والجيزة' — matching system-categories.ts
 * (updated alongside this script) and the terminology used everywhere else
 * in the app (nav.couriers = "مناديب القاهرة والجيزة").
 *
 * This also resolves a recurring source of user confusion: a stray, plain
 * (non-system) category with exactly this target name was created by hand
 * at some point (via the "مندوب" dropdown option added in an earlier
 * phase), and is NOT wired to the Couriers module at all — selecting it
 * in Add Income never creates a real CourierSheetCollection row. Renaming
 * the real system category to this name would collide with that stray
 * category's unique (name, kind) constraint, so this script resolves the
 * stray row FIRST:
 *   - If the stray category has ZERO transactions under it, it's safely
 *     soft-deactivated (same convention as CategoriesService.remove()) and
 *     the rename proceeds automatically.
 *   - If the stray category has ANY transactions, this script does NOT
 *     touch it or attempt a merge — merging real transaction history into
 *     a different category is a data decision only a human should make.
 *     It logs exactly what it found and stops, telling you what to review
 *     manually before re-running.
 *
 * Safe to re-run — a no-op once the rename has already happened.
 */
const OLD_NAME = 'تحصيل من مندوبي القاهرة والجيزة';
const NEW_NAME = 'تحصيل شيتات مناديب القاهرة والجيزة';

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: systemRows } = await client.query(
      `SELECT id, name FROM "categories" WHERE system_key = 'COURIER_SHEET_COLLECTION'`,
    );
    if (systemRows.length === 0) {
      console.warn("No category with systemKey='COURIER_SHEET_COLLECTION' found — nothing to rename.");
      return;
    }
    const systemRow = systemRows[0];
    if (systemRow.name === NEW_NAME) {
      console.log("Already renamed — nothing to do.");
      return;
    }
    if (systemRow.name !== OLD_NAME) {
      console.warn(
        `System category's current name ("${systemRow.name}") doesn't match the expected old name ("${OLD_NAME}") — renaming anyway, but double-check this is the right row.`,
      );
    }

    const { rows: strayRows } = await client.query(
      `SELECT id, active, system_key FROM "categories" WHERE name = $1 AND kind = 'IN' AND id != $2`,
      [NEW_NAME, systemRow.id],
    );
    const stray = strayRows[0];

    if (stray) {
      if (stray.system_key) {
        console.error(
          `A DIFFERENT system category already holds the name "${NEW_NAME}" (id=${stray.id}, systemKey=${stray.system_key}) — this needs manual review, stopping without renaming anything.`,
        );
        return;
      }
      const { rows: txCountRows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM "transactions" WHERE category_id = $1`,
        [stray.id],
      );
      const txCount = txCountRows[0].count;
      if (txCount > 0) {
        console.error(
          `Found a stray (non-system) category "${NEW_NAME}" (id=${stray.id}) with ${txCount} transaction(s) under it — ` +
            `NOT touching it automatically. Review these transactions manually (they were never linked to the real ` +
            `Couriers module ledger) and decide whether to re-point them to the system category before re-running this script.`,
        );
        return;
      }
      console.log(`Deactivating the stray, unused duplicate category "${NEW_NAME}" (id=${stray.id}, 0 transactions)...`);
      await client.query(`UPDATE "categories" SET active = false WHERE id = $1`, [stray.id]);
    }

    await client.query(`UPDATE "categories" SET name = $1 WHERE id = $2`, [NEW_NAME, systemRow.id]);
    console.log(`Renamed the real COURIER_SHEET_COLLECTION category (id=${systemRow.id}) to "${NEW_NAME}".`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
