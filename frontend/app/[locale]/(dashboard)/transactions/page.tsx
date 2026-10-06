"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { TransactionFormDialog } from "@/components/transactions/transaction-form-dialog";
import { QuickRequestDialog } from "@/components/transactions/quick-request-dialog";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { ArrowLeftRight, Plus, Zap } from "lucide-react";

export default function TransactionsPage() {
  return (
    <RequirePermission>
      <TransactionsPageContent />
    </RequirePermission>
  );
}

function TransactionsPageContent() {
  const t = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();

  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [quickRequestOpen, setQuickRequestOpen] = useState(false);
  const canManageTransactions = usePermission("manage_transactions");

  const filters = useMemo(
    () => ({ q: q || undefined, kind: kindFilter || undefined, page, pageSize: PAGE_SIZE }),
    [q, kindFilter, page],
  );

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => api.transactions.list(filters, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          canManageTransactions && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setQuickRequestOpen(true)} className="gap-2">
              <Zap className="size-4" />
              {t("quickRequest")}
            </Button>
            <Button variant="outline" onClick={() => setAddExpenseOpen(true)} className="gap-2">
              <Plus className="size-4" />
              {t("addExpense")}
            </Button>
            <Button onClick={() => setAddIncomeOpen(true)} className="gap-2">
              <Plus className="size-4" />
              {t("addIncome")}
            </Button>
          </div>
          )
        }
      />

      <TransactionFormDialog open={addIncomeOpen} onOpenChange={setAddIncomeOpen} kind="IN" />
      <TransactionFormDialog open={addExpenseOpen} onOpenChange={setAddExpenseOpen} kind="OUT" />
      <QuickRequestDialog open={quickRequestOpen} onOpenChange={setQuickRequestOpen} />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={t("search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <Select
          value={kindFilter || "ALL"}
          onValueChange={(v) => {
            setKindFilter(!v || v === "ALL" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-fit min-w-40">
            <SelectValue placeholder={t("filterKind")}>
              {!kindFilter || kindFilter === "ALL" ? tCommon("all") : kindFilter === "IN" ? t("in") : t("out")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{tCommon("all")}</SelectItem>
            <SelectItem value="IN">{t("in")}</SelectItem>
            <SelectItem value="OUT">{t("out")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      ) : transactions && transactions.length > 0 ? (
        <div className="overflow-x-auto rounded-3xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("date")}</TableHead>
                <TableHead>{t("kind")}</TableHead>
                <TableHead>{t("safe")}</TableHead>
                <TableHead>{t("category")}</TableHead>
                <TableHead>{t("party")}</TableHead>
                <TableHead>{t("amount")}</TableHead>
                <TableHead>{t("description")}</TableHead>
                <TableHead>{t("createdBy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge variant={tx.kind === "IN" ? "default" : tx.kind === "OUT" ? "secondary" : "outline"}>
                      {tx.kind === "IN" ? t("in") : tx.kind === "OUT" ? t("out") : t("transfer")}
                    </Badge>
                  </TableCell>
                  <TableCell>{tx.safe?.name}</TableCell>
                  <TableCell>{tx.category?.name ?? "—"}</TableCell>
                  <TableCell>{tx.party?.name ?? "—"}</TableCell>
                  <TableCell>{Number(tx.amount).toLocaleString()}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{tx.description}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.createdBy?.name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={ArrowLeftRight} title={t("noTransactions")} description={t("noTransactionsHint")} />
      )}

      {!isLoading && (transactions?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {tCommon("previous")}
          </Button>
          <span className="text-sm text-muted-foreground">{t("page", { page })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(transactions?.length ?? 0) < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            {tCommon("next")}
          </Button>
        </div>
      )}
    </div>
  );
}
