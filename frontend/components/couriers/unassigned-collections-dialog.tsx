"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CourierCombobox } from "@/components/shared/courier-combobox";
import { api, ApiError, type CourierSheetCollection } from "@/lib/api-client";
import { useSession } from "@/lib/session";

/**
 * Review + reassign-to-courier flow for تقفيلات الشيتات غير المرتبطة بمندوب
 * (Phase 35) — lists every CourierSheetCollection with courierId: null
 * (historical entries, or ones backfilled from pre-fix orphaned
 * transactions) and lets an admin attach each to the correct courier after
 * the fact. Pure metadata correction — the underlying Transaction is never
 * touched.
 */
export function UnassignedCollectionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("couriers");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [pickedCourierId, setPickedCourierId] = useState("");

  const { data: unassigned, isLoading } = useQuery({
    queryKey: ["couriers", "sheet-collections", "unassigned"],
    queryFn: () => api.couriers.listUnassignedSheetCollections(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const { data: couriers } = useQuery({
    queryKey: ["couriers"],
    queryFn: () => api.couriers.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken && open,
  });

  const assignMutation = useMutation({
    mutationFn: ({ collectionId, courierId }: { collectionId: string; courierId: string }) =>
      api.couriers.assignSheetCollection(collectionId, courierId, accessToken ?? undefined),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (result && (result as any)?.queued) {
        toast.info(tCommon("queuedForApproval"));
      } else {
        toast.success(tCommon("success"));
      }
      setAssigningId(null);
      setPickedCourierId("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("unassignedCollections.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {isLoading ? (
            <>
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </>
          ) : unassigned && unassigned.length > 0 ? (
            unassigned.map((row: CourierSheetCollection) => (
              <div key={row.id} className="flex flex-col gap-2 rounded-2xl border border-border p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{Number(row.amount).toLocaleString()}</span>
                  <span className="text-muted-foreground">{new Date(row.date).toLocaleDateString()}</span>
                </div>
                {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
                {assigningId === row.id ? (
                  <div className="flex flex-col gap-2">
                    <CourierCombobox
                      couriers={couriers}
                      value={pickedCourierId}
                      onChange={setPickedCourierId}
                      placeholder={t("sheetCollection.courier")}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAssigningId(null);
                          setPickedCourierId("");
                        }}
                      >
                        {tCommon("cancel")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!pickedCourierId || assignMutation.isPending}
                        onClick={() => assignMutation.mutate({ collectionId: row.id, courierId: pickedCourierId })}
                      >
                        {t("unassignedCollections.assign")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="self-start" onClick={() => setAssigningId(row.id)}>
                    {t("unassignedCollections.assign")}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("unassignedCollections.empty")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
