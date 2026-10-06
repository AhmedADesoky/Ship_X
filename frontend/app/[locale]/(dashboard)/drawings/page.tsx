"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { PartyCombobox } from "@/components/shared/party-combobox";
import { SettlementFormDialog } from "@/components/parties/settlement-form-dialog";
import { api, ApiError, type Party } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { Plus, Wallet } from "lucide-react";

export default function DrawingsPage() {
  return (
    <RequirePermission>
      <DrawingsPageContent />
    </RequirePermission>
  );
}

type SortKey = "outstanding" | "name" | "lastDate" | "count";

// مسحوبات — tied to الرواسل (MERCHANT parties). Company-wide view: every
// merchant/sender party, sorted outstanding-first by default, with a quick
// way to log a new drawing or settle one against any of them.
function DrawingsPageContent() {
  const tNav = useTranslations("nav");
  const t = useTranslations("parties");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const canManageParties = usePermission("manage_parties");
  const [open, setOpen] = useState(false);
  const [partyId, setPartyId] = useState("");
  const [safeId, setSafeId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [settlementParty, setSettlementParty] = useState<Party | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("outstanding");

  const { data: parties, isLoading } = useQuery({
    queryKey: ["parties", "MERCHANT"],
    queryFn: () => api.parties.list("MERCHANT", undefined, accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken && open,
  });

  // One batch request for every MERCHANT party's outstanding total — the
  // real figure (not just "most recent drawing"), replacing the former
  // per-party N+1 fetch.
  const { data: outstandingSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["party-drawings", "outstanding-summary", "MERCHANT"],
    queryFn: () => api.parties.outstandingSummary("MERCHANT", accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const summaryByParty = useMemo(
    () => new Map((outstandingSummary ?? []).map((s) => [s.partyId, s])),
    [outstandingSummary],
  );

  const filteredParties = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (parties ?? []).filter(
      (party) => !q || party.name.toLowerCase().includes(q) || (party.province ?? "").toLowerCase().includes(q),
    );
    return [...filtered].sort((a, b) => {
      const sa = summaryByParty.get(a.id);
      const sb = summaryByParty.get(b.id);
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "count") return (sb?.count ?? 0) - (sa?.count ?? 0);
      if (sortKey === "lastDate") {
        const da = sa?.lastDate ? new Date(sa.lastDate).getTime() : 0;
        const db = sb?.lastDate ? new Date(sb.lastDate).getTime() : 0;
        return db - da;
      }
      // outstanding (default): senders with an outstanding balance first.
      return (sb?.outstandingTotal ?? 0) - (sa?.outstandingTotal ?? 0);
    });
  }, [parties, search, sortKey, summaryByParty]);

  const addDrawing = useMutation({
    mutationFn: () =>
      api.parties.addDrawing(partyId, { safeId, amount: Number(amount), note: note || undefined }, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["party-drawings"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      setOpen(false);
      setPartyId("");
      setSafeId("");
      setAmount("");
      setNote("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tNav("drawings")}
        description={t("drawingsPageSubtitle")}
        action={
          canManageParties && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="gap-2"><Plus className="size-4" />{t("addDrawing")}</Button>} />
            <DialogContent className="glass">
              <DialogHeader>
                <DialogTitle>{t("addDrawing")}</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  addDrawing.mutate();
                }}
              >
                <div className="flex flex-col gap-2">
                  <Label>{t("merchants")}</Label>
                  <PartyCombobox parties={parties} value={partyId} onChange={setPartyId} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("safe")}</Label>
                  <Select value={safeId} onValueChange={(v) => setSafeId(v ?? "")}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="—">{safes?.find((s) => s.id === safeId)?.name}</SelectValue></SelectTrigger>
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
                  <Label htmlFor="drawing-amount">{t("originalAmount")}</Label>
                  <AmountInput id="drawing-amount" required value={amount} onChange={setAmount} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="drawing-note">{t("note")}</Label>
                  <Input id="drawing-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={addDrawing.isPending || !partyId || !safeId}>
                    {t("addDrawing")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
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
        <Select value={sortKey} onValueChange={(v) => setSortKey((v as SortKey) ?? "outstanding")}>
          <SelectTrigger className="w-fit min-w-48"><SelectValue>{tCommon(`sortBy.${sortKey}`)}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="outstanding">{tCommon("sortBy.outstanding")}</SelectItem>
            <SelectItem value="name">{tCommon("sortBy.name")}</SelectItem>
            <SelectItem value="lastDate">{tCommon("sortBy.lastDate")}</SelectItem>
            <SelectItem value="count">{tCommon("sortBy.count")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading || summaryLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-3xl" />
          ))}
        </div>
      ) : filteredParties.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredParties.map((party) => {
            const summary = summaryByParty.get(party.id);
            return (
              <Card key={party.id} className="glass transition hover:shadow-lg">
                <CardContent className="pt-6">
                  <Link href={`/parties/${party.id}`}>
                    <p className="truncate text-lg font-medium">{party.name}</p>
                    {party.province && <p className="text-sm text-muted-foreground">{party.province}</p>}
                  </Link>
                  <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
                    {summary && summary.outstandingTotal > 0 ? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{t("outstandingWithdrawals")}</span>
                          <span className="font-medium">{summary.outstandingTotal.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{t("withdrawalsCount")}</span>
                          <span>{summary.count}</span>
                        </div>
                        {summary.lastDate && (
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{t("lastWithdrawalDate")}</span>
                            <span>{new Date(summary.lastDate).toLocaleDateString()}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("noDrawingsYet")}</span>
                    )}
                  </div>
                  {canManageParties && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full gap-2"
                      onClick={() => setSettlementParty(party)}
                    >
                      <Wallet className="size-3.5" />
                      {t("settlement")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Wallet} title={t("noParties")} description={t("noPartiesHint")} />
      )}

      <SettlementFormDialog
        open={!!settlementParty}
        onOpenChange={(o) => !o && setSettlementParty(null)}
        party={settlementParty ?? undefined}
      />
    </div>
  );
}
