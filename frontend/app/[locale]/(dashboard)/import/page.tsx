"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/layout/require-permission";
import { api, ApiError, type ImportInspectResult } from "@/lib/api-client";
import { useSession } from "@/lib/session";

export default function ImportPage() {
  return (
    <RequirePermission>
      <ImportPageContent />
    </RequirePermission>
  );
}

function ImportPageContent() {
  const t = useTranslations("import");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [defaultSafeId, setDefaultSafeId] = useState("");
  const [inspection, setInspection] = useState<ImportInspectResult | null>(null);

  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["import-history"],
    queryFn: () => api.importBatches.history(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const inspectMutation = useMutation({
    mutationFn: () => api.importBatches.inspect(file!, accessToken ?? undefined),
    onSuccess: (result) => setInspection(result),
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const commitMutation = useMutation({
    mutationFn: () => api.importBatches.commit(file!, defaultSafeId, accessToken ?? undefined),
    onSuccess: (result) => {
      toast.success(`${t("imported")}: ${result.imported}, ${t("skipped")}: ${result.skipped}, ${t("review")}: ${result.review}`);
      queryClient.invalidateQueries({ queryKey: ["import-history"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setInspection(null);
      setFile(null);
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <Card className="glass">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-2 sm:max-w-sm">
            <Label htmlFor="import-file">{t("chooseFile")}</Label>
            <input
              id="import-file"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setInspection(null);
              }}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-2 sm:max-w-sm">
            <Label>{t("defaultSafe")}</Label>
            <Select value={defaultSafeId} onValueChange={(v) => setDefaultSafeId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder={t("defaultSafe")}>
                  {safes?.find((s) => s.id === defaultSafeId)?.name}
                </SelectValue>
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
          <div className="flex gap-2">
            <Button disabled={!file || inspectMutation.isPending} onClick={() => inspectMutation.mutate()}>
              {t("inspectAction")}
            </Button>
            <Button
              variant="outline"
              disabled={!inspection || !defaultSafeId || commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
            >
              {t("commitAction")}
            </Button>
          </div>

          {inspection && (
            <div className="flex flex-col gap-4">
              {inspection.alreadyImported && (
                <Badge variant="destructive" className="w-fit">
                  {t("alreadyImported")}
                </Badge>
              )}
              {inspection.warnings.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{t("warnings")}</p>
                  {inspection.warnings.map((w, i) => (
                    <p key={i} className="text-sm text-destructive">
                      {w}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex gap-6 text-sm">
                <p>
                  {t("rows")}: <strong>{inspection.rows}</strong>
                </p>
                <p>
                  {t("incomeTotal")}: <strong>{inspection.incomeTotal.toLocaleString()}</strong>
                </p>
                <p>
                  {t("expenseTotal")}: <strong>{inspection.expenseTotal.toLocaleString()}</strong>
                </p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("date")}</TableHead>
                      <TableHead>{t("description")}</TableHead>
                      <TableHead>{t("incomeColumn")}</TableHead>
                      <TableHead>{t("expenseColumn")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inspection.sample.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.date}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{row.description}</TableCell>
                        <TableCell>{row.income.toLocaleString()}</TableCell>
                        <TableCell>{row.expense.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : history && history.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("title")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("imported")}</TableHead>
                  <TableHead>{t("skipped")}</TableHead>
                  <TableHead>{t("review")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.filename}</TableCell>
                    <TableCell>{t.has(`statusValue.${b.status}`) ? t(`statusValue.${b.status}`) : b.status}</TableCell>
                    <TableCell>{b.rowsImported}</TableCell>
                    <TableCell>{b.rowsSkipped}</TableCell>
                    <TableCell>{b.rowsReview}</TableCell>
                  </TableRow>
                ))}
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
