import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs/config";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Scoped to what this app actually calls: the backend API (fetch/XHR),
// Supabase Storage for avatar images (any *.supabase.co project subdomain,
// since the exact project ref isn't exposed to the frontend build), and
// self for everything else. No inline/eval script sources.
const isDev = process.env.NODE_ENV !== "production";
// Only widen connect-src for Sentry's ingest endpoint when a DSN is
// actually configured — keeps the CSP maximally strict while Sentry is a
// no-op (see instrumentation-client.ts).
const sentryIngest = process.env.NEXT_PUBLIC_SENTRY_DSN ? " https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io" : "";

const csp = [
  "default-src 'self'",
  `connect-src 'self' ${apiOrigin}${isDev ? " ws:" : ""}${sentryIngest}`,
  "img-src 'self' data: https://*.supabase.co",
  // Next's dev server (HMR/React Refresh) injects inline/eval'd scripts
  // that a strict script-src would break — only relaxed outside production.
  `script-src 'self'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

// org/project/authToken are only needed for source-map upload during
// build — the plugin silently skips that step when SENTRY_AUTH_TOKEN is
// unset (no Sentry account required for this to build/run normally).
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
