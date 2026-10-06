"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Link } from "@/i18n/navigation";
import { api, ApiError, type Category } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { usePermission } from "@/lib/use-permission";
import { MoreVertical, Plus, Tags, type LucideIcon } from "lucide-react";

function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  kind,
  namespace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: Category;
  kind: "IN" | "OUT";
  namespace: "expenses" | "income";
}) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [name, setName] = useState(category?.name ?? "");
  const [requirement, setRequirement] = useState<"NONE" | "AGENT" | "MERCHANT" | "COURIER">(
    category?.requiresCourier ? "COURIER" : category?.partyType ?? "NONE",
  );

  const isSystemCategory = !!category?.systemKey;

  const mutation = useMutation({
    mutationFn: () => {
      const requirementFields =
        requirement === "COURIER"
          ? { partyType: null, requiresCourier: true }
          : { partyType: requirement === "NONE" ? null : requirement, requiresCourier: false };
      // A system category's partyType/requiresCourier are fixed — its
      // dedicated flow finds it by systemKey, never by this form, so
      // editing these here can only be accidental. Omit them entirely on
      // a system-category save (only the display name changes); the
      // selector itself is also disabled below as the first line of
      // defense, with the backend rejecting any attempted change as a
      // second line.
      const payload = isSystemCategory ? { name } : { name, ...requirementFields };
      return category
        ? api.categories.update(category.id, payload, accessToken ?? undefined)
        : api.categories.create({ ...payload, kind, ...requirementFields }, accessToken ?? undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(tCommon("success"));
      onOpenChange(false);
      if (!category) setName("");
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{category ? t("editCategoryTitle") : t("addCategoryTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="cat-name">{t("name")}</Label>
            <Input id="cat-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("partyTypeLabel")}</Label>
            <Select
              value={requirement}
              onValueChange={(v) => setRequirement((v as typeof requirement) ?? "NONE")}
              disabled={isSystemCategory}
            >
              <SelectTrigger>
                <SelectValue>{t(`partyTypeOption.${requirement}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t("partyTypeOption.NONE")}</SelectItem>
                <SelectItem value="AGENT">{t("partyTypeOption.AGENT")}</SelectItem>
                <SelectItem value="MERCHANT">{t("partyTypeOption.MERCHANT")}</SelectItem>
                <SelectItem value="COURIER">{t("partyTypeOption.COURIER")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isSystemCategory ? t("partyTypeSystemLockedHint") : t("partyTypeHint")}
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {category ? tCommon("save") : tCommon("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CategoryKindPage({
  kind,
  namespace,
  icon,
}: {
  kind: "IN" | "OUT";
  namespace: "expenses" | "income";
  icon: LucideIcon;
}) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const { data: categories, isLoading } = useQuery({
    queryKey: ["categories", kind],
    queryFn: () => api.categories.list(kind, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const canManageCategories = usePermission("manage_categories");
  const [search, setSearch] = useState("");
  const [requirementFilter, setRequirementFilter] = useState<"ALL" | "NONE" | "AGENT" | "MERCHANT" | "COURIER">(
    "ALL",
  );

  const requirementOf = (cat: Category) => (cat.requiresCourier ? "COURIER" : cat.partyType ?? "NONE");

  const filteredCategories = categories?.filter((cat) => {
    const matchesSearch = cat.name.toLowerCase().includes(search.trim().toLowerCase());
    const matchesRequirement = requirementFilter === "ALL" || requirementOf(cat) === requirementFilter;
    return matchesSearch && matchesRequirement;
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.categories.remove(id, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
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
          canManageCategories && (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="size-4" />
              {t("addCategory")}
            </Button>
          )
        }
      />

      <CategoryFormDialog open={createOpen} onOpenChange={setCreateOpen} kind={kind} namespace={namespace} />
      {editing && (
        <CategoryFormDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          category={editing}
          kind={kind}
          namespace={namespace}
        />
      )}

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={tCommon("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={requirementFilter} onValueChange={(v) => setRequirementFilter((v as typeof requirementFilter) ?? "ALL")}>
          <SelectTrigger className="w-fit min-w-40">
            <SelectValue placeholder={t("partyTypeLabel")}>
              {requirementFilter === "ALL" ? tCommon("all") : t(`partyTypeOption.${requirementFilter}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{tCommon("all")}</SelectItem>
            <SelectItem value="NONE">{t("partyTypeOption.NONE")}</SelectItem>
            <SelectItem value="AGENT">{t("partyTypeOption.AGENT")}</SelectItem>
            <SelectItem value="MERCHANT">{t("partyTypeOption.MERCHANT")}</SelectItem>
            <SelectItem value="COURIER">{t("partyTypeOption.COURIER")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-3xl" />
          ))}
        </div>
      ) : filteredCategories && filteredCategories.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCategories.map((cat) => (
            <Card key={cat.id} className="glass">
              <CardContent className="flex items-center justify-between gap-2 pt-6">
                <Link href={`/categories/${cat.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium">{cat.name}</p>
                  {(cat.partyType || cat.requiresCourier) && (
                    <Badge variant="secondary" className="mt-1">
                      {t(`partyTypeOption.${cat.requiresCourier ? "COURIER" : cat.partyType}`)}
                    </Badge>
                  )}
                </Link>
                {canManageCategories && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon" className="size-8 shrink-0">
                        <MoreVertical className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(cat)}>{tCommon("edit")}</DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (confirm(tCommon("confirmDelete"))) removeMutation.mutate(cat.id);
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
          icon={icon ?? Tags}
          title={t("noCategories")}
          description={t("noCategoriesHint")}
          action={
            canManageCategories && (
              <Button onClick={() => setCreateOpen(true)} className="mt-2 gap-2">
                <Plus className="size-4" />
                {t("addCategory")}
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
