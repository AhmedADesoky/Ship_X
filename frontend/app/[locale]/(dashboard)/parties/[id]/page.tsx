"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { SettlementFormDialog } from "@/components/parties/settlement-form-dialog";
import { PrintableStatement } from "@/components/shared/printable-statement";
import { partyTypeLabel } from "@/components/shared/party-type-picker";
import { usePermission } from "@/lib/use-permission";
import { api, ApiError, type WithdrawalApplication } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { useFlowTrail } from "@/lib/flow-trail";
import { Plus, Receipt, Wallet, MoreVertical, History, Download } from "lucide-react";

export default function PartyDetailPage() {
  return (
    <RequirePermission>
      <PartyDetailPageContent />
    </RequirePermission>
  );
}

function PartyDetailPageContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const searchParams = useSearchParams();
  const t = useTranslations("parties");
  const tTx = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const tStatement = useTranslations("statement");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const { setCurrentLabel } = useFlowTrail();

  const { data, isLoading } = useQuery({
    queryKey: ["parties", id, "summary"],
    queryFn: () => api.parties.summary(id, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  useEffect(() => {
    if (data?.party.name) setCurrentLabel(data.party.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.party.name]);

  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const { data: drawings, isLoading: drawingsLoading } = useQuery({
    queryKey: ["party-drawings", id],
    queryFn: () => api.parties.drawings(id, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  const { data: deferred, isLoading: deferredLoading } = useQuery({
    queryKey: ["party-deferred", id],
    queryFn: () => api.parties.deferred(id, accessToken ?? undefined),
    enabled: !!accessToken && !!id,
  });

  const [drawingSafeId, setDrawingSafeId] = useState("");
  const [drawingAmount, setDrawingAmount] = useState("");
  const [drawingNote, setDrawingNote] = useState("");
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [historyDrawingId, setHistoryDrawingId] = useState<string | null>(null);
  const canManageParties = usePermission("manage_parties");
  const [tabValue, setTabValue] = useState<string | null>(null);

  // كشف الحساب (Phase 34d) — date range feeding a dedicated statement query,
  // kept separate from `data` (summary()) since the backend statement()
  // endpoint is its own date-filtered chronological feed.
  const [statementStart, setStatementStart] = useState("");
  const [statementEnd, setStatementEnd] = useState("");
  const { data: statementEvents } = useQuery({
    queryKey: ["parties", id, "statement", statementStart, statementEnd],
    queryFn: () => api.parties.statement(id, statementStart || undefined, statementEnd || undefined, accessToken ?? undefined),
    enabled: !!accessToken && !!id && tabValue === "statement",
  });

  // Deep-link support: a blocked رواسل submit elsewhere redirects here with
  // ?openSettlement=<partyId>, auto-opening the settlement dialog on the
  // مسحوبات tab instead of requiring the user to find it themselves. Guard
  // with a ref so this only ever fires once per page load, not on every
  // re-render while the query param is still present.
  const autoOpenedSettlement = useRef(false);
  useEffect(() => {
    if (autoOpenedSettlement.current || !data?.party.id) return;
    if (searchParams.get("openSettlement") === data.party.id) {
      autoOpenedSettlement.current = true;
      setTabValue("drawings");
      setSettlementOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.party.id, searchParams]);

  const { data: applicationHistory } = useQuery({
    queryKey: ["drawing-applications", id, historyDrawingId],
    queryFn: () => api.parties.drawingApplications(id, historyDrawingId as string, accessToken ?? undefined),
    enabled: !!accessToken && !!historyDrawingId,
  });

  const cancelDrawing = useMutation({
    mutationFn: (drawingId: string) => api.parties.cancelDrawing(id, drawingId, {}, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["party-drawings", id] });
      queryClient.invalidateQueries({ queryKey: ["parties", id, "summary"] });
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const addDrawing = useMutation({
    mutationFn: () =>
      api.parties.addDrawing(
        id,
        { safeId: drawingSafeId, amount: Number(drawingAmount), note: drawingNote || undefined },
        accessToken ?? undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["party-drawings", id] });
      queryClient.invalidateQueries({ queryKey: ["parties", id, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      setDrawingOpen(false);
      setDrawingAmount("");
      setDrawingNote("");
      setDrawingSafeId("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const [deferredAmount, setDeferredAmount] = useState("");
  const [deferredOpen, setDeferredOpen] = useState(false);

  const addDeferred = useMutation({
    mutationFn: () => api.parties.addDeferred(id, { originalAmount: Number(deferredAmount) }, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["party-deferred", id] });
      queryClient.invalidateQueries({ queryKey: ["parties", id, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      setDeferredOpen(false);
      setDeferredAmount("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  // Payment against a specific deferred balance.
  const [paymentDeferredId, setPaymentDeferredId] = useState<string | null>(null);
  const [paymentSafeId, setPaymentSafeId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");

  const addPayment = useMutation({
    mutationFn: () =>
      api.parties.addDeferredPayment(
        id,
        paymentDeferredId as string,
        { safeId: paymentSafeId, amount: Number(paymentAmount) },
        accessToken ?? undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["party-deferred", id] });
      queryClient.invalidateQueries({ queryKey: ["parties", id, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      setPaymentDeferredId(null);
      setPaymentAmount("");
      setPaymentSafeId("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={data.party.name}
        description={data.party.province ?? data.party.phone ?? ""}
        backHref={data.party.partyType === "MERCHANT" ? "/senders" : "/agents"}
      />

      <Tabs
        value={tabValue ?? (data.party.partyType === "AGENT" ? "deferred" : "drawings")}
        onValueChange={setTabValue}
      >
        <TabsList className="print:hidden">
          {data.party.partyType !== "AGENT" && <TabsTrigger value="drawings">{t("drawings")}</TabsTrigger>}
          {data.party.partyType !== "MERCHANT" && <TabsTrigger value="deferred">{t("deferred")}</TabsTrigger>}
          <TabsTrigger value="actual">{t("actual")}</TabsTrigger>
          <TabsTrigger value="statement">{tStatement("accountStatement")}</TabsTrigger>
        </TabsList>

        {/* مسحوبات — tied to الرواسل/MERCHANT parties */}
        {data.party.partyType !== "AGENT" && (
        <TabsContent value="drawings" className="flex flex-col gap-4">
          <div className="flex justify-end gap-2">
            {canManageParties && (
              <Button variant="outline" className="gap-2" onClick={() => setSettlementOpen(true)}>
                <Wallet className="size-4" />
                {t("newSettlement")}
              </Button>
            )}
            <Dialog open={drawingOpen} onOpenChange={setDrawingOpen}>
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
                    <Label>{t("safe")}</Label>
                    <Select value={drawingSafeId} onValueChange={(v) => setDrawingSafeId(v ?? "")}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="—">{safes?.find((s) => s.id === drawingSafeId)?.name}</SelectValue></SelectTrigger>
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
                    <Label htmlFor="drawingAmount">{t("originalAmount")}</Label>
                    <AmountInput id="drawingAmount" required value={drawingAmount} onChange={setDrawingAmount} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="drawingNote">{t("note")}</Label>
                    <Input id="drawingNote" value={drawingNote} onChange={(e) => setDrawingNote(e.target.value)} />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={addDrawing.isPending || !drawingSafeId}>
                      {t("addDrawing")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="glass">
            <CardContent className="pt-6">
              {drawingsLoading ? (
                <Skeleton className="h-32 w-full rounded-2xl" />
              ) : drawings && drawings.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tTx("date")}</TableHead>
                      <TableHead>{t("originalAmount")}</TableHead>
                      <TableHead>{t("applied")}</TableHead>
                      <TableHead>{t("remaining")}</TableHead>
                      <TableHead>{tTx("status")}</TableHead>
                      <TableHead>{t("note")}</TableHead>
                      <TableHead>{tCommon("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drawings.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{new Date(d.date).toLocaleDateString()}</TableCell>
                        <TableCell>{Number(d.amount).toLocaleString()}</TableCell>
                        <TableCell>{d.appliedAmount.toLocaleString()}</TableCell>
                        <TableCell>{d.remaining.toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              d.status === "CANCELLED"
                                ? "destructive"
                                : d.status === "APPLIED"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {t(`status.${d.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>{d.note}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="icon" className="size-8">
                                  <MoreVertical className="size-4" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setHistoryDrawingId(d.id)}>
                                <History className="size-3.5" />
                                {t("applicationHistory")}
                              </DropdownMenuItem>
                              {canManageParties && d.status !== "CANCELLED" && d.appliedAmount === 0 && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => {
                                    if (confirm(t("cancelDrawingConfirm"))) cancelDrawing.mutate(d.id);
                                  }}
                                >
                                  {t("cancelDrawing")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={Receipt} title={t("noDrawings")} />
              )}
            </CardContent>
          </Card>
          <SettlementFormDialog open={settlementOpen} onOpenChange={setSettlementOpen} party={data.party} />
          <Dialog open={!!historyDrawingId} onOpenChange={(o) => !o && setHistoryDrawingId(null)}>
            <DialogContent className="glass">
              <DialogHeader>
                <DialogTitle>{t("applicationHistory")}</DialogTitle>
              </DialogHeader>
              {applicationHistory && applicationHistory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tTx("date")}</TableHead>
                      <TableHead>{t("applied")}</TableHead>
                      <TableHead>{t("safe")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applicationHistory.map((a: WithdrawalApplication) => (
                      <TableRow key={a.id}>
                        <TableCell>{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>{Number(a.amount).toLocaleString()}</TableCell>
                        <TableCell>{a.settlement?.safe?.name ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{t("noApplications")}</p>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>
        )}

        {/* آجل — tied to وكلاء المحافظات/AGENT parties */}
        {data.party.partyType !== "MERCHANT" && (
        <TabsContent value="deferred" className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Dialog open={deferredOpen} onOpenChange={setDeferredOpen}>
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
                    <Label htmlFor="deferredAmount">{t("originalAmount")}</Label>
                    <AmountInput id="deferredAmount" required value={deferredAmount} onChange={setDeferredAmount} />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={addDeferred.isPending}>
                      {t("addDeferred")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          {deferredLoading ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : deferred && deferred.length > 0 ? (
            <div className="flex flex-col gap-4">
              {deferred.map((d) => (
                <Card key={d.id} className="glass">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">
                      {Number(d.originalAmount).toLocaleString()} — {t("remaining")} {Number(d.remainingAmount).toLocaleString()}
                    </CardTitle>
                    <Dialog
                      open={paymentDeferredId === d.id}
                      onOpenChange={(o) => setPaymentDeferredId(o ? d.id : null)}
                    >
                      <DialogTrigger
                        render={
                          <Button size="sm" variant="outline" className="gap-2">
                            <Wallet className="size-4" />
                            {t("recordPayment")}
                          </Button>
                        }
                      />
                      <DialogContent className="glass">
                        <DialogHeader>
                          <DialogTitle>{t("recordPayment")}</DialogTitle>
                        </DialogHeader>
                        <form
                          className="flex flex-col gap-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            addPayment.mutate();
                          }}
                        >
                          <div className="flex flex-col gap-2">
                            <Label>{t("safe")}</Label>
                            <Select value={paymentSafeId} onValueChange={(v) => setPaymentSafeId(v ?? "")}>
                              <SelectTrigger className="w-full"><SelectValue placeholder="—">{safes?.find((s) => s.id === paymentSafeId)?.name}</SelectValue></SelectTrigger>
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
                            <Label htmlFor="paymentAmount">{t("originalAmount")}</Label>
                            <AmountInput id="paymentAmount" required value={paymentAmount} onChange={setPaymentAmount} />
                          </div>
                          <DialogFooter>
                            <Button type="submit" disabled={addPayment.isPending || !paymentSafeId}>
                              {t("recordPayment")}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    {d.payments?.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tTx("date")}</TableHead>
                            <TableHead>{t("originalAmount")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.payments.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell>{new Date(p.date).toLocaleDateString()}</TableCell>
                              <TableCell>{Number(p.amount).toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("payments")}: —</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon={Receipt} title={t("noDeferred")} />
          )}
        </TabsContent>
        )}

        {/* فعلي: income/payout summary + drawings/deferred aggregate + tx log */}
        <TabsContent value="actual" className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{t("total")}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{Number(data.total).toLocaleString()}</CardContent>
            </Card>
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{t("count")}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{data.count}</CardContent>
            </Card>
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">{t("netOutstanding")}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{data.netOutstanding?.toLocaleString() ?? "-"}</CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.party.partyType !== "AGENT" && (
              <>
                <Card className="glass">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t("totalWithdrawn")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">{data.totalWithdrawn?.toLocaleString() ?? "-"}</p>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t("applied")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">{data.totalApplied?.toLocaleString() ?? "-"}</p>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t("outstandingWithdrawals")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">{data.totalDrawings?.toLocaleString() ?? "-"}</p>
                  </CardContent>
                </Card>
              </>
            )}
            {data.party.partyType !== "MERCHANT" && (
              <Card className="glass">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t("totalDeferredRemaining")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">{data.totalDeferredRemaining?.toLocaleString() ?? "-"}</p>
                </CardContent>
              </Card>
            )}
          </div>

          <Card className="glass">
            <CardHeader>
              <CardTitle>{t("byMonth")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTx("date")}</TableHead>
                    <TableHead>{t("total")}</TableHead>
                    <TableHead>{t("count")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byMonth?.map((row: any) => (
                    <TableRow key={row.month}>
                      <TableCell>{row.month}</TableCell>
                      <TableCell>{Number(row.total).toLocaleString()}</TableCell>
                      <TableCell>{row.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle>{t("transactionLog")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTx("date")}</TableHead>
                    <TableHead>{tTx("safe")}</TableHead>
                    <TableHead>{tTx("category")}</TableHead>
                    <TableHead>{tTx("amount")}</TableHead>
                    <TableHead>{tTx("description")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transactions?.map((tx: any) => (
                    <TableRow key={tx.id}>
                      <TableCell>{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>{tx.safe?.name}</TableCell>
                      <TableCell>{tx.category?.name ?? "—"}</TableCell>
                      <TableCell>{Number(tx.amount).toLocaleString()}</TableCell>
                      <TableCell className="max-w-[240px] truncate">{tx.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statement" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="statement-start">{tStatement("startDate")}</Label>
                <Input
                  id="statement-start"
                  type="date"
                  value={statementStart}
                  onChange={(e) => setStatementStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="statement-end">{tStatement("endDate")}</Label>
                <Input id="statement-end" type="date" value={statementEnd} onChange={(e) => setStatementEnd(e.target.value)} />
              </div>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <Download className="size-4" />
              {tStatement("exportPdf")}
            </Button>
          </div>

          <div className="print:hidden">
            <Card className="glass">
              <CardContent className="overflow-x-auto pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tStatement("date")}</TableHead>
                      <TableHead>{tStatement("type")}</TableHead>
                      <TableHead>{tStatement("safe")}</TableHead>
                      <TableHead>{tStatement("note")}</TableHead>
                      <TableHead>{tStatement("direction")}</TableHead>
                      <TableHead>{tStatement("amount")}</TableHead>
                      <TableHead>{tStatement("remaining")}</TableHead>
                      <TableHead>{tStatement("status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(statementEvents ?? []).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>{new Date(e.date).toLocaleDateString()}</TableCell>
                        <TableCell>{t(`statementEventType.${e.type}`)}</TableCell>
                        <TableCell>{e.safe?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{e.note ?? "—"}</TableCell>
                        <TableCell>{e.direction === "IN" ? tStatement("in") : tStatement("out")}</TableCell>
                        <TableCell>{e.amount.toLocaleString()}</TableCell>
                        <TableCell>{e.remaining !== undefined ? e.remaining.toLocaleString() : "—"}</TableCell>
                        <TableCell>
                          {e.settled === undefined ? (
                            "—"
                          ) : (
                            <Badge variant={e.settled ? "secondary" : "outline"}>
                              {e.settled ? tStatement("settled") : tStatement("unsettled")}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(statementEvents ?? []).length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">{tStatement("noEvents")}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <PrintableStatement
            title={`${tStatement("accountStatement")} — ${data.party.name}`}
            subtitle={partyTypeLabel(data.party.partyType, t)}
            periodLabel={
              statementStart || statementEnd
                ? `${statementStart || "—"} ${tStatement("endDate")} ${statementEnd || "—"}`
                : undefined
            }
            eventTypeLabel={(type) => t(`statementEventType.${type}`)}
            events={statementEvents ?? []}
            showSafe={false}
            // Never net across event types — one total PER type, shown
            // side by side, same hard rule this app applies everywhere
            // else money from different sources could otherwise look
            // combined (مسحوبات vs تسوية, سلفة vs تحصيل شيت, etc.).
            totalsBySection={[
              ...Object.entries(
                (statementEvents ?? []).reduce<Record<string, number>>((acc, e) => {
                  acc[e.type] = (acc[e.type] ?? 0) + e.amount;
                  return acc;
                }, {}),
              ).map(([type, amount]) => ({ label: t(`statementEventType.${type}`), amount })),
              // Current (not period-scoped) outstanding figures, so the
              // statement always shows "where things stand today" alongside
              // the period's own activity — never netted against the
              // period totals above.
              ...(data.party.partyType !== "AGENT" && data.totalDrawings !== undefined
                ? [{ label: t("totalDrawings"), amount: data.totalDrawings }]
                : []),
              ...(data.party.partyType !== "MERCHANT" && data.totalDeferredRemaining !== undefined
                ? [{ label: t("totalDeferredRemaining"), amount: data.totalDeferredRemaining }]
                : []),
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
