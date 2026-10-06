"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { humanizeKey, formatPlainValue, entityTypeKey } from "@/lib/format-helpers";
import { useEntityLabelResolver } from "@/lib/use-entity-label-resolver";
import { ShieldCheck, X, ChevronDown, ChevronRight } from "lucide-react";
import type { AuditLogEntry } from "@/lib/api-client";

const ALL = "__all__";

/**
 * Renders a before/after payload as a plain "Field: value" list instead of
 * raw JSON syntax (braces/quotes/commas) — one level of nesting is flattened
 * with an indent; deeper structures fall back to a compact inline summary
 * rather than showing something unreadable. FK fields (safeId/partyId/...)
 * are resolved to the referenced record's name instead of a raw UUID.
 */
type AuditT = ReturnType<typeof useTranslations>;

function entityTypeLabel(entityType: string, t: AuditT): string {
  const key = entityTypeKey(entityType);
  const labelKey = `entityType.${key}`;
  return t.has(labelKey) ? t(labelKey) : humanizeKey(key);
}

// Fields whose raw values are internal codes, not something to show
// verbatim — translated the same way the rest of the app already labels
// them (role badges, permission checklists) instead of leaking
// "OWNER"/"manage_safes" as-is.
function PlainFields({
  data,
  t,
  resolveEntityLabel,
  depth = 0,
}: {
  data: Record<string, unknown>;
  t: AuditT;
  resolveEntityLabel: (key: string, value: unknown) => string | null;
  depth?: number;
}) {
  const tRoles = useTranslations("roles");
  const tPermissions = useTranslations("users");
  const tTransactions = useTranslations("transactions");
  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;

  function formatCodedValue(key: string, value: unknown): string | null {
    if (key === "role" && typeof value === "string") {
      return tRoles.has(value) ? tRoles(value) : null;
    }
    if ((key === "permissions" || key === "extraPermissions") && Array.isArray(value)) {
      if (value.length === 0) return "—";
      return value
        .map((p) => {
          const labelKey = `permissionLabels.${p}`;
          return tPermissions.has(labelKey) ? tPermissions(labelKey) : humanizeKey(String(p));
        })
        .join("، ");
    }
    if (key === "kind" && typeof value === "string") {
      return value === "IN" ? tTransactions("in") : value === "OUT" ? tTransactions("out") : value === "TRANSFER" ? tTransactions("transfer") : null;
    }
    return null;
  }

  return (
    <dl className={depth ? "flex flex-col gap-1 ps-4" : "flex flex-col gap-1"}>
      {entries.map(([key, value]) => {
        const labelKey = `field.${key}`;
        const label = t.has(labelKey) ? t(labelKey) : humanizeKey(key);
        const isNestedObject = value && typeof value === "object" && !Array.isArray(value) && depth < 1;
        const resolvedLabel = resolveEntityLabel(key, value) ?? formatCodedValue(key, value);
        return (
          <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="min-w-32 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-words">
              {resolvedLabel ??
                (isNestedObject ? (
                  <PlainFields
                    data={value as Record<string, unknown>}
                    t={t}
                    resolveEntityLabel={resolveEntityLabel}
                    depth={depth + 1}
                  />
                ) : (
                  formatPlainValue(value)
                ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function AuditRowSentence({ entry }: { entry: AuditLogEntry }) {
  const t = useTranslations("auditActions");
  const actor = entry.actor?.name ?? t("unknownActor");
  const key = entry.semanticAction;
  const hasTemplate = !!key && t.has(key);
  if (hasTemplate) {
    const sentence = t(key!, { actor });
    return (
      <span>
        {sentence}
        {entry.entityLabel ? ` — ${entry.entityLabel}` : ""}
      </span>
    );
  }
  return <span>{t("fallback", { actor, raw: `${entry.action} ${entry.entityType}` })}</span>;
}

export default function AuditPage() {
  return (
    <RequirePermission>
      <AuditPageContent />
    </RequirePermission>
  );
}

function AuditPageContent() {
  const t = useTranslations("audit");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const resolveEntityLabel = useEntityLabelResolver();

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.users.list(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const [actorId, setActorId] = useState<string>(ALL);
  const [entityType, setEntityType] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Any filter change invalidates the current page — without this, e.g.
  // narrowing the date range while sitting on page 3 could silently show
  // an empty page instead of jumping back to the (now-relevant) page 1.
  useEffect(() => {
    setPage(1);
  }, [actorId, entityType, from, to]);

  const filters = {
    actorId: actorId === ALL ? undefined : actorId,
    entityType: entityType === ALL ? undefined : entityType,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const {
    data: entries,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["audit", filters],
    queryFn: () => api.audit.list(filters, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const entityTypes = useMemo(
    () => Array.from(new Set((entries ?? []).map((e) => e.entityType))),
    [entries],
  );

  const hasFilters = actorId !== ALL || entityType !== ALL || !!from || !!to;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <Card className="glass">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t("actor")}</Label>
            <Select value={actorId} onValueChange={(v) => setActorId(v ?? ALL)}>
              <SelectTrigger className="w-fit min-w-40">
                <SelectValue>{actorId === ALL ? t("allActors") : users?.find((u) => u.id === actorId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allActors")}</SelectItem>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t("entity")}</Label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v ?? ALL)}>
              <SelectTrigger className="w-fit min-w-40">
                <SelectValue>{entityType === ALL ? t("allEntities") : entityTypeLabel(entityType, t)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allEntities")}</SelectItem>
                {entityTypes.map((e) => (
                  <SelectItem key={e} value={e}>
                    {entityTypeLabel(e, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t("from")}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t("to")}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setActorId(ALL);
                setEntityType(ALL);
                setFrom("");
                setTo("");
              }}
            >
              <X className="size-3.5" />
              {tCommon("clearFilters")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState message={error instanceof ApiError ? error.message : undefined} onRetry={() => refetch()} />
          ) : entries && entries.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>{t("date")}</TableHead>
                    <TableHead>{t("action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const isOpen = expanded.has(entry.id);
                    return (
                      <React.Fragment key={entry.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleExpanded(entry.id)}
                        >
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="size-8"
                              aria-label={isOpen ? t("hideDetails") : t("showDetails")}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(entry.id);
                              }}
                            >
                              {isOpen ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4 rtl:rotate-180" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <AuditRowSentence entry={entry} />
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={3} className="max-w-0 bg-muted/30">
                              <div className="flex min-w-0 flex-col gap-2 py-2 text-xs">
                                <div className="flex flex-wrap gap-x-6 gap-y-1">
                                  <span>
                                    <span className="text-muted-foreground">{t("actor")}: </span>
                                    {entry.actor?.name ?? "—"}
                                  </span>
                                  <span>
                                    <span className="text-muted-foreground">{t("type")}: </span>
                                    {entityTypeLabel(entry.entityType, t)}
                                  </span>
                                </div>
                                {entry.before && Object.keys(entry.before as object).length > 0 ? (
                                  <div className="min-w-0">
                                    <div className="text-muted-foreground">{t("before")}</div>
                                    <div className="max-h-48 w-full max-w-full overflow-auto rounded-md bg-background p-2">
                                      <PlainFields
                                        data={entry.before as Record<string, unknown>}
                                        t={t}
                                        resolveEntityLabel={resolveEntityLabel}
                                      />
                                    </div>
                                  </div>
                                ) : null}
                                {entry.after && Object.keys(entry.after as object).length > 0 ? (
                                  <div className="min-w-0">
                                    <div className="text-muted-foreground">{t("after")}</div>
                                    <div className="max-h-48 w-full max-w-full overflow-auto rounded-md bg-background p-2">
                                      <PlainFields
                                        data={entry.after as Record<string, unknown>}
                                        t={t}
                                        resolveEntityLabel={resolveEntityLabel}
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState icon={ShieldCheck} title={t("noEntries")} />
          )}
        </CardContent>
      </Card>

      {!isLoading && !isError && (entries?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {tCommon("previous")}
          </Button>
          <span className="text-sm text-muted-foreground">{t("page", { page })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(entries?.length ?? 0) < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            {tCommon("next")}
          </Button>
        </div>
      )}
    </div>
  );
}
