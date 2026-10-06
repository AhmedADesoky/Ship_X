"use client";

import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ShipXWordmark } from "@/components/brand/ship-x-logo";
import { api, ApiError } from "@/lib/api-client";

function ResetPasswordForm() {
  const t = useTranslations("resetPassword");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.resetPassword(email, token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("submit"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="glass w-full max-w-md shadow-xl">
        <CardHeader className="flex flex-col items-center gap-3 pb-2 pt-8 text-center">
          <ShipXWordmark className="text-4xl" tone="dark" />
          <CardDescription className="text-sm">{t("title")}</CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-8 pt-4">
          {done ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm">{t("success")}</p>
              <Button className="h-11" onClick={() => router.push("/login")}>
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="token">{t("token")}</Label>
                <Input
                  id="token"
                  type="text"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="newPassword">{t("newPassword")}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
