"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { AddCourierDialog } from "@/components/couriers/add-courier-dialog";
import { AddSheetCollectionDialog } from "@/components/couriers/add-sheet-collection-dialog";
import { AddAdvanceDialog } from "@/components/couriers/add-advance-dialog";
import { RepayAdvanceDialog } from "@/components/couriers/repay-advance-dialog";
import { PrintableStatement } from "@/components/shared/printable-statement";
import { api, type CourierStatementEvent } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { useFlowTrail } from "@/lib/flow-trail";
import { Plus, Receipt, Wallet, Undo2, Download } from "lucide-react";

export default function CourierDetailPage() {
  return (
    <RequirePermission>
      <CourierDetailPageContent />
    </RequirePermission>
  );
}

function CourierDetailPageContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useTranslations("couriers");
  const tCommon = useTranslations("common");
  const tTx = useTranslations("transactions");
  const tStatement = useTranslations("statement");
  const { accessToken } = useSession();
  const canManageCouriers = usePermission("manage_couriers");
  const { setCurrentLabel } = useFlowTrail();

  const { data: courier, isLoading: courierLoading } = useQuery({
    queryKey: ["couriers", id],
    queryFn: () => api.couriers.get(id, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  useEffect(() => {
    if (courier?.name) setCurrentLabel(courier.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courier?.name]);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["couriers", id, "summary"],
    queryFn: () => api.couriers.summary(id, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  const { data: sheetCollections, isLoading: sheetsLoading } = useQuery({
    queryKey: ["couriers", id, "sheet-collections"],
    queryFn: () => api.couriers.sheetCollections(id, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  const { data: advances, isLoading: advancesLoading } = useQuery({
    queryKey: ["couriers", id, "advances"],
    queryFn: () => api.couriers.advances(id, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  const [statementStart, setStatementStart] = useState("");
  const [statementEnd, setStatementEnd] = useState("");
  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ["couriers", id, "statement", statementStart, statementEnd],
    queryFn: () => api.couriers.statement(id, statementStart || undefined, statementEnd || undefined, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);

  if (courierLoading || !courier) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={courier.name}
        description={courier.phone ?? ""}
        backHref="/couriers"
        action={
          canManageCouriers && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                {t("editCourier")}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSheetOpen(true)}>
                <Plus className="size-3.5" />
                {t("sheetCollection.add")}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdvanceOpen(true)}>
                <Plus className="size-3.5" />
                {t("advance.add")}
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setRepayOpen(true)}>
                <Undo2 className="size-3.5" />
                {t("repayment.add")}
              </Button>
            </div>
          )
        }
      />

      {/* فعلي: two visually separated stat-card groups — never a combined balance. */}
      <div className="grid grid-cols-1 gap-4 print:hidden sm:grid-cols-2">
        <Card className="glass border-primary/20">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("tabs.sheetCollections")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("sheetCollectionsTotal")}</span>
              <span className="text-2xl font-semibold">
                {summaryLoading ? "…" : (summary?.sheetCollectionsTotal ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{t("sheetCollectionsCount")}</span>
              <span>{summary?.sheetCollectionsCount ?? 0}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="glass border-muted">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("tabs.advances")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("outstandingAdvances")}</span>
              <span className="text-2xl font-semibold">
                {summaryLoading ? "…" : (summary?.outstandingAdvances ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{t("advancesTotal")}</span>
              <span>{(summary?.advancesTotal ?? 0).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="sheet-collections">
        <TabsList className="print:hidden">
          <TabsTrigger value="sheet-collections">{t("tabs.sheetCollections")}</TabsTrigger>
          <TabsTrigger value="advances">{t("tabs.advances")}</TabsTrigger>
          <TabsTrigger value="statement">{t("tabs.statement")}</TabsTrigger>
        </TabsList>

        <TabsContent value="sheet-collections" className="flex flex-col gap-4">
          <Card className="glass">
            <CardContent className="pt-6">
              {sheetsLoading ? (
                <Skeleton className="h-32 w-full rounded-2xl" />
              ) : sheetCollections && sheetCollections.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("sheetCollection.date")}</TableHead>
                      <TableHead>{t("sheetCollection.amount")}</TableHead>
                      <TableHead>{t("sheetCollection.safe")}</TableHead>
                      <TableHead>{t("sheetCollection.note")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheetCollections.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{new Date(s.date).toLocaleDateString()}</TableCell>
                        <TableCell>{Number(s.amount).toLocaleString()}</TableCell>
                        <TableCell>{s.safe?.name}</TableCell>
                        <TableCell>{s.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={Receipt} title={t("noSheetCollectionsYet")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advances" className="flex flex-col gap-4">
          <Card className="glass">
            <CardContent className="pt-6">
              {advancesLoading ? (
                <Skeleton className="h-32 w-full rounded-2xl" />
              ) : advances && advances.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("sheetCollection.date")}</TableHead>
                      <TableHead>{t("advance.original")}</TableHead>
                      <TableHead>{t("advance.remaining")}</TableHead>
                      <TableHead>{tTx("status")}</TableHead>
                      <TableHead>{t("sheetCollection.safe")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {advances.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>{Number(a.originalAmount).toLocaleString()}</TableCell>
                        <TableCell>{Number(a.remainingAmount).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={a.status === "FULLY_REPAID" ? "secondary" : "outline"}>
                            {t(`advance.status.${a.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>{a.safe?.name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={Wallet} title={t("noAdvancesYet")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statement" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="statement-start">{t("statement.filterStart")}</Label>
                <Input
                  id="statement-start"
                  type="date"
                  value={statementStart}
                  onChange={(e) => setStatementStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="statement-end">{t("statement.filterEnd")}</Label>
                <Input id="statement-end" type="date" value={statementEnd} onChange={(e) => setStatementEnd(e.target.value)} />
              </div>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <Download className="size-4" />
              {tStatement("exportPdf")}
            </Button>
          </div>
          <div className="print:hidden">
            <Card className="glass">
              <CardContent className="pt-6">
                {statementLoading ? (
                  <Skeleton className="h-32 w-full rounded-2xl" />
                ) : statement && statement.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("sheetCollection.date")}</TableHead>
                        <TableHead>{t("statement.filterType")}</TableHead>
                        <TableHead>{t("sheetCollection.amount")}</TableHead>
                        <TableHead>{t("sheetCollection.safe")}</TableHead>
                        <TableHead>{tStatement("remaining")}</TableHead>
                        <TableHead>{tStatement("status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statement.map((e: CourierStatementEvent) => (
                        <TableRow key={`${e.type}-${e.id}`}>
                          <TableCell>{new Date(e.date).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant={e.direction === "IN" ? "default" : "secondary"}>
                              {t(`statement.type.${e.type}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className={e.direction === "IN" ? "text-emerald-600" : "text-destructive"}>
                            {e.direction === "IN" ? "+" : "-"}
                            {e.amount.toLocaleString()}
                          </TableCell>
                          <TableCell>{e.safe?.name}</TableCell>
                          <TableCell>{e.remaining !== undefined ? e.remaining.toLocaleString() : "—"}</TableCell>
                          <TableCell>
                            {e.settled === undefined ? (
                              "—"
                            ) : (
                              <Badge variant={e.settled ? "secondary" : "outline"}>
                                {e.settled ? tStatement("settled") : tStatement("unsettled")}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState icon={Receipt} title={t("statement.noEvents")} />
                )}
              </CardContent>
            </Card>
          </div>

          <PrintableStatement
            title={`${tStatement("accountStatement")} — ${courier?.name ?? ""}`}
            periodLabel={
              statementStart || statementEnd
                ? `${statementStart || "—"} ${tStatement("endDate")} ${statementEnd || "—"}`
                : undefined
            }
            eventTypeLabel={(type) => t(`statement.type.${type}`)}
            events={statement ?? []}
            showSafe={false}
            // Never net سلفة/سداد سلفة against تحصيل شيت — one total PER
            // type, per this module's hard business rule (Phase 24).
            totalsBySection={[
              ...Object.entries(
                (statement ?? []).reduce<Record<string, number>>((acc, e) => {
                  acc[e.type] = (acc[e.type] ?? 0) + e.amount;
                  return acc;
                }, {}),
              ).map(([type, amount]) => ({ label: t(`statement.type.${type}`), amount })),
              // Current (not period-scoped) outstanding advances, so the
              // statement always shows where things stand today too.
              ...(summary?.outstandingAdvances !== undefined
                ? [{ label: t("outstandingAdvances"), amount: summary.outstandingAdvances }]
                : []),
            ]}
          />
        </TabsContent>
      </Tabs>

      <AddCourierDialog open={editOpen} onOpenChange={setEditOpen} courier={courier} />
      <AddSheetCollectionDialog open={sheetOpen} onOpenChange={setSheetOpen} courier={courier} />
      <AddAdvanceDialog open={advanceOpen} onOpenChange={setAdvanceOpen} courierId={id} />
      <RepayAdvanceDialog open={repayOpen} onOpenChange={setRepayOpen} courierId={id} />
    </div>
  );
}
