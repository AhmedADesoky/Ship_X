"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/layout/require-permission";
import { api, type Transaction } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { useFlowTrail } from "@/lib/flow-trail";
import { Search } from "lucide-react";

export default function CategoryDetailPage() {
  return (
    <RequirePermission>
      <CategoryDetailPageContent />
    </RequirePermission>
  );
}

function CategoryDetailPageContent() {
  const params = useParams<{ id: string }>();
  const t = useTranslations("categories");
  const tTx = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const { setCurrentLabel } = useFlowTrail();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["categories", params.id, "summary"],
    queryFn: () => api.categories.summary(params.id, accessToken ?? undefined) as any,
    enabled: !!accessToken && !!params.id,
  });

  useEffect(() => {
    if (data?.category?.name) setCurrentLabel(data.category.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.category?.name]);

  const filteredTransactions = useMemo(() => {
    const list: Transaction[] = data?.transactions ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((tx) => {
      const description = tx.description?.toLowerCase() ?? "";
      const partyName = tx.party?.name?.toLowerCase() ?? "";
      return description.includes(q) || partyName.includes(q);
    });
  }, [data?.transactions, query]);

  if (isLoading || !data) {
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
        title={data.category.name}
        description={data.category.kind === "IN" ? t("in") : t("out")}
        backHref={data.category.kind === "IN" ? "/income" : "/expenses"}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("total")}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{Number(data.total).toLocaleString()}</CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("count")}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{data.count}</CardContent>
        </Card>
      </div>

      <Card className="glass">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{tTx("title")}</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tCommon("search")}
              className="ps-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tTx("date")}</TableHead>
                <TableHead>{tTx("safe")}</TableHead>
                <TableHead>{tTx("party")}</TableHead>
                <TableHead>{tTx("amount")}</TableHead>
                <TableHead>{tTx("description")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.map((tx: any) => (
                <TableRow key={tx.id}>
                  <TableCell>{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>{tx.safe?.name}</TableCell>
                  <TableCell>{tx.party?.name ?? "—"}</TableCell>
                  <TableCell>{Number(tx.amount).toLocaleString()}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{tx.description}</TableCell>
                </TableRow>
              ))}
              {filteredTransactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {tTx("noTransactions")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
