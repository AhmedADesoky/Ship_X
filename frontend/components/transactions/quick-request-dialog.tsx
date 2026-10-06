"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PartyCombobox } from "@/components/shared/party-combobox";
import { CourierCombobox } from "@/components/shared/courier-combobox";
import { partyTypeLabel } from "@/components/shared/party-type-picker";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { useRouter } from "@/i18n/navigation";
import { cn } from "cn";
import { Plus, X } from "lucide-react";

interface QuickRow {
  key: string;
  safeId: string;
  amount: string;
  description: string;
}

let rowKeyCounter = 0;
const newRow = (): QuickRow => ({
  key: `row-${rowKeyCounter++}`,
  safeId: "",
  amount: "",
  description: "",
});

/**
 * نوع العملية/البند/الجهة are chosen ONCE for the whole batch (not per
 * row) — every operation in a single quick-request shares the same kind,
 * category, and party/courier; only الخزنة and المبلغ differ per
 * operation, one pick each per the "عدد العمليات" count.
 */
export function QuickRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("transactions");
  const tParties = useTranslations("parties");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [kind, setKind] = useState<"IN" | "OUT">("IN");
  const [categoryId, setCategoryId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [courierId, setCourierId] = useState("");
  // "" means "كل الأنواع" (no type filter yet) — set manually, or
  // auto-suggested the moment the chosen category needs a party (see
  // handleCategoryChange below), so it naturally follows whichever عملية
  // type the user is actually entering.
  const [partyTypeFilter, setPartyTypeFilter] = useState("");
  const [rows, setRows] = useState<QuickRow[]>([newRow()]);

  useEffect(() => {
    if (open) {
      setKind("IN");
      setCategoryId("");
      setPartyId("");
      setCourierId("");
      setPartyTypeFilter("");
      setRows([newRow()]);
    }
  }, [open]);

  const { data: parties } = useQuery({
    queryKey: ["parties"],
    queryFn: () => api.parties.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const { data: partyTypes } = useQuery({
    queryKey: ["parties", "types"],
    queryFn: () => api.parties.types(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const filteredParties = useMemo(
    () => (partyTypeFilter ? parties?.filter((p) => p.partyType === partyTypeFilter) : parties),
    [parties, partyTypeFilter],
  );
  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const { data: inCategories } = useQuery({
    queryKey: ["categories", "IN"],
    queryFn: () => api.categories.list("IN", accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const { data: outCategories } = useQuery({
    queryKey: ["categories", "OUT"],
    queryFn: () => api.categories.list("OUT", accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const { data: couriers } = useQuery({
    queryKey: ["couriers"],
    queryFn: () => api.couriers.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken && open,
  });

  const selectedParty = parties?.find((p) => p.id === partyId);
  const categories = (kind === "IN" ? inCategories : outCategories) ?? [];
  const selectedCategory = categories.find((c) => c.id === categoryId);

  // مناديب القاهرة والجيزة sheet collections/advances/repayments are shown
  // here (Phase 27) but can never actually be posted as a batch row — a
  // plain transaction under them never creates the dedicated Couriers
  // module's own ledger rows. Picking one redirects the whole dialog into
  // the proper Couriers flow instead (see handleCategoryChange below).
  // رواسل (MERCHANT_SENDER) is unaffected (Phase 25) — selectable like any
  // other category; the backend rejects the whole batch with a 409 only
  // when the shared party still has open drawings.
  const COURIER_REDIRECT_SYSTEM_KEYS = new Set([
    "COURIER_SHEET_COLLECTION",
    "COURIER_ADVANCE",
    "COURIER_ADVANCE_REPAYMENT",
  ]);

  // True once a category that needs a party is chosen and the shared party
  // is either missing or the wrong type for it.
  const partyMismatch = !!selectedCategory?.partyType && (!selectedParty || selectedParty.partyType !== selectedCategory.partyType);
  const courierMismatch = !!selectedCategory?.requiresCourier && !courierId;

  // Picking a category that needs a party auto-suggests the matching نوع
  // الجهة filter (only while the user hasn't picked one manually yet), so
  // "اختر نوع الجهة" naturally follows whichever عملية type was just
  // entered instead of staying on "كل الأنواع" and showing every party.
  const handleCategoryChange = (newCategoryId: string) => {
    const category = categories.find((c) => c.id === newCategoryId);
    if (category?.systemKey && COURIER_REDIRECT_SYSTEM_KEYS.has(category.systemKey)) {
      onOpenChange(false);
      if (category.systemKey === "COURIER_SHEET_COLLECTION") {
        toast.info(t("courierSheetCollectionRedirect"));
        router.push("/couriers?openHistoricalCollection=1");
      } else if (category.systemKey === "COURIER_ADVANCE") {
        toast.info(t("courierAdvanceRedirect"));
        router.push("/couriers");
      } else {
        toast.info(t("courierRepaymentRedirect"));
        router.push("/couriers");
      }
      return;
    }
    setCategoryId(newCategoryId);
    if (category?.partyType && !partyTypeFilter) {
      setPartyTypeFilter(category.partyType);
    }
  };

  const setRowCount = (count: number) => {
    const n = Math.max(1, Math.min(50, count));
    setRows((prev) => {
      if (n === prev.length) return prev;
      if (n > prev.length) return [...prev, ...Array.from({ length: n - prev.length }, newRow)];
      return prev.slice(0, n);
    });
  };

  const updateRow = (key: string, patch: Partial<QuickRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  const canSubmit =
    !!categoryId &&
    !partyMismatch &&
    !courierMismatch &&
    rows.length > 0 &&
    rows.every((r) => r.safeId && Number(r.amount) > 0);

  const mutation = useMutation({
    mutationFn: () =>
      api.transactions.createBatch(
        {
          partyId: partyId || undefined,
          courierId: courierId || undefined,
          items: rows.map((r) => ({
            kind,
            categoryId,
            safeId: r.safeId,
            amount: Number(r.amount),
            description: r.description || undefined,
          })),
        },
        accessToken ?? undefined,
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["parties"] });
      queryClient.invalidateQueries({ queryKey: ["party-drawings"] });
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
      if (!Array.isArray(result) && result?.queued) {
        toast.info(tCommon("queuedForApproval"));
      } else {
        toast.success(tCommon("success"));
      }
      onOpenChange(false);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409) {
        const payload = (err.body as { message?: { code?: string; partyId?: string; openDrawings?: number } })
          ?.message;
        if (payload?.code === "REQUIRES_SETTLEMENT" && payload.partyId) {
          toast.error(t("senderSettlementRequired", { amount: payload.openDrawings ?? 0 }));
          onOpenChange(false);
          router.push(`/parties/${payload.partyId}?openSettlement=${payload.partyId}`);
          return;
        }
      }
      toast.error(err instanceof ApiError ? err.message : tCommon("error"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{t("quickRequest")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">{t("quickRequestSubtitle")}</p>

          {/* نوع العملية/البند/الجهة — chosen once for the whole batch. */}
          <div className="flex gap-2">
            {(["IN", "OUT"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setCategoryId("");
                }}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-1.5 text-sm transition-colors",
                  kind === k ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted",
                )}
              >
                {k === "IN" ? t("in") : t("out")}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("category")}</Label>
            <Select value={categoryId} onValueChange={(v) => handleCategoryChange(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("category")}>{selectedCategory?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-2 sm:w-48">
              <Label>{t("partyTypeFilter")}</Label>
              <Select
                value={partyTypeFilter || "ALL"}
                onValueChange={(v) => {
                  const next = !v || v === "ALL" ? "" : v;
                  setPartyTypeFilter(next);
                  // Clear the selected party if it no longer matches the
                  // newly chosen type, so a stale mismatched party never
                  // lingers selected underneath a changed filter.
                  if (next && selectedParty && selectedParty.partyType !== next) setPartyId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {partyTypeFilter ? partyTypeLabel(partyTypeFilter, tParties) : tCommon("all")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tCommon("all")}</SelectItem>
                  {(partyTypes ?? []).map((type) => (
                    <SelectItem key={type} value={type}>
                      {partyTypeLabel(type, tParties)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label>{tParties("title")}</Label>
              <PartyCombobox
                parties={filteredParties}
                value={partyId}
                onChange={setPartyId}
                placeholder={tParties("title")}
              />
            </div>
          </div>
          {/* Always reserves the hint's line height (invisible when not
              needed) instead of conditionally mounting it, so picking a
              category/party never shifts the "عدد العمليات" row and
              everything below it up or down — kept OUTSIDE the items-end
              row above so both columns stay the same height and their
              labels/controls line up consistently regardless of whether
              the hint is showing. */}
          <p className={cn("-mt-2 text-xs text-destructive", !partyMismatch && "invisible")}>
            {t("selectPartyHint")}
          </p>

          {!!selectedCategory?.requiresCourier && (
            <div className="flex flex-col gap-2">
              <Label>{t("courier")}</Label>
              <CourierCombobox couriers={couriers} value={courierId} onChange={setCourierId} placeholder={t("courier")} />
              <p className={cn("text-xs text-destructive", !courierMismatch && "invisible")}>
                {t("selectCourierHint")}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Label htmlFor="quick-request-count" className="shrink-0">
              {t("operationsCount")}
            </Label>
            <Input
              id="quick-request-count"
              type="number"
              min={1}
              max={50}
              value={rows.length}
              onChange={(e) => setRowCount(Number(e.target.value) || 1)}
              className="w-20"
            />
          </div>

          {/* Per operation — only الخزنة and المبلغ differ. */}
          <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto scrollbar-hide">
            {rows.map((row, i) => (
              <div key={row.key} className="flex flex-col gap-2 rounded-2xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("operationNumber", { number: i + 1 })}
                  </span>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => removeRow(row.key)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">{t("safe")}</Label>
                    <Select value={row.safeId} onValueChange={(v) => updateRow(row.key, { safeId: v ?? "" })}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("safe")}>
                          {safes?.find((s) => s.id === row.safeId)?.name}
                        </SelectValue>
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
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">{t("amount")}</Label>
                    <AmountInput value={row.amount} onChange={(v) => updateRow(row.key, { amount: v })} />
                  </div>
                </div>

                <Input
                  placeholder={t("description")}
                  value={row.description}
                  onChange={(e) => updateRow(row.key, { description: e.target.value })}
                />
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" className="gap-2" onClick={() => setRowCount(rows.length + 1)}>
            <Plus className="size-4" />
            {t("addRow")}
          </Button>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !canSubmit}>
              {t("submitQuickRequest")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
