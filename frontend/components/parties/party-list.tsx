"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/layout/empty-state";
import { PartyTypePicker } from "@/components/shared/party-type-picker";
import { usePartyTypes } from "@/lib/use-party-types";
import { api, ApiError, type Party } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { Contact, MoreVertical, Plus } from "lucide-react";

function PartyFormDialog({
  open,
  onOpenChange,
  defaultType,
  party,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType: "AGENT" | "MERCHANT";
  party?: Party | null;
}) {
  const t = useTranslations("parties");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const { types, addType, refresh } = usePartyTypes();
  const isEdit = !!party;

  const [name, setName] = useState(party?.name ?? "");
  const [province, setProvince] = useState(party?.province ?? "");
  const [phone, setPhone] = useState(party?.phone ?? "");
  const [notes, setNotes] = useState(party?.notes ?? "");
  const [partyType, setPartyType] = useState<string>(party?.partyType ?? defaultType);

  const reset = () => {
    setName(party?.name ?? "");
    setProvince(party?.province ?? "");
    setPhone(party?.phone ?? "");
    setNotes(party?.notes ?? "");
    setPartyType(party?.partyType ?? defaultType);
  };

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.parties.update(
            party!.id,
            { name, partyType, province: province || undefined, phone: phone || undefined, notes: notes || undefined },
            accessToken ?? undefined,
          )
        : api.parties.create(
            { name, partyType, province: province || undefined, phone: phone || undefined, notes: notes || undefined },
            accessToken ?? undefined,
          ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parties"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      refresh();
      toast.success(tCommon("success"));
      onOpenChange(false);
      if (!isEdit) {
        setName("");
        setProvince("");
        setPhone("");
        setNotes("");
      }
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{isEdit ? tCommon("edit") : t("addPartyTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label>{t("partyType")}</Label>
            <PartyTypePicker value={partyType} onChange={setPartyType} types={types} addType={addType} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="party-name">{t("name")}</Label>
            <Input id="party-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="party-province">{t("province")}</Label>
            <Input id="party-province" value={province} onChange={(e) => setProvince(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="party-phone">{t("phone")}</Label>
            <Input id="party-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="party-notes">{t("notes")}</Label>
            <Textarea id="party-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {isEdit ? tCommon("save") : tCommon("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PartyList({ partyType }: { partyType: "AGENT" | "MERCHANT" }) {
  const t = useTranslations("parties");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editParty, setEditParty] = useState<Party | null>(null);
  const canManageParties = usePermission("manage_parties");

  const [search, setSearch] = useState("");

  const { data: parties, isLoading } = useQuery({
    queryKey: ["parties", partyType],
    queryFn: () => api.parties.list(partyType, undefined, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const filteredParties = parties?.filter((party) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      party.name.toLowerCase().includes(q) ||
      (party.province ?? "").toLowerCase().includes(q) ||
      (party.phone ?? "").toLowerCase().includes(q)
    );
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.parties.remove(id, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parties"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder={tCommon("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {canManageParties && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            {t("addParty")}
          </Button>
        )}
      </div>
      <PartyFormDialog open={createOpen} onOpenChange={setCreateOpen} defaultType={partyType} />
      <PartyFormDialog
        open={!!editParty}
        onOpenChange={(o) => {
          if (!o) setEditParty(null);
        }}
        defaultType={partyType}
        party={editParty}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-3xl" />
          ))}
        </div>
      ) : filteredParties && filteredParties.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredParties.map((party) => (
            <Card key={party.id} className="glass transition hover:shadow-lg">
              <CardContent className="flex items-start justify-between gap-2 pt-6">
                <Link href={`/parties/${party.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-lg font-medium">{party.name}</p>
                  {party.province && <p className="text-sm text-muted-foreground">{party.province}</p>}
                  {party.phone && <p className="text-sm text-muted-foreground">{party.phone}</p>}
                </Link>
                {canManageParties && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon" className="size-8 shrink-0">
                        <MoreVertical className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditParty(party)}>{tCommon("edit")}</DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (confirm(tCommon("confirmDelete"))) deleteMutation.mutate(party.id);
                      }}
                    >
                      {tCommon("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Contact}
          title={t("noParties")}
          description={t("noPartiesHint")}
          action={
            canManageParties && (
              <Button onClick={() => setCreateOpen(true)} className="mt-2 gap-2">
                <Plus className="size-4" />
                {t("addParty")}
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
