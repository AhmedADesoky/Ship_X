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
import { useSession } from "@/lib/session";

export default function LoginPage() {
  const t = useTranslations("login");
  const router = useRouter();
  const { login } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.login(email, password, mfaRequired ? mfaCode : undefined);
      if ("mfaRequired" in result) {
        setMfaRequired(true);
        return;
      }
      login(result);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("error"));
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
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11"
                disabled={mfaRequired}
              />
            </div>
            {mfaRequired && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="mfaCode">{t("mfaCode")}</Label>
                <Input
                  id="mfaCode"
                  type="text"
                  inputMode="numeric"
                  required
                  autoFocus
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="h-11 tracking-widest text-center"
                  maxLength={6}
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => router.push("/forgot-password")}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {t("forgotPassword")}
              </button>
            </div>
            <Button type="submit" disabled={loading} className="mt-2 h-11">
              {mfaRequired ? t("verify") : t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
