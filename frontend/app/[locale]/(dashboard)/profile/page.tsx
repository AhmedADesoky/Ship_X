"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { Upload, X, AlertTriangle, ShieldCheck } from "lucide-react";

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function ProfilePage() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tRoles = useTranslations("roles");
  const { user, accessToken, updateUser, logout } = useSession();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user?.name ?? "");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState("");

  const [mfaEnabled, setMfaEnabled] = useState(user?.mfaEnabled ?? false);
  const [mfaEnrollOpen, setMfaEnrollOpen] = useState(false);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaDisableOpen, setMfaDisableOpen] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");

  useEffect(() => {
    if (user) setMfaEnabled(user.mfaEnabled ?? false);
  }, [user]);

  const mfaEnrollMutation = useMutation({
    mutationFn: () => api.mfa.enroll(accessToken ?? undefined),
    onSuccess: (result) => setMfaEnrollment(result),
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const mfaVerifyMutation = useMutation({
    mutationFn: () => api.mfa.verify(mfaCode, accessToken ?? undefined),
    onSuccess: () => {
      setMfaEnabled(true);
      setMfaEnrollOpen(false);
      setMfaEnrollment(null);
      setMfaCode("");
      toast.success(t("mfaEnabledToast"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const mfaDisableMutation = useMutation({
    mutationFn: () => api.mfa.disable(mfaDisablePassword, accessToken ?? undefined),
    onSuccess: () => {
      setMfaEnabled(false);
      setMfaDisableOpen(false);
      setMfaDisablePassword("");
      toast.success(t("mfaDisabledToast"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.settings.reset(resetConfirm, accessToken ?? undefined),
    onSuccess: () => {
      toast.success(t("resetDone"));
      setResetOpen(false);
      logout();
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const clearNumbersMutation = useMutation({
    mutationFn: () => api.settings.clearNumbers(clearConfirm, accessToken ?? undefined),
    onSuccess: () => {
      toast.success(t("clearNumbersDone"));
      setClearOpen(false);
      setClearConfirm("");
      // Entities (parties/categories/safes) are untouched, so unlike the
      // full reset there's no need to log out — just refresh every cache
      // whose numbers just changed.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["parties"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      queryClient.invalidateQueries({ queryKey: ["reconciliations"] });
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  // `user` hydrates asynchronously a moment after mount (see lib/session.tsx),
  // so the useState initializer above often captures it as still-null on the
  // very first render. Keep the field in sync once the real session lands,
  // without clobbering text the user is actively typing.
  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const saveNameMutation = useMutation({
    mutationFn: () => api.users.updateSelf({ name }, accessToken ?? undefined),
    onSuccess: (updated) => {
      updateUser(updated);
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: (file: File) => api.users.uploadAvatar(file, accessToken ?? undefined),
    onSuccess: (updated) => {
      updateUser(updated);
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: () => api.users.removeAvatar(accessToken ?? undefined),
    onSuccess: (updated) => {
      updateUser(updated);
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <Card className="glass">
        <CardContent className="flex flex-col gap-6 pt-6">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <Avatar className="size-20">
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
              <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                {initials(user?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-2">
              <Label>{t("avatar")}</Label>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadAvatarMutation.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={uploadAvatarMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-3.5" />
                  {t("uploadAvatar")}
                </Button>
                {user?.avatarUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive"
                    disabled={removeAvatarMutation.isPending}
                    onClick={() => removeAvatarMutation.mutate()}
                  >
                    <X className="size-3.5" />
                    {t("removeAvatar")}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveNameMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-name">{t("name")}</Label>
              <Input id="profile-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("email")}</Label>
              <Input value={user?.email ?? ""} disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("role")}</Label>
              <div>{user?.role && <Badge variant="secondary">{tRoles(user.role)}</Badge>}</div>
            </div>
            <div>
              <Button type="submit" disabled={saveNameMutation.isPending}>
                {t("saveName")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            {t("mfaTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("mfaDescription")}</p>
          <div className="flex items-center gap-2">
            <Badge variant={mfaEnabled ? "default" : "secondary"}>
              {mfaEnabled ? t("mfaEnabled") : t("mfaDisabled")}
            </Badge>
          </div>
          {mfaEnabled ? (
            <div>
              <Dialog open={mfaDisableOpen} onOpenChange={(o) => { setMfaDisableOpen(o); if (!o) setMfaDisablePassword(""); }}>
                <DialogTrigger render={<Button variant="outline">{t("mfaDisableButton")}</Button>} />
                <DialogContent className="glass">
                  <DialogHeader>
                    <DialogTitle>{t("mfaDisableButton")}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="mfa-disable-password">{t("mfaConfirmPassword")}</Label>
                      <Input
                        id="mfa-disable-password"
                        type="password"
                        value={mfaDisablePassword}
                        onChange={(e) => setMfaDisablePassword(e.target.value)}
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        variant="destructive"
                        disabled={!mfaDisablePassword || mfaDisableMutation.isPending}
                        onClick={() => mfaDisableMutation.mutate()}
                      >
                        {t("mfaDisableButton")}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <div>
              <Dialog
                open={mfaEnrollOpen}
                onOpenChange={(o) => {
                  setMfaEnrollOpen(o);
                  if (o) mfaEnrollMutation.mutate();
                  if (!o) {
                    setMfaEnrollment(null);
                    setMfaCode("");
                  }
                }}
              >
                <DialogTrigger render={<Button variant="outline">{t("mfaEnableButton")}</Button>} />
                <DialogContent className="glass">
                  <DialogHeader>
                    <DialogTitle>{t("mfaEnableButton")}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    {mfaEnrollment ? (
                      <>
                        <p className="text-sm text-muted-foreground">{t("mfaScanInstructions")}</p>
                        <div className="rounded-lg border border-dashed p-3 text-xs">
                          <code className="break-all">{mfaEnrollment.secret}</code>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="mfa-verify-code">{t("mfaCodeLabel")}</Label>
                          <Input
                            id="mfa-verify-code"
                            inputMode="numeric"
                            maxLength={6}
                            value={mfaCode}
                            onChange={(e) => setMfaCode(e.target.value)}
                            className="tracking-widest text-center"
                          />
                        </div>
                        <DialogFooter>
                          <Button
                            disabled={mfaCode.length !== 6 || mfaVerifyMutation.isPending}
                            onClick={() => mfaVerifyMutation.mutate()}
                          >
                            {t("mfaConfirmButton")}
                          </Button>
                        </DialogFooter>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">…</p>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>

      {user?.permissions?.includes("reset_system") && (
        <Card className="glass border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="size-4" />
              {t("dangerZone")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("clearNumbersDescription")}</p>
            <div>
              <Dialog open={clearOpen} onOpenChange={(o) => { setClearOpen(o); if (!o) setClearConfirm(""); }}>
                <DialogTrigger render={<Button variant="destructive">{t("clearNumbersButton")}</Button>} />
                <DialogContent className="glass">
                  <DialogHeader>
                    <DialogTitle>{t("clearNumbersConfirmTitle")}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-muted-foreground">{t("clearNumbersConfirmDescription")}</p>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="clear-confirm">{t("resetConfirmLabel", { phrase: "CLEAR" })}</Label>
                      <Input
                        id="clear-confirm"
                        value={clearConfirm}
                        onChange={(e) => setClearConfirm(e.target.value)}
                        placeholder="CLEAR"
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        variant="destructive"
                        disabled={clearConfirm !== "CLEAR" || clearNumbersMutation.isPending}
                        onClick={() => clearNumbersMutation.mutate()}
                      >
                        {t("clearNumbersButton")}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="border-t border-destructive/20 pt-3" />

            <p className="text-sm text-muted-foreground">{t("resetDescription")}</p>
            <div>
              <Dialog open={resetOpen} onOpenChange={(o) => { setResetOpen(o); if (!o) setResetConfirm(""); }}>
                <DialogTrigger render={<Button variant="destructive">{t("resetButton")}</Button>} />
                <DialogContent className="glass">
                  <DialogHeader>
                    <DialogTitle>{t("resetConfirmTitle")}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-muted-foreground">{t("resetConfirmDescription")}</p>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="reset-confirm">{t("resetConfirmLabel", { phrase: "RESET" })}</Label>
                      <Input
                        id="reset-confirm"
                        value={resetConfirm}
                        onChange={(e) => setResetConfirm(e.target.value)}
                        placeholder="RESET"
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        variant="destructive"
                        disabled={resetConfirm !== "RESET" || resetMutation.isPending}
                        onClick={() => resetMutation.mutate()}
                      >
                        {t("resetButton")}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
