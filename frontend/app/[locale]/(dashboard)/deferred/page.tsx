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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { PartyCombobox } from "@/components/shared/party-combobox";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { Plus, Receipt } from "lucide-react";

export default function DeferredPage() {
  return (
    <RequirePermission>
      <DeferredPageContent />
    </RequirePermission>
  );
}

// آجل — tied to وكلاء المحافظات (AGENT parties). Company-wide view: every
// agent party and a quick way to open a new deferred balance for any of
// them, without drilling into that party's own detail page first.
function DeferredPageContent() {
  const tNav = useTranslations("nav");
  const t = useTranslations("parties");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const canManageParties = usePermission("manage_parties");
  const [open, setOpen] = useState(false);
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [search, setSearch] = useState("");

  const { data: parties, isLoading } = useQuery({
    queryKey: ["parties", "AGENT"],
    queryFn: () => api.parties.list("AGENT", undefined, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const filteredParties = parties?.filter((party) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return party.name.toLowerCase().includes(q) || (party.province ?? "").toLowerCase().includes(q);
  });

  // One batch request for every AGENT party's real outstanding آجل total —
  // replaces the former per-party N+1 fetch that only ever showed the
  // most recent entry's ORIGINAL amount, never what's actually still owed.
  const { data: outstandingSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["party-deferred", "outstanding-summary", "AGENT"],
    queryFn: () => api.parties.deferredOutstandingSummary("AGENT", accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const summaryByParty = useMemo(
    () => new Map((outstandingSummary ?? []).map((s) => [s.partyId, s])),
    [outstandingSummary],
  );

  const addDeferred = useMutation({
    mutationFn: () => api.parties.addDeferred(partyId, { originalAmount: Number(amount) }, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["party-deferred"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      setOpen(false);
      setPartyId("");
      setAmount("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tNav("deferred")}
        description={t("deferredPageSubtitle")}
        action={
          canManageParties && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="gap-2"><Plus className="size-4" />{t("addDeferred")}</Button>} />
            <DialogContent className="glass">
              <DialogHeader>
                <DialogTitle>{t("addDeferred")}</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  addDeferred.mutate();
                }}
              >
                <div className="flex flex-col gap-2">
                  <Label>{t("agents")}</Label>
                  <PartyCombobox parties={parties} value={partyId} onChange={setPartyId} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="deferred-amount">{t("originalAmount")}</Label>
                  <AmountInput id="deferred-amount" required value={amount} onChange={setAmount} />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={addDeferred.isPending || !partyId}>
                    {t("addDeferred")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          )
        }
      />

      <Input
        placeholder={tCommon("search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {isLoading || summaryLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-3xl" />
          ))}
        </div>
      ) : filteredParties && filteredParties.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredParties.map((party) => {
            const summary = summaryByParty.get(party.id);
            return (
              <Link key={party.id} href={`/parties/${party.id}`}>
                <Card className="glass transition hover:shadow-lg">
                  <CardContent className="pt-6">
                    <p className="truncate text-lg font-medium">{party.name}</p>
                    {party.province && <p className="text-sm text-muted-foreground">{party.province}</p>}
                    <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
                      {summary && summary.outstandingTotal > 0 ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{t("outstandingDeferred")}</span>
                            <span className="font-medium">{summary.outstandingTotal.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{t("deferredCount")}</span>
                            <span>{summary.count}</span>
                          </div>
                          {summary.lastDate && (
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>{t("lastDeferredDate")}</span>
                              <span>{new Date(summary.lastDate).toLocaleDateString()}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t("noDeferredYet")}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Receipt} title={t("noParties")} description={t("noPartiesHint")} />
      )}
    </div>
  );
}
