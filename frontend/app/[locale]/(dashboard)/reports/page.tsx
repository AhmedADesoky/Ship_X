"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/layout/require-permission";
import { PrintableStatement, type PrintableExtraSection } from "@/components/shared/printable-statement";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { Download } from "lucide-react";

const chartConfig = {
  in: { label: "In", color: "var(--chart-1)" },
  out: { label: "Out", color: "var(--chart-4)" },
} satisfies ChartConfig;

type DatePreset = "WEEK" | "MONTH" | "30D" | "CUSTOM";

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  return (
    <RequirePermission>
      <ReportsPageContent />
    </RequirePermission>
  );
}

function ReportsPageContent() {
  const t = useTranslations("reports");
  const tStatement = useTranslations("statement");
  const tTx = useTranslations("transactions");
  const { accessToken } = useSession();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [preset, setPreset] = useState<DatePreset>("CUSTOM");

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const now = new Date();
    if (p === "WEEK") {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      setStart(toDateInput(monday));
      setEnd(toDateInput(now));
    } else if (p === "MONTH") {
      setStart(toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEnd(toDateInput(now));
    } else if (p === "30D") {
      const past = new Date(now);
      past.setDate(now.getDate() - 30);
      setStart(toDateInput(past));
      setEnd(toDateInput(now));
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["reports", start, end],
    queryFn: () => api.reports.range(start || undefined, end || undefined, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  // Every on-screen breakdown table, mapped into PrintableStatement's
  // generic extraSections shape (Phase 39c) — so "export to PDF" actually
  // includes everything shown on this page, not just byCategory as before.
  const extraSections = useMemo<PrintableExtraSection[]>(() => {
    if (!data) return [];
    const kindLabel = (k: string) => (k === "IN" ? tTx("in") : k === "OUT" ? tTx("out") : tTx("transfer"));
    const sections: PrintableExtraSection[] = [
      {
        title: t("byCategory"),
        columns: [t("byCategory"), t("kind"), t("total"), t("count")],
        rows: data.byCategory.map((r) => [r.category, kindLabel(r.kind), r.total, r.count]),
      },
      {
        title: t("byParty"),
        columns: [t("byParty"), t("kind"), t("total"), t("count")],
        rows: data.byParty.map((r) => [r.party, kindLabel(r.kind), r.total, r.count]),
      },
      {
        title: t("bySafe"),
        columns: [t("bySafe"), t("net")],
        rows: data.bySafe.map((r) => [r.safe, r.net]),
      },
      {
        title: t("activityChart"),
        columns: [t("date"), t("income"), t("expense")],
        rows: data.series.map((r) => [r.date, r.in, r.out]),
      },
      {
        title: t("drawings"),
        columns: [t("party"), t("total"), t("count"), t("remaining"), t("settled")],
        rows: data.drawingsByParty.map((r) => [r.party, r.total, r.count, r.remaining, r.settled ? t("settled") : t("unsettled")]),
      },
      {
        title: t("deferred"),
        columns: [t("party"), t("total"), t("count"), t("remaining"), t("settled")],
        rows: data.deferredByParty.map((r) => [r.party, r.total, r.count, r.remaining, r.settled ? t("settled") : t("unsettled")]),
      },
      {
        title: t("advances"),
        columns: [t("courier"), t("total"), t("count"), t("remaining"), t("settled")],
        rows: data.advancesByCourier.map((r) => [r.courier, r.total, r.count, r.remaining, r.settled ? t("settled") : t("unsettled")]),
      },
      {
        title: `${t("topOutstanding")} — ${t("drawings")}`,
        columns: [t("party"), t("remaining")],
        rows: data.topOutstandingDrawings.map((r) => [r.party, r.remaining]),
      },
      {
        title: `${t("topOutstanding")} — ${t("deferred")}`,
        columns: [t("party"), t("remaining")],
        rows: data.topOutstandingDeferred.map((r) => [r.party, r.remaining]),
      },
      {
        title: `${t("topOutstanding")} — ${t("advances")}`,
        columns: [t("courier"), t("remaining")],
        rows: data.topOutstandingCourierAdvances.map((r) => [r.courier, r.remaining]),
      },
    ];
    return sections.filter((s) => s.rows.length > 0);
  }, [data, t, tTx]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          <Button variant="outline" className="gap-2" disabled={isLoading || !data} onClick={() => window.print()}>
            <Download className="size-4" />
            {tStatement("exportPdf")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <div className="flex flex-col gap-2">
          <Label>{t("datePreset")}</Label>
          <Select value={preset} onValueChange={(v) => applyPreset((v as DatePreset) ?? "CUSTOM")}>
            <SelectTrigger className="w-fit min-w-40">
              <SelectValue>
                {preset === "WEEK"
                  ? t("presetThisWeek")
                  : preset === "MONTH"
                    ? t("presetThisMonth")
                    : preset === "30D"
                      ? t("presetLast30Days")
                      : t("presetCustom")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="WEEK">{t("presetThisWeek")}</SelectItem>
              <SelectItem value="MONTH">{t("presetThisMonth")}</SelectItem>
              <SelectItem value="30D">{t("presetLast30Days")}</SelectItem>
              <SelectItem value="CUSTOM">{t("presetCustom")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="report-start">{t("start")}</Label>
          <Input
            id="report-start"
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setPreset("CUSTOM");
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="report-end">{t("end")}</Label>
          <Input
            id="report-end"
            type="date"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setPreset("CUSTOM");
            }}
          />
        </div>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-64 rounded-3xl print:hidden" />
      ) : (
        <div className="print:hidden flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{t("income")}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-emerald-600">
                {data.totals.income.toLocaleString()}
              </CardContent>
            </Card>
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{t("expense")}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-destructive">
                {data.totals.expense.toLocaleString()}
              </CardContent>
            </Card>
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{t("net")}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{data.totals.net.toLocaleString()}</CardContent>
            </Card>
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{t("count")}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{data.totals.count.toLocaleString()}</CardContent>
            </Card>
          </div>

          <Card className="glass">
            <CardHeader>
              <CardTitle>{t("activityChart")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.series.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-64 w-full">
                  <BarChart data={data.series}>
                    <CartesianGrid vertical={false} strokeDasharray="4 4" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="in" fill="var(--color-in)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="out" fill="var(--color-out)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("subtitle")}</p>
              )}
            </CardContent>
          </Card>

          {[
            { title: t("byCategory"), rows: data.byCategory, label: "category" as const },
            { title: t("byParty"), rows: data.byParty, label: "party" as const },
          ].map((group) => (
            <Card key={group.title} className="glass">
              <CardHeader>
                <CardTitle>{group.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{group.title}</TableHead>
                      <TableHead>{t("kind")}</TableHead>
                      <TableHead>{t("total")}</TableHead>
                      <TableHead>{t("count")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(group.rows as any[]).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row[group.label]}</TableCell>
                        <TableCell>{row.kind === "IN" ? tTx("in") : row.kind === "OUT" ? tTx("out") : tTx("transfer")}</TableCell>
                        <TableCell>{Number(row.total).toLocaleString()}</TableCell>
                        <TableCell>{row.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}

          <Card className="glass">
            <CardHeader>
              <CardTitle>{t("bySafe")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("bySafe")}</TableHead>
                    <TableHead>{t("net")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.bySafe.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>{row.safe}</TableCell>
                      <TableCell>{row.net.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* مناديب — always 3 separate figures, never netted against
              each other (hard rule, see couriers.service.ts). */}
          <Card className="glass">
            <CardHeader>
              <CardTitle>{t("byCourier")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">{t("courierCollections")}</p>
                <p className="text-xl font-semibold">{data.courierCollectionsTotal.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("courierAdvances")}</p>
                <p className="text-xl font-semibold">{data.courierAdvancesTotal.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("courierOutstanding")}</p>
                <p className="text-xl font-semibold">{data.courierOutstandingAdvances.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>

          {/* مسحوبات / آجل / سلف المناديب — total + per-party/courier
              breakdown, scoped to the selected period; each section's
              outstanding figure stays separate, never netted against the
              others (same hard rule as every other ledger-type figure on
              this page). */}
          {[
            { title: t("drawings"), total: data.drawingsTotal, rows: data.drawingsByParty, label: t("party") },
            { title: t("deferred"), total: data.deferredTotal, rows: data.deferredByParty, label: t("party") },
            {
              title: t("advances"),
              total: data.advancesByCourier.reduce((s, r) => s + r.total, 0),
              rows: data.advancesByCourier.map((r) => ({
                party: r.courier,
                total: r.total,
                count: r.count,
                remaining: r.remaining,
                settled: r.settled,
              })),
              label: t("courier"),
            },
          ].map((group) => (
            <Card key={group.title} className="glass">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{group.title}</span>
                  <span className="text-base font-semibold">{group.total.toLocaleString()}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {group.rows.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{group.label}</TableHead>
                        <TableHead>{t("total")}</TableHead>
                        <TableHead>{t("count")}</TableHead>
                        <TableHead>{t("remaining")}</TableHead>
                        <TableHead>{t("settled")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(
                        group.rows as { party: string; total: number; count: number; remaining: number; settled: boolean }[]
                      ).map((row, i) => (
                        <TableRow key={i}>
                          <TableCell>{row.party}</TableCell>
                          <TableCell>{row.total.toLocaleString()}</TableCell>
                          <TableCell>{row.count}</TableCell>
                          <TableCell>{row.remaining.toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant={row.settled ? "secondary" : "outline"}>
                              {row.settled ? t("settled") : t("unsettled")}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">{t("noOutstanding")}</p>
                )}
              </CardContent>
            </Card>
          ))}

          {/* أعلى الأرصدة القائمة — 3 separate top-5 lists, never one
              combined ranking across ledger types. */}
          <Card className="glass">
            <CardHeader>
              <CardTitle>{t("topOutstanding")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {[
                { title: t("drawings"), rows: data.topOutstandingDrawings, label: t("party") as string },
                { title: t("deferred"), rows: data.topOutstandingDeferred, label: t("party") as string },
                {
                  title: t("advances"),
                  rows: data.topOutstandingCourierAdvances.map((r) => ({ party: r.courier, remaining: r.remaining })),
                  label: t("courier") as string,
                },
              ].map((list) => (
                <div key={list.title} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-muted-foreground">{list.title}</p>
                  {list.rows.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-sm">
                      {(list.rows as { party: string; remaining: number }[]).map((row, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <span className="truncate">{row.party}</span>
                          <span className="font-medium">{row.remaining.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("noOutstanding")}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {data && (
        <PrintableStatement
          title={t("title")}
          periodLabel={start || end ? `${start || "—"} ${t("end")} ${end || "—"}` : undefined}
          eventTypeLabel={(type) => (type === "IN" ? tTx("in") : tTx("out"))}
          extraSections={extraSections}
          totalsBySection={[
            { label: t("income"), amount: data.totals.income },
            { label: t("expense"), amount: data.totals.expense },
            { label: t("net"), amount: data.totals.net },
            { label: t("courierCollections"), amount: data.courierCollectionsTotal },
            { label: t("courierAdvances"), amount: data.courierAdvancesTotal },
            { label: t("drawingsOutstanding"), amount: data.drawingsOutstandingTotal },
            { label: t("deferredOutstanding"), amount: data.deferredOutstandingTotal },
          ]}
        />
      )}
    </div>
  );
}
