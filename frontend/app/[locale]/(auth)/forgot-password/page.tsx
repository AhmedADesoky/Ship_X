"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ShipXWordmark } from "@/components/brand/ship-x-logo";
import { api, ApiError } from "@/lib/api-client";

export default function ForgotPasswordPage() {
  const t = useTranslations("forgotPassword");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<{ devToken?: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.forgotPassword(email);
      setSent({ devToken: result.devToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("success"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="glass w-full max-w-md shadow-xl">
        <CardHeader className="flex flex-col items-center gap-3 pb-2 pt-8 text-center">
          <ShipXWordmark className="text-4xl" tone="dark" />
          <CardDescription className="text-sm">{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-8 pt-4">
          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm">{t("success")}</p>
              {sent.devToken && (
                <div className="rounded-lg border border-dashed p-3 text-xs">
                  <p className="mb-1 font-medium">{t("devTokenNote")}</p>
                  <code className="break-all">{sent.devToken}</code>
                </div>
              )}
              <Button className="h-11" onClick={() => router.push(`/reset-password?email=${encodeURIComponent(email)}`)}>
                {t("backToLogin")}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="h-11"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={loading} className="mt-2 h-11">
                {t("submit")}
              </Button>
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {t("backToLogin")}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
