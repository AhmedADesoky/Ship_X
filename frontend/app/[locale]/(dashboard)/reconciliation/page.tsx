"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/layout/require-permission";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { cn } from "@/lib/utils";

export default function ReconciliationPage() {
  return (
    <RequirePermission>
      <ReconciliationPageContent />
    </RequirePermission>
  );
}

function ReconciliationPageContent() {
  const t = useTranslations("reconciliation");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const canManageReconciliations = usePermission("manage_reconciliations");

  const [safeId, setSafeId] = useState("");
  const [reconDate, setReconDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [actualBalance, setActualBalance] = useState("");
  const [note, setNote] = useState("");

  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const { data: history, isLoading } = useQuery({
    queryKey: ["reconciliations"],
    queryFn: () => api.reconciliations.list(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.reconciliations.create(
        { safeId, reconDate, actualBalance: Number(actualBalance), note: note || undefined },
        accessToken ?? undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      setActualBalance("");
      setNote("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {canManageReconciliations && (
      <Card className="glass">
        <CardContent className="pt-6">
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label>{t("safe")}</Label>
              <Select value={safeId} onValueChange={(v) => setSafeId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder={t("safe")}>{safes?.find((s) => s.id === safeId)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {safes?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="recon-date">{t("reconDate")}</Label>
              <Input id="recon-date" type="date" required value={reconDate} onChange={(e) => setReconDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="recon-actual">{t("actualBalance")}</Label>
              <AmountInput id="recon-actual" required value={actualBalance} onChange={setActualBalance} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="recon-note">{t("note")}</Label>
              <Input id="recon-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={mutation.isPending || !safeId}>
                {t("submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      )}

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : history && history.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reconDate")}</TableHead>
                  <TableHead>{t("safe")}</TableHead>
                  <TableHead>{t("expectedBalance")}</TableHead>
                  <TableHead>{t("actualBalance")}</TableHead>
                  <TableHead>{t("difference")}</TableHead>
                  <TableHead>{t("note")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => {
                  const diff = Number(r.difference);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.reconDate).toLocaleDateString()}</TableCell>
                      <TableCell>{r.safe?.name}</TableCell>
                      <TableCell>{Number(r.expectedBalance).toLocaleString()}</TableCell>
                      <TableCell>{Number(r.actualBalance).toLocaleString()}</TableCell>
                      <TableCell className={cn(diff === 0 ? "text-emerald-600" : "text-destructive", "font-medium")}>
                        {diff === 0 ? t("matched") : diff.toLocaleString()}
                      </TableCell>
                      <TableCell>{r.note}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
