import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { QueryProvider } from "@/components/providers/query-provider";
import { SessionProvider } from "@/lib/session";
import { Toaster } from "@/components/ui/sonner";
import "../globals.css";

export const metadata: Metadata = {
  title: "Ship X",
  description: "Ship X finance and courier ledger system",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>
            <SessionProvider>{children}</SessionProvider>
            <Toaster position={dir === "rtl" ? "top-left" : "top-right"} richColors />
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
