import * as Sentry from "@sentry/nextjs";

// Covers proxy.ts (this app's Edge middleware — next-intl + the Phase 16
// permission-redirect logic) and any Edge-runtime route handlers.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
});
