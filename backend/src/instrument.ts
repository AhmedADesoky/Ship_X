// Must be imported before any other module (see main.ts's first line) so
// Sentry can instrument everything else as it loads. An empty/unset
// SENTRY_DSN disables the SDK automatically (it logs a warning, never
// throws, never sends events) — same no-op-when-unconfigured pattern as
// REDIS_URL elsewhere in this backend, so local dev needs no Sentry
// account to run.
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
});
