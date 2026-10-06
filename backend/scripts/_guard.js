/**
 * One-off DB scripts in this directory run raw SQL directly against
 * whatever DATABASE_URL is in the environment when they're invoked — there
 * is no confirmation step, so a script meant for a local/dev database can
 * silently run against production if the environment is wrong. Every
 * script here should call assertNotProduction() right after loading
 * DATABASE_URL, before opening a connection.
 *
 * This is a heuristic, not a guarantee: it blocks the common accidents
 * (NODE_ENV=production, or a connection string pointing at a recognizable
 * managed-prod hostname pattern) and requires an explicit opt-out env var
 * for the rare legitimate case of intentionally running against prod.
 */
function assertNotProduction(databaseUrl) {
  if (process.env.ALLOW_PROD_DB_SCRIPT === "1") return;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run: NODE_ENV=production. Set ALLOW_PROD_DB_SCRIPT=1 if this is intentional.",
    );
  }

  const url = databaseUrl || "";
  const looksProd = /prod|production/i.test(url);
  if (looksProd) {
    throw new Error(
      `Refusing to run: DATABASE_URL looks like a production database (matched "prod"). Set ALLOW_PROD_DB_SCRIPT=1 if this is intentional.\nURL: ${url.replace(/:[^:@/]+@/, ":****@")}`,
    );
  }
}

module.exports = { assertNotProduction };
