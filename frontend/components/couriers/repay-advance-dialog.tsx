"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, type CourierAdvance } from "@/lib/api-client";
import { useSession } from "@/lib/session";

export function RepayAdvanceDialog({
  open,
  onOpenChange,
  courierId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierId: string;
}) {
  const t = useTranslations("couriers");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [advanceId, setAdvanceId] = useState("");
  const [safeId, setSafeId] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open) {
      setAdvanceId("");
      setSafeId("");
      setAmount("");
    }
  }, [open]);

  const { data: advances } = useQuery({
    queryKey: ["couriers", courierId, "advances"],
    queryFn: () => api.couriers.advances(courierId, accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const openAdvances = useMemo(
    () => (advances ?? []).filter((a) => a.status !== "FULLY_REPAID"),
    [advances],
  );
  const selectedAdvance = openAdvances.find((a) => a.id === advanceId);
  const remaining = selectedAdvance ? Number(selectedAdvance.remainingAmount) : 0;
  const exceedsRemaining = !!selectedAdvance && Number(amount) > remaining + 0.005;

  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.couriers.addRepayment(
        courierId,
        advanceId,
        { advanceId, safeId, amount: Number(amount) },
        accessToken ?? undefined,
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (result && !("repayment" in result) && (result as any)?.queued) {
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
          <DialogTitle>{t("repayment.add")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label>{t("repayment.selectAdvance")}</Label>
            <Select value={advanceId} onValueChange={(v) => setAdvanceId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="—">
                  {selectedAdvance ? `${Number(selectedAdvance.originalAmount).toLocaleString()} — ${remaining.toLocaleString()} ${t("advance.remaining")}` : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {openAdvances.map((a: CourierAdvance) => (
                  <SelectItem key={a.id} value={a.id}>
                    {Number(a.originalAmount).toLocaleString()} — {Number(a.remainingAmount).toLocaleString()} {t("advance.remaining")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedAdvance && (
            <p className="text-sm text-muted-foreground">
              {t("advance.remaining")}: {remaining.toLocaleString()}
            </p>
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
            <Label htmlFor="repayment-amount">{t("repayment.amount")}</Label>
            <AmountInput id="repayment-amount" required value={amount} onChange={setAmount} />
            {exceedsRemaining && <p className="text-xs text-destructive">{t("repayment.exceedsRemaining")}</p>}
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={mutation.isPending || !advanceId || !safeId || !amount || exceedsRemaining}
            >
              {t("repayment.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
