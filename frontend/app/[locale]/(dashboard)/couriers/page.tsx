"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { AddCourierDialog } from "@/components/couriers/add-courier-dialog";
import { AddSheetCollectionDialog } from "@/components/couriers/add-sheet-collection-dialog";
import { UnassignedCollectionsDialog } from "@/components/couriers/unassigned-collections-dialog";
import { api, ApiError, type Courier } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { Plus, Bike, Receipt, MoreVertical } from "lucide-react";

export default function CouriersPage() {
  return (
    <RequirePermission>
      <CouriersPageContent />
    </RequirePermission>
  );
}

function CouriersPageContent() {
  const t = useTranslations("couriers");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const canManageCouriers = usePermission("manage_couriers");
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [addCourierOpen, setAddCourierOpen] = useState(false);
  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [editCourier, setEditCourier] = useState<Courier | null>(null);
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  const { data: unassignedCollections } = useQuery({
    queryKey: ["couriers", "sheet-collections", "unassigned"],
    queryFn: () => api.couriers.listUnassignedSheetCollections(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  // Deep-link support: picking a courier sheet-collection category from the
  // generic Add Income dialog redirects here with
  // ?openHistoricalCollection=1, auto-opening the same unassigned/historical
  // collection dialog this page's own button opens — same one-shot
  // useRef-guarded pattern as the party detail page's ?openSettlement=.
  const autoOpenedHistorical = useRef(false);
  useEffect(() => {
    if (autoOpenedHistorical.current) return;
    if (searchParams.get("openHistoricalCollection") === "1") {
      autoOpenedHistorical.current = true;
      setHistoricalOpen(true);
    }
  }, [searchParams]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.couriers.remove(id, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const { data: couriers, isLoading } = useQuery({
    queryKey: ["couriers", search, statusFilter],
    queryFn: () => api.couriers.list(search || undefined, statusFilter || undefined, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const { data: summaries } = useQuery({
    queryKey: ["couriers", "summary"],
    queryFn: () => api.couriers.summaryBatch(accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const summaryByCourier = useMemo(() => new Map((summaries ?? []).map((s) => [s.courierId, s])), [summaries]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          canManageCouriers && (
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" onClick={() => setHistoricalOpen(true)}>
                <Receipt className="size-4" />
                {t("historicalCollection")}
              </Button>
              <Button className="gap-2" onClick={() => setAddCourierOpen(true)}>
                <Plus className="size-4" />
                {t("addCourier")}
              </Button>
            </div>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={tCommon("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(!v || v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-fit min-w-40">
            <SelectValue>
              {statusFilter === "active" ? t("active") : statusFilter === "inactive" ? t("inactive") : tCommon("all")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{tCommon("all")}</SelectItem>
            <SelectItem value="active">{t("active")}</SelectItem>
            <SelectItem value="inactive">{t("inactive")}</SelectItem>
          </SelectContent>
        </Select>
        {unassignedCollections && unassignedCollections.length > 0 && (
          <Button variant="outline" className="gap-2" onClick={() => setUnassignedOpen(true)}>
            <Receipt className="size-4" />
            {t("unassignedCollections.button", { count: unassignedCollections.length })}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-3xl" />
          ))}
        </div>
      ) : couriers && couriers.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {couriers.map((courier) => {
            const summary = summaryByCourier.get(courier.id);
            return (
              <Card key={courier.id} className="glass transition hover:shadow-lg">
                <CardContent className="flex flex-col gap-2 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/couriers/${courier.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-lg font-medium">{courier.name}</p>
                      {courier.phone && <p className="text-sm text-muted-foreground">{courier.phone}</p>}
                    </Link>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant={courier.active ? "secondary" : "outline"}>
                        {courier.active ? t("active") : t("inactive")}
                      </Badge>
                      {canManageCouriers && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" className="size-8 shrink-0">
                                <MoreVertical className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditCourier(courier)}>{tCommon("edit")}</DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                if (confirm(tCommon("confirmDelete"))) deleteMutation.mutate(courier.id);
                              }}
                            >
                              {tCommon("delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  <Link href={`/couriers/${courier.id}`}>
                    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{t("sheetCollectionsTotal")}</span>
                        <span className="font-medium">{(summary?.sheetCollectionsTotal ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{t("outstandingAdvances")}</span>
                        <span className="font-medium">{(summary?.outstandingAdvances ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Bike}
          title={t("noCouriers")}
          description={t("noCouriersHint")}
          action={
            canManageCouriers && (
              <Button onClick={() => setAddCourierOpen(true)} className="mt-2 gap-2">
                <Plus className="size-4" />
                {t("addCourier")}
              </Button>
            )
          }
        />
      )}

      <AddCourierDialog open={addCourierOpen} onOpenChange={setAddCourierOpen} />
      <AddCourierDialog
        open={!!editCourier}
        onOpenChange={(o) => {
          if (!o) setEditCourier(null);
        }}
        courier={editCourier ?? undefined}
      />
      <AddSheetCollectionDialog open={historicalOpen} onOpenChange={setHistoricalOpen} />
      <UnassignedCollectionsDialog open={unassignedOpen} onOpenChange={setUnassignedOpen} />
    </div>
  );
}
