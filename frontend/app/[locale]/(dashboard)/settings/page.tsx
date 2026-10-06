"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/layout/require-permission";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SettingsPage() {
  return (
    <RequirePermission>
      <SettingsPageContent />
    </RequirePermission>
  );
}

function SettingsPageContent() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const [companyName, setCompanyName] = useState("");
  useEffect(() => {
    if (settings?.company_name) setCompanyName(settings.company_name);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => api.settings.update({ company_name: companyName }, accessToken ?? undefined),
    onSuccess: () => toast.success(tCommon("success")),
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const [exporting, setExporting] = useState(false);
  const [exportingFull, setExportingFull] = useState(false);

  async function exportFullBackup() {
    setExportingFull(true);
    try {
      const blob = await api.settings.exportFull(accessToken ?? undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shipx-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : tCommon("error"));
    } finally {
      setExportingFull(false);
    }
  }

  async function exportData(format: "csv" | "json") {
    setExporting(true);
    try {
      const transactions = await api.transactions.list({}, accessToken ?? undefined);
      if (format === "json") {
        downloadBlob(JSON.stringify(transactions, null, 2), `transactions-${Date.now()}.json`, "application/json");
      } else {
        const header = "date,kind,safe,category,party,amount,description,referenceNo,status";
        const rows = transactions.map((tx) =>
          [
            new Date(tx.createdAt).toISOString().slice(0, 10),
            tx.kind,
            tx.safe?.name ?? "",
            tx.category?.name ?? "",
            tx.party?.name ?? "",
            tx.amount,
            (tx.description ?? "").replace(/"/g, '""'),
            tx.referenceNo ?? "",
            tx.status,
          ]
            .map((v) => `"${v}"`)
            .join(","),
        );
        downloadBlob([header, ...rows].join("\n"), `transactions-${Date.now()}.csv`, "text/csv");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : tCommon("error"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {isLoading ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : (
        <Card className="glass">
          <CardHeader>
            <CardTitle>{t("companyName")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:max-w-sm">
              <Label htmlFor="company-name">{t("companyName")}</Label>
              <Input id="company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {t("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("exportData")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("securityNote")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={exporting} onClick={() => exportData("csv")}>
              {t("exportCsv")}
            </Button>
            <Button variant="outline" disabled={exporting} onClick={() => exportData("json")}>
              {t("exportJson")}
            </Button>
            <Button disabled={exportingFull} onClick={exportFullBackup}>
              {t("exportFullBackup")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("exportFullBackupNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
