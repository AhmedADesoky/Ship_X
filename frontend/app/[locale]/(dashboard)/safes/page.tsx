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
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { ArrowLeftRight, Check, Landmark, MoreVertical, Plus, X } from "lucide-react";

// Default suggestions shown to every user; anything they type in gets
// appended and remembered locally (see useSafeTypes) so it shows up as a
// pickable option next time too. The backend accepts any non-empty string
// for Safe.type (see schema.prisma), it's not a fixed enum.
const DEFAULT_SAFE_TYPES = ["CASH", "OTHER"];
const CUSTOM_TYPES_STORAGE_KEY = "fs-custom-safe-types";

function useSafeTypes() {
  const [types, setTypes] = useState<string[]>(DEFAULT_SAFE_TYPES);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_TYPES_STORAGE_KEY);
      const custom: string[] = raw ? JSON.parse(raw) : [];
      setTypes([...DEFAULT_SAFE_TYPES, ...custom.filter((t) => !DEFAULT_SAFE_TYPES.includes(t))]);
    } catch {
      // ignore malformed/missing storage
    }
  }, []);

  function addType(value: string) {
    setTypes((prev) => {
      if (prev.includes(value)) return prev;
      const next = [...prev, value];
      try {
        localStorage.setItem(
          CUSTOM_TYPES_STORAGE_KEY,
          JSON.stringify(next.filter((t) => !DEFAULT_SAFE_TYPES.includes(t))),
        );
      } catch {
        // ignore storage errors (private browsing, etc.)
      }
      return next;
    });
  }

  return { types, addType };
}

function CreateSafeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("safes");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const { types, addType } = useSafeTypes();

  const [name, setName] = useState("");
  const [type, setType] = useState("CASH");
  const [isMain, setIsMain] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState("");

  function confirmNewType() {
    const value = newType.trim().toUpperCase();
    if (!value) return;
    addType(value);
    setType(value);
    setNewType("");
    setAddingType(false);
  }

  const mutation = useMutation({
    mutationFn: () => api.safes.create({ name, type, isMain }, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      onOpenChange(false);
      setName("");
      setType("CASH");
      setIsMain(false);
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{t("addSafeTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="safe-name">{t("name")}</Label>
            <Input id="safe-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("type")}</Label>
            {addingType ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder={t("newTypePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmNewType();
                    } else if (e.key === "Escape") {
                      setAddingType(false);
                      setNewType("");
                    }
                  }}
                />
                <Button type="button" size="icon" onClick={confirmNewType} disabled={!newType.trim()}>
                  <Check className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setAddingType(false);
                    setNewType("");
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={type} onValueChange={(v) => setType(v ?? "CASH")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {type === "CASH" ? t("cash") : type === "OTHER" ? t("other") : type}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === "CASH" ? t("cash") : option === "OTHER" ? t("other") : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={() => setAddingType(true)}>
                  <Plus className="size-4" />
                </Button>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isMain} onChange={(e) => setIsMain(e.target.checked)} className="size-4 rounded" />
            {t("isMain")}
          </label>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdjustBalanceDialog({
  safe,
  open,
  onOpenChange,
}: {
  safe: { id: string; name: string; balance: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("safes");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [targetBalance, setTargetBalance] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open && safe) {
      setTargetBalance(String(safe.balance));
      setNote("");
    }
  }, [open, safe]);

  const mutation = useMutation({
    mutationFn: () =>
      api.safes.adjustBalance(
        safe!.id,
        { targetBalance: Number(targetBalance), note: note || undefined },
        accessToken ?? undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{t("adjustBalanceTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label>{t("currentBalance")}</Label>
            <p className="text-lg font-semibold">{safe ? Number(safe.balance).toLocaleString() : "—"}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="target-balance">{t("targetBalance")}</Label>
            <AmountInput id="target-balance" required value={targetBalance} onChange={setTargetBalance} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adjust-note">{t("note")}</Label>
            <Textarea id="adjust-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !targetBalance}>
              {t("adjustSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SafesPage() {
  return (
    <RequirePermission>
      <SafesPageContent />
    </RequirePermission>
  );
}

function SafesPageContent() {
  const t = useTranslations("safes");
  const tCommon = useTranslations("common");
  const { accessToken, user } = useSession();
  const queryClient = useQueryClient();
  const canDeleteSafes = !!user?.permissions?.includes("delete_safes");
  const canManageSafes = usePermission("manage_safes");

  const { data: safes, isLoading } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [fromSafeId, setFromSafeId] = useState("");
  const [toSafeId, setToSafeId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [adjustSafe, setAdjustSafe] = useState<{ id: string; name: string; balance: number } | null>(null);

  const transferMutation = useMutation({
    mutationFn: () =>
      api.safes.transfer(
        { fromSafeId, toSafeId, amount: Number(amount), description: description || undefined },
        accessToken ?? undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      setOpen(false);
      setAmount("");
      setDescription("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.safes.remove(id, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          canManageSafes && (
          <>
            <Button variant="outline" onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="size-4" />
              {t("addSafe")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger render={<Button className="gap-2"><ArrowLeftRight className="size-4" />{t("transfer")}</Button>} />
              <DialogContent className="glass">
                <DialogHeader>
                  <DialogTitle>{t("transferTitle")}</DialogTitle>
                </DialogHeader>
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    transferMutation.mutate();
                  }}
                >
                  <div className="flex flex-col gap-2">
                    <Label>{t("from")}</Label>
                    <Select value={fromSafeId} onValueChange={(v) => setFromSafeId(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="—">
                          {safes?.find((s) => s.id === fromSafeId)?.name}
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
                  <div className="flex flex-col gap-2">
                    <Label>{t("to")}</Label>
                    <Select value={toSafeId} onValueChange={(v) => setToSafeId(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="—">
                          {safes?.find((s) => s.id === toSafeId)?.name}
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
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="amount">{t("amount")}</Label>
                    <AmountInput id="amount" required value={amount} onChange={setAmount} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="description">{t("description")}</Label>
                    <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={transferMutation.isPending || !fromSafeId || !toSafeId}>
                      {t("submit")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
          )
        }
      />

      <CreateSafeDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AdjustBalanceDialog
        safe={adjustSafe}
        open={!!adjustSafe}
        onOpenChange={(o) => {
          if (!o) setAdjustSafe(null);
        }}
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-3xl" />
          ))}
        </div>
      ) : safes && safes.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {safes.map((safe) => (
            <Card key={safe.id} className="glass">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{safe.name}</CardTitle>
                <div className="flex items-center gap-2">
                  {safe.isMain && <Badge variant="secondary">{t("isMain")}</Badge>}
                  {(canManageSafes || canDeleteSafes) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreVertical className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      {canManageSafes && (
                      <DropdownMenuItem
                        onClick={() =>
                          setAdjustSafe({ id: safe.id, name: safe.name, balance: Number(safe.balance) })
                        }
                      >
                        {t("adjustBalance")}
                      </DropdownMenuItem>
                      )}
                      {canDeleteSafes && (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            if (confirm(tCommon("confirmDelete"))) deleteMutation.mutate(safe.id);
                          }}
                        >
                          {tCommon("delete")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t("balance")}</p>
                <p className="text-2xl font-semibold">{Number(safe.balance).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Landmark}
          title={t("noSafes")}
          description={t("noSafesHint")}
          action={
            canManageSafes && (
              <Button onClick={() => setCreateOpen(true)} className="mt-2 gap-2">
                <Plus className="size-4" />
                {t("addSafe")}
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
