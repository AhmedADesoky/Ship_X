"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { TransactionFormDialog } from "@/components/transactions/transaction-form-dialog";
import { QuickRequestDialog } from "@/components/transactions/quick-request-dialog";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import {
  Landmark,
  TrendingDown,
  TrendingUp,
  Wallet,
  Receipt,
  Plus,
  Zap,
  Bike,
  ClipboardCheck,
  Scale,
  PieChart as PieChartIcon,
  BarChart3,
} from "lucide-react";

const chartConfig = {
  in: { label: "In", color: "var(--chart-1)" },
  out: { label: "Out", color: "var(--chart-4)" },
} satisfies ChartConfig;

const pieConfig = {
  total: { label: "Total" },
} satisfies ChartConfig;

const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const SAFE_LINE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
  href,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  tone?: "default" | "up" | "down";
  href?: string;
}) {
  const body = (
    <Card className="glass transition hover:shadow-md">
      <CardContent className="flex items-center gap-4 pt-6">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p
            className={
              "text-2xl font-semibold " +
              (tone === "up" ? "text-emerald-600" : tone === "down" ? "text-destructive" : "")
            }
          >
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function DashboardPage() {
  return (
    <RequirePermission>
      <DashboardPageContent />
    </RequirePermission>
  );
}

function DashboardPageContent() {
  const tNav = useTranslations("nav");
  const tDash = useTranslations("dashboard");
  const tTx = useTranslations("transactions");
  const tParties = useTranslations("parties");
  const tCouriers = useTranslations("couriers");
  const { accessToken } = useSession();
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [quickRequestOpen, setQuickRequestOpen] = useState(false);
  const canManageTransactions = usePermission("manage_transactions");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.reports.dashboard(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const totalIn = data?.series.reduce((s, d) => s + d.in, 0) ?? 0;
  const totalOut = data?.series.reduce((s, d) => s + d.out, 0) ?? 0;

  const categoryChartConfig = {
    IN: { label: tTx("in"), color: "var(--chart-1)" },
    OUT: { label: tTx("out"), color: "var(--chart-4)" },
  } satisfies ChartConfig;

  const monthlyChartConfig = {
    in: { label: tTx("in"), color: "var(--chart-1)" },
    out: { label: tTx("out"), color: "var(--chart-4)" },
  } satisfies ChartConfig;

  const deferredChartConfig = {
    outstanding: { label: tDash("deferredTrend"), color: "var(--chart-3)" },
  } satisfies ChartConfig;

  const reconciliationChartConfig = {
    difference: { label: tDash("reconciliationDrift"), color: "var(--chart-5)" },
  } satisfies ChartConfig;

  const safeTrendChartConfig = Object.fromEntries(
    (data?.safeSeries ?? []).map((s, i) => [s.id, { label: s.name, color: SAFE_LINE_COLORS[i % SAFE_LINE_COLORS.length] }]),
  ) satisfies ChartConfig;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tNav("dashboard")}
        description={tDash("subtitle")}
        action={
          <div className="flex gap-2">
            {canManageTransactions && (
              <Button variant="outline" onClick={() => setQuickRequestOpen(true)} className="gap-2">
                <Zap className="size-4" />
                {tTx("quickRequest")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setAddExpenseOpen(true)} className="gap-2">
              <Plus className="size-4" />
              {tTx("addExpense")}
            </Button>
            <Button onClick={() => setAddIncomeOpen(true)} className="gap-2">
              <Plus className="size-4" />
              {tTx("addIncome")}
            </Button>
          </div>
        }
      />

      <TransactionFormDialog open={addIncomeOpen} onOpenChange={setAddIncomeOpen} kind="IN" />
      <TransactionFormDialog open={addExpenseOpen} onOpenChange={setAddExpenseOpen} kind="OUT" />
      <QuickRequestDialog open={quickRequestOpen} onOpenChange={setQuickRequestOpen} />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard icon={Wallet} label={tDash("totalBalance")} value={(data?.totalBalance ?? 0).toLocaleString()} />
          <StatCard icon={Landmark} label={tNav("safes")} value={String(data?.safes.length ?? 0)} />
          <StatCard icon={TrendingUp} label={tDash("moneyIn")} value={totalIn.toLocaleString()} tone="up" />
          <StatCard icon={TrendingDown} label={tDash("moneyOut")} value={totalOut.toLocaleString()} tone="down" />
          <StatCard
            icon={ClipboardCheck}
            label={tDash("pendingApprovals")}
            value={String(data?.pendingCount ?? 0)}
            tone={data?.pendingCount ? "down" : "default"}
            href="/pending"
          />
        </div>
      )}

      {/* مناديب القاهرة والجيزة — three independent KPIs, never combined
          into one "courier balance" (hard business rule, see Phase 24). */}
      {!isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={Bike}
            label={tCouriers("sheetCollectionsTotal")}
            value={(data?.courierCollectionsTotal ?? 0).toLocaleString()}
            tone="up"
            href="/couriers"
          />
          <StatCard
            icon={Wallet}
            label={tCouriers("advancesTotal")}
            value={(data?.courierAdvancesTotal ?? 0).toLocaleString()}
            href="/couriers"
          />
          <StatCard
            icon={Wallet}
            label={tCouriers("outstandingAdvances")}
            value={(data?.courierOutstandingAdvances ?? 0).toLocaleString()}
            tone={data?.courierOutstandingAdvances ? "down" : "default"}
            href="/couriers"
          />
        </div>
      )}

      {/* 1. Activity — this week (Saturday-to-Friday, Cairo local time) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("activityChart")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-2xl" />
            ) : data && data.series.some((d) => d.in || d.out) ? (
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
              <EmptyState icon={Receipt} title={tDash("noActivity")} description={tDash("noActivityHint")} />
            )}
          </CardContent>
        </Card>

        {/* 2. Top parties by drawings */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("clientBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-2xl" />
            ) : data && data.clientBreakdown.length > 0 ? (
              <ChartContainer config={pieConfig} className="mx-auto aspect-square h-64">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={data.clientBreakdown} dataKey="total" nameKey="name" innerRadius={45} outerRadius={80} strokeWidth={2}>
                    {data.clientBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={Landmark} title={tDash("noClients")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 3. Income vs expense by category */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("categoryBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-2xl" />
            ) : data && data.categoryBreakdown.length > 0 ? (
              <ChartContainer config={categoryChartConfig} className="mx-auto aspect-square h-64">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={data.categoryBreakdown} dataKey="total" nameKey="name" innerRadius={45} outerRadius={80} strokeWidth={2}>
                    {data.categoryBreakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.kind === "IN" ? "var(--color-IN)" : "var(--color-OUT)"} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={BarChart3} title={tDash("noCategoryData")} />
            )}
          </CardContent>
        </Card>

        {/* 4. Safe balance comparison */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("safeComparison")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-2xl" />
            ) : data && data.safes.length > 0 ? (
              <ChartContainer config={pieConfig} className="mx-auto aspect-square h-64">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={data.safes} dataKey="balance" nameKey="name" innerRadius={45} outerRadius={80} strokeWidth={2}>
                    {data.safes.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={Landmark} title={tDash("noSafes")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 5. Monthly cash flow */}
        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("monthlyTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-2xl" />
            ) : data && data.monthlySeries.some((m) => m.in || m.out) ? (
              <ChartContainer config={monthlyChartConfig} className="h-64 w-full">
                <BarChart data={data.monthlySeries}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(2)} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="in" fill="var(--color-in)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="out" fill="var(--color-out)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={BarChart3} title={tDash("noMonthlyData")} />
            )}
          </CardContent>
        </Card>

        {/* 6. Activity by party type */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("partyTypeBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-2xl" />
            ) : data && data.partyTypeBreakdown.length > 0 ? (
              <ChartContainer config={pieConfig} className="mx-auto aspect-square h-64">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie
                    data={data.partyTypeBreakdown.map((p) => ({ name: p.type === "AGENT" ? tParties("agents") : p.type === "MERCHANT" ? tParties("merchants") : p.type, total: p.total }))}
                    dataKey="total"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={80}
                    strokeWidth={2}
                  >
                    {data.partyTypeBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={PieChartIcon} title={tDash("noPartyTypeData")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 7. Outstanding deferred balance trend */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("deferredTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-2xl" />
            ) : data && data.deferredTrend.some((d) => d.outstanding !== 0) ? (
              <ChartContainer config={deferredChartConfig} className="h-56 w-full">
                <LineChart data={data.deferredTrend}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(2)} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="outstanding" stroke="var(--color-outstanding)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={Wallet} title={tDash("noDeferredData")} />
            )}
          </CardContent>
        </Card>

        {/* 8. Reconciliation drift */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{tDash("reconciliationDrift")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-2xl" />
            ) : data && data.reconciliationDrift.length > 0 ? (
              <ChartContainer config={reconciliationChartConfig} className="h-56 w-full">
                <BarChart data={data.reconciliationDrift}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Bar dataKey="difference" radius={[4, 4, 4, 4]}>
                    {data.reconciliationDrift.map((entry, i) => (
                      <Cell key={i} fill={entry.difference === 0 ? "var(--chart-1)" : "var(--chart-5)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={Scale} title={tDash("noReconciliationData")} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 9. Per-safe balance trend, last 30 days */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{tDash("safeBalanceTrend")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : data && data.safeBalanceTrend.length > 0 && data.safeSeries.length > 0 ? (
            <ChartContainer config={safeTrendChartConfig} className="h-64 w-full">
              <LineChart data={data.safeBalanceTrend}>
                <CartesianGrid vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {data.safeSeries.map((s, i) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.id}
                    name={s.name}
                    stroke={SAFE_LINE_COLORS[i % SAFE_LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          ) : (
            <EmptyState icon={TrendingUp} title={tDash("noTrendData")} />
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{tDash("recentActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : data && data.recentTransactions.length > 0 ? (
            <div className="flex flex-col divide-y divide-border">
              {data.recentTransactions.map((tx) => {
                const kindLabel = tx.kind === "IN" ? tTx("in") : tx.kind === "OUT" ? tTx("out") : tTx("transfer");
                return (
                <div key={tx.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {tx.description || tx.client?.name || tx.safe?.name || kindLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tx.safe?.name} · {new Date(tx.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={tx.kind === "OUT" ? "destructive" : "secondary"}>{kindLabel}</Badge>
                    <span className="text-sm font-semibold">{Number(tx.amount).toLocaleString()}</span>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Receipt} title={tDash("noActivity")} description={tDash("noActivityHint")} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
