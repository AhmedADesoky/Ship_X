"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// Last-resort error boundary — fires when even the root layout crashes, so
// it must render its own <html>/<body> (there's no layout left to rely
// on). Reports to Sentry (a no-op when NEXT_PUBLIC_SENTRY_DSN is unset).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
