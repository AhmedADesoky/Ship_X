"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, type Courier } from "@/lib/api-client";
import { useSession } from "@/lib/session";

const UNASSIGNED = "__unassigned__";

export function AddSheetCollectionDialog({
  open,
  onOpenChange,
  courier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fills and locks the courier when opened from a courier's own page. */
  courier?: Courier;
}) {
  const t = useTranslations("couriers");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [courierId, setCourierId] = useState(courier?.id ?? UNASSIGNED);
  const [safeId, setSafeId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setCourierId(courier?.id ?? UNASSIGNED);
      setSafeId("");
      setAmount("");
      setNote("");
    }
  }, [open, courier]);

  const { data: couriers } = useQuery({
    queryKey: ["couriers"],
    queryFn: () => api.couriers.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken && open && !courier,
  });
  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.couriers.addSheetCollection(
        {
          courierId: courierId === UNASSIGNED ? null : courierId,
          safeId,
          amount: Number(amount),
          note: note || undefined,
          source: "COURIER_PAGE",
        },
        accessToken ?? undefined,
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (result && !("amount" in result) && (result as any)?.queued) {
        toast.info(tCommon("queuedForApproval"));
      } else {
        toast.success(tCommon("success"));
      }
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{t("sheetCollection.add")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {!courier && (
            <div className="flex flex-col gap-2">
              <Label>{t("sheetCollection.courier")}</Label>
              <Select value={courierId} onValueChange={(v) => setCourierId(v ?? UNASSIGNED)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {courierId === UNASSIGNED
                      ? t("unassigned")
                      : couriers?.find((c) => c.id === courierId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("unassigned")}</SelectItem>
                  {couriers?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {courierId === UNASSIGNED && <p className="text-xs text-muted-foreground">{t("unassignedHint")}</p>}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>{t("sheetCollection.safe")}</Label>
            <Select value={safeId} onValueChange={(v) => setSafeId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="—">{safes?.find((s) => s.id === safeId)?.name}</SelectValue>
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="sheet-amount">{t("sheetCollection.amount")}</Label>
            <AmountInput id="sheet-amount" required value={amount} onChange={setAmount} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sheet-note">{t("sheetCollection.note")}</Label>
            <Input id="sheet-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !safeId || !amount}>
              {t("sheetCollection.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
