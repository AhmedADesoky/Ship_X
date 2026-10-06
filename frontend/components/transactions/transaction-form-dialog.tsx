"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PartyCombobox } from "@/components/shared/party-combobox";
import { CourierCombobox, UNASSIGNED_COURIER as UNASSIGNED } from "@/components/shared/courier-combobox";
import {
  api,
  ApiError,
  type CourierAdvance,
  type CourierSheetCollection,
  type Transaction,
} from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { useRouter } from "@/i18n/navigation";

export interface TransactionFormPreset {
  categoryName?: string;
  partyId?: string;
  amount?: number;
  safeId?: string;
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  kind,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "IN" | "OUT";
  preset?: TransactionFormPreset;
}) {
  const t = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [safeId, setSafeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [courierId, setCourierId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNo, setReferenceNo] = useState("");

  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  const { data: rawCategories } = useQuery({
    queryKey: ["categories", kind],
    queryFn: () => api.categories.list(kind, accessToken ?? undefined),
    enabled: !!accessToken && open,
  });
  // توريد سلفة مناديب (repayment) always redirects to the courier's own
  // account page — a repayment must be applied against a specific open
  // advance on that courier, which only RepayAdvanceDialog (opened from
  // /couriers/:id) can offer. تحصيل شيتات مناديب القاهرة والجيزة (sheet
  // collection) and سلفة مناديب (advance) are now (Phase 30) fillable
  // and submittable directly from this dialog instead — see
  // isCourierSheetCollection/isCourierAdvance below, which post through
  // the real dedicated Couriers endpoints rather than a plain transaction.
  const COURIER_REPAYMENT_REDIRECT_SYSTEM_KEYS = new Set(["COURIER_ADVANCE_REPAYMENT"]);
  const categories = rawCategories;
  const selectedCategory = categories?.find((c) => c.id === categoryId);
  const partyType = selectedCategory?.partyType ?? undefined;
  const isCourierSheetCollection = selectedCategory?.systemKey === "COURIER_SHEET_COLLECTION";
  const isCourierAdvance = selectedCategory?.systemKey === "COURIER_ADVANCE";

  const { data: parties } = useQuery({
    queryKey: ["parties", partyType],
    queryFn: () => api.parties.list(partyType as "AGENT" | "MERCHANT", undefined, accessToken ?? undefined),
    enabled: !!accessToken && open && !!partyType,
  });

  const requiresCourier = !!selectedCategory?.requiresCourier;
  const showCourierField = requiresCourier || isCourierSheetCollection || isCourierAdvance;
  const { data: couriers } = useQuery({
    queryKey: ["couriers"],
    queryFn: () => api.couriers.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken && open && showCourierField,
  });

  // Apply presets once the category list has loaded, so we can resolve
  // `preset.categoryName` to an actual categoryId.
  useEffect(() => {
    if (!open || !preset || !categories) return;
    if (preset.categoryName) {
      const match = categories.find((c) => c.name === preset.categoryName);
      if (match) setCategoryId(match.id);
    }
    if (preset.safeId) setSafeId(preset.safeId);
    if (preset.amount !== undefined) setAmount(String(preset.amount));
    // partyId is applied in a separate effect once the matching party list
    // (gated on partyType, which depends on the category resolved above)
    // has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, categories]);

  useEffect(() => {
    if (!open || !preset?.partyId || !parties) return;
    if (parties.some((p) => p.id === preset.partyId)) setPartyId(preset.partyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset?.partyId, parties]);

  // Intercepts a توريد سلفة مناديب (repayment) pick before it ever becomes
  // the committed selection — redirects into the courier's own account
  // page instead, since a repayment must be applied against a specific
  // open advance there. Sheet-collection/advance fall through to a normal
  // commit — their own fields render below instead of a redirect.
  const handleCategoryChange = (categoryId: string) => {
    const category = categories?.find((c) => c.id === categoryId);
    if (category?.systemKey && COURIER_REPAYMENT_REDIRECT_SYSTEM_KEYS.has(category.systemKey)) {
      onOpenChange(false);
      toast.info(t("courierRepaymentRedirect"));
      router.push("/couriers");
      return;
    }
    setCategoryId(categoryId);
    setPartyId("");
    // تقفيلة شيت submitted inline from here must always be tied to a real
    // courier (Phase 34b) — "غير محدد" stays available only via the
    // dedicated "تحصيل تاريخي" button on /couriers, for genuinely
    // historical/pre-system data, not as a default shortcut here.
    setCourierId("");
  };

  const mutation = useMutation<CourierSheetCollection | CourierAdvance | Transaction, Error, void>({
    mutationFn: () => {
      if (isCourierSheetCollection) {
        return api.couriers.addSheetCollection(
          {
            courierId: courierId === UNASSIGNED || !courierId ? null : courierId,
            safeId,
            amount: Number(amount),
            note: description || undefined,
            source: "INCOME_PAGE",
          },
          accessToken ?? undefined,
        );
      }
      if (isCourierAdvance) {
        return api.couriers.addAdvance(
          courierId,
          { safeId, amount: Number(amount), note: description || undefined },
          accessToken ?? undefined,
        );
      }
      return api.transactions.create(
        {
          kind,
          amount: Number(amount),
          safeId,
          categoryId: categoryId || undefined,
          partyId: partyType ? partyId || undefined : undefined,
          courierId: requiresCourier ? courierId || undefined : undefined,
          description: description || undefined,
          referenceNo: referenceNo || undefined,
        },
        accessToken ?? undefined,
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["parties"] });
      queryClient.invalidateQueries({ queryKey: ["party-drawings"] });
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      if (result && typeof result === "object" && (result as any).queued) {
        toast.info(tCommon("queuedForApproval"));
      } else {
        toast.success(tCommon("success"));
      }
      onOpenChange(false);
      setSafeId("");
      setCategoryId("");
      setPartyId("");
      setCourierId("");
      setAmount("");
      setDescription("");
      setReferenceNo("");
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
          <DialogTitle>{kind === "IN" ? t("addIncome") : t("addExpense")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label>{t("safe")}</Label>
            <Select value={safeId} onValueChange={(v) => setSafeId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder={t("safe")}>{safes?.find((s) => s.id === safeId)?.name}</SelectValue>
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
            <Label>{t("category")}</Label>
            <Select value={categoryId} onValueChange={(v) => handleCategoryChange(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder={t("category")}>{categories?.find((c) => c.id === categoryId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {partyType && (
            <div className="flex flex-col gap-2">
              <Label>{t("party")}</Label>
              <PartyCombobox parties={parties} value={partyId} onChange={setPartyId} placeholder={t("party")} />
            </div>
          )}
          {showCourierField && (
            <div className="flex flex-col gap-2">
              <Label>{t("courier")}</Label>
              <CourierCombobox
                couriers={couriers}
                value={courierId}
                onChange={(v) => setCourierId(v)}
                placeholder={t("courier")}
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="tx-amount">{t("amount")}</Label>
            <AmountInput id="tx-amount" required value={amount} onChange={setAmount} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tx-description">{t("description")}</Label>
            <Textarea id="tx-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {!isCourierSheetCollection && !isCourierAdvance && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-ref">{t("referenceNo")}</Label>
              <Input id="tx-ref" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                !safeId ||
                !categoryId ||
                ((requiresCourier || isCourierAdvance || isCourierSheetCollection) && !courierId)
              }
            >
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
