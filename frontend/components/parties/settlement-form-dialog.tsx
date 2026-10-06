"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PartyCombobox } from "@/components/shared/party-combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type Party, type SettlementApplicationMode } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { cn } from "cn";

const MODES: SettlementApplicationMode[] = ["ALL", "CUSTOM_TOTAL", "SPECIFIC", "NONE"];

export function SettlementFormDialog({
  open,
  onOpenChange,
  party,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled when opened from a party's own page; omitted when opened
   * from the standalone مسحوبات list, where the user picks the sender. */
  party?: Party;
}) {
  const t = useTranslations("parties");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [selectedPartyId, setSelectedPartyId] = useState(party?.id ?? "");
  const [safeId, setSafeId] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<SettlementApplicationMode>("ALL");
  const [customTotal, setCustomTotal] = useState("");
  const [specificAmounts, setSpecificAmounts] = useState<Record<string, string>>({});
  const [specificSelected, setSpecificSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) setSelectedPartyId(party?.id ?? "");
  }, [open, party?.id]);

  const { data: parties } = useQuery({
    queryKey: ["parties", "MERCHANT"],
    queryFn: () => api.parties.list("MERCHANT", undefined, accessToken ?? undefined),
    enabled: !!accessToken && open && !party,
  });

  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });

  const { data: drawings, isLoading: drawingsLoading } = useQuery({
    queryKey: ["party-drawings", selectedPartyId],
    queryFn: () => api.parties.drawings(selectedPartyId, accessToken ?? undefined),
    enabled: !!accessToken && open && !!selectedPartyId,
  });

  const outstanding = useMemo(() => (drawings ?? []).filter((d) => d.remaining > 0), [drawings]);
  const totalOutstanding = useMemo(() => outstanding.reduce((sum, d) => sum + d.remaining, 0), [outstanding]);

  // Live client-side estimate only — the server recomputes and is the
  // actual source of truth for what gets posted.
  const liveApplied = useMemo(() => {
    const gross = Number(grossAmount) || 0;
    if (mode === "NONE") return 0;
    if (mode === "ALL") return Math.min(totalOutstanding, gross);
    if (mode === "CUSTOM_TOTAL") return Math.min(Number(customTotal) || 0, totalOutstanding, gross);
    if (mode === "SPECIFIC") {
      return outstanding.reduce((sum, d) => {
        if (!specificSelected[d.id]) return sum;
        const amt = Number(specificAmounts[d.id] ?? d.remaining) || 0;
        return sum + Math.min(amt, d.remaining);
      }, 0);
    }
    return 0;
  }, [mode, grossAmount, customTotal, outstanding, specificSelected, specificAmounts, totalOutstanding]);

  const liveNet = Math.max(0, (Number(grossAmount) || 0) - liveApplied);

  const reset = () => {
    setSafeId("");
    setGrossAmount("");
    setNote("");
    setMode("ALL");
    setCustomTotal("");
    setSpecificAmounts({});
    setSpecificSelected({});
    if (!party) setSelectedPartyId("");
  };

  const mutation = useMutation({
    mutationFn: () => {
      const dto: Parameters<typeof api.parties.createSettlement>[1] = {
        safeId,
        grossAmount: Number(grossAmount),
        note: note || undefined,
        applicationMode: mode,
        clientRequestId: crypto.randomUUID(),
      };
      if (mode === "CUSTOM_TOTAL") dto.customTotal = Number(customTotal);
      if (mode === "SPECIFIC") {
        dto.specificApplications = outstanding
          .filter((d) => specificSelected[d.id])
          .map((d) => ({ drawingId: d.id, amount: Number(specificAmounts[d.id] ?? d.remaining) }));
      }
      return api.parties.createSettlement(selectedPartyId, dto, accessToken ?? undefined);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["party-drawings", selectedPartyId] });
      queryClient.invalidateQueries({ queryKey: ["party-drawings"] });
      queryClient.invalidateQueries({ queryKey: ["parties", selectedPartyId, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["party-settlements", selectedPartyId] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
      if (result?.queued) {
        toast.info(tCommon("queuedForApproval"));
      } else {
        toast.success(tCommon("success"));
        (result?.warnings ?? []).forEach((w) => toast.info(w));
      }
      onOpenChange(false);
      reset();
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{t("settlement")}</DialogTitle>
        </DialogHeader>
        {selectedPartyId && !drawingsLoading && totalOutstanding > 0 && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            {t("openDrawingsBanner", { amount: totalOutstanding.toLocaleString() })}
          </p>
        )}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {!party && (
            <div className="flex flex-col gap-2">
              <Label>{t("merchants")}</Label>
              <PartyCombobox parties={parties} value={selectedPartyId} onChange={setSelectedPartyId} placeholder={t("merchants")} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>{t("safe")}</Label>
            <Select value={safeId} onValueChange={(v) => setSafeId(v ?? "")}>
              <SelectTrigger className="w-full"><SelectValue placeholder="—">{safes?.find((s) => s.id === safeId)?.name}</SelectValue></SelectTrigger>
              <SelectContent>
                {safes?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="settlement-gross">{t("grossAmount")}</Label>
            <AmountInput id="settlement-gross" required value={grossAmount} onChange={setGrossAmount} />
          </div>

          {selectedPartyId && !drawingsLoading && totalOutstanding > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                {t("outstandingWithdrawals")}: {totalOutstanding.toLocaleString()}
              </p>

              <div className="flex flex-col gap-2">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2 text-start text-sm transition-colors",
                      mode === m ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block size-3.5 shrink-0 rounded-full border",
                        mode === m ? "border-primary bg-primary" : "border-muted-foreground",
                      )}
                    />
                    {t(`applyMode.${m}`)}
                  </button>
                ))}
              </div>

              {mode === "CUSTOM_TOTAL" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="settlement-custom-total">{t("applyCustomAmount")}</Label>
                  <AmountInput id="settlement-custom-total" value={customTotal} onChange={setCustomTotal} />
                </div>
              )}

              {mode === "SPECIFIC" && (
                <div className="flex flex-col gap-2 rounded-xl border border-border p-2">
                  {outstanding.map((d) => (
                    <div key={d.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={!!specificSelected[d.id]}
                        onCheckedChange={(checked) =>
                          setSpecificSelected((prev) => ({ ...prev, [d.id]: !!checked }))
                        }
                      />
                      <span className="flex-1 text-sm text-muted-foreground">
                        {new Date(d.date).toLocaleDateString()} — {d.remaining.toLocaleString()}
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        disabled={!specificSelected[d.id]}
                        value={specificAmounts[d.id] ?? String(d.remaining)}
                        onChange={(e) =>
                          setSpecificAmounts((prev) => ({ ...prev, [d.id]: e.target.value }))
                        }
                        className="w-28"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedPartyId && drawingsLoading && <Skeleton className="h-10 w-full rounded-xl" />}

          <div className="flex flex-col gap-2">
            <Label htmlFor="settlement-note">{t("note")}</Label>
            <Input id="settlement-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1 rounded-2xl border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between"><span>{t("grossAmount")}</span><span>{(Number(grossAmount) || 0).toLocaleString()}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>{t("applied")}</span><span>-{liveApplied.toLocaleString()}</span></div>
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>{t("netCashPaid")}</span><span>{liveNet.toLocaleString()}</span></div>
          </div>

          {Number(grossAmount) > 0 && liveNet === 0 && liveApplied > 0 && (
            <p className="text-sm text-muted-foreground">{t("settlementFullyCovered")}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !selectedPartyId || !safeId || !grossAmount}>
              {t("settlement")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
