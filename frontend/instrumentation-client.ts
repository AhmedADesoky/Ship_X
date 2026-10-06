import * as Sentry from "@sentry/nextjs";

// Empty NEXT_PUBLIC_SENTRY_DSN disables the SDK automatically (a console
// warning, never a thrown error, never an event sent) — same no-op
// pattern as the backend's SENTRY_DSN/REDIS_URL. No Sentry account is
// needed for local dev to work.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
