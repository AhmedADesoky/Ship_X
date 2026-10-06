"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { partyTypeLabel } from "@/components/shared/party-type-picker";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { Users2 } from "lucide-react";

type TypeFilter = "ALL" | "AGENT" | "MERCHANT" | "COURIER";

export default function ClientsPreviewPage() {
  return (
    <RequirePermission>
      <ClientsPreviewPageContent />
    </RequirePermission>
  );
}

// "العملاء" is a read-only account preview over Parties (both Senders and
// Agents) — Client used to be a separate, near-duplicate entity; it has
// been retired in favor of Party, which already carries the real
// transaction ledger, drawings and deferred balances (see parties/[id]).
function ClientsPreviewPageContent() {
  const tNav = useTranslations("nav");
  const tParties = useTranslations("parties");
  const tClients = useTranslations("clients");
  const tCouriers = useTranslations("couriers");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");

  const { data: parties, isLoading: partiesLoading } = useQuery({
    queryKey: ["parties", "ALL"],
    queryFn: () => api.parties.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken && typeFilter !== "COURIER",
  });
  const { data: couriers, isLoading: couriersLoading } = useQuery({
    queryKey: ["couriers"],
    queryFn: () => api.couriers.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken && typeFilter !== "AGENT" && typeFilter !== "MERCHANT",
  });
  // Batch outstanding totals for every courier in one request — same
  // N+1-avoidance pattern already used on /couriers' own list page.
  const { data: courierSummaries } = useQuery({
    queryKey: ["couriers", "summary"],
    queryFn: () => api.couriers.summaryBatch(accessToken ?? undefined),
    enabled: !!accessToken && typeFilter !== "AGENT" && typeFilter !== "MERCHANT",
  });
  const summaryByCourierId = new Map((courierSummaries ?? []).map((s) => [s.courierId, s]));

  const q = search.trim().toLowerCase();
  const filteredParties =
    typeFilter === "COURIER"
      ? []
      : (parties ?? []).filter((party) => {
          if (typeFilter !== "ALL" && party.partyType !== typeFilter) return false;
          if (!q) return true;
          return (
            party.name.toLowerCase().includes(q) ||
            (party.province ?? "").toLowerCase().includes(q) ||
            (party.phone ?? "").toLowerCase().includes(q)
          );
        });
  const filteredCouriers =
    typeFilter === "AGENT" || typeFilter === "MERCHANT"
      ? []
      : (couriers ?? []).filter((courier) => {
          if (!q) return true;
          return courier.name.toLowerCase().includes(q) || (courier.phone ?? "").toLowerCase().includes(q);
        });

  const isLoading = partiesLoading || couriersLoading;
  const hasAnyResults = filteredParties.length > 0 || filteredCouriers.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tNav("clients")} description={tClients("subtitle")} />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={tCommon("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter((v as TypeFilter) ?? "ALL")}>
          <SelectTrigger className="w-fit min-w-40">
            <SelectValue placeholder={tClients("typeFilter")}>
              {typeFilter === "ALL"
                ? tCommon("all")
                : typeFilter === "COURIER"
                  ? tNav("couriers")
                  : partyTypeLabel(typeFilter, tParties)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{tCommon("all")}</SelectItem>
            <SelectItem value="AGENT">{partyTypeLabel("AGENT", tParties)}</SelectItem>
            <SelectItem value="MERCHANT">{partyTypeLabel("MERCHANT", tParties)}</SelectItem>
            <SelectItem value="COURIER">{tNav("couriers")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-3xl" />
          ))}
        </div>
      ) : hasAnyResults ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredParties.map((party) => (
            <Link key={party.id} href={`/parties/${party.id}`}>
              <Card className="glass transition hover:shadow-lg">
                <CardContent className="flex flex-col gap-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-lg font-medium">{party.name}</p>
                    <Badge variant="secondary">{partyTypeLabel(party.partyType, tParties)}</Badge>
                  </div>
                  {party.province && <p className="text-sm text-muted-foreground">{party.province}</p>}
                  {party.phone && <p className="text-sm text-muted-foreground">{party.phone}</p>}
                </CardContent>
              </Card>
            </Link>
          ))}
          {filteredCouriers.map((courier) => {
            const summary = summaryByCourierId.get(courier.id);
            return (
              <Link key={courier.id} href={`/couriers/${courier.id}`}>
                <Card className="glass transition hover:shadow-lg">
                  <CardContent className="flex flex-col gap-2 pt-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-lg font-medium">{courier.name}</p>
                      <Badge variant={courier.active ? "secondary" : "outline"}>
                        {courier.active ? tCouriers("active") : tCouriers("inactive")}
                      </Badge>
                    </div>
                    {courier.phone && <p className="text-sm text-muted-foreground">{courier.phone}</p>}
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{tCouriers("sheetCollectionsTotal")}</span>
                      <span>{(summary?.sheetCollectionsTotal ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{tCouriers("outstandingAdvances")}</span>
                      <span>{(summary?.outstandingAdvances ?? 0).toLocaleString()}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Users2} title={tClients("noClients")} description={tClients("noClientsHint")} />
      )}
    </div>
  );
}
