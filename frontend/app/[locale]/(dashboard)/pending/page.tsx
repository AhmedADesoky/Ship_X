"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { api, ApiError, type PendingAction } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { humanizeKey, formatPlainValue } from "@/lib/format-helpers";
import { useEntityLabelResolver } from "@/lib/use-entity-label-resolver";
import { ClipboardCheck, Check, X } from "lucide-react";

function PendingRowSentence({ action }: { action: PendingAction }) {
  const t = useTranslations("auditActions");
  const actor = action.actor?.name ?? t("unknownActor");
  const key = action.semanticAction;
  const hasTemplate = !!key && t.has(key);
  if (hasTemplate) {
    return (
      <span>
        {t(key!, { actor })}
        {action.entityLabel ? ` — ${action.entityLabel}` : ""}
      </span>
    );
  }
  return <span>{t("fallback", { actor, raw: `${action.method} ${action.entityType}` })}</span>;
}

function ActionRow({ action }: { action: PendingAction }) {
  const t = useTranslations("pending");
  const tAudit = useTranslations("audit");
  const tCommon = useTranslations("common");
  const tTransactions = useTranslations("transactions");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const resolveEntityLabel = useEntityLabelResolver();

  const approve = useMutation({
    mutationFn: () => api.pendingActions.approve(action.id, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
      // Approval re-dispatches an arbitrary edit/delete (safe, party,
      // category, transaction) — invalidate everything it could affect
      // rather than tracking which query keys each dispatch target owns.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["safes"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["parties"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(t("approved"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const reject = useMutation({
    mutationFn: () => api.pendingActions.reject(action.id, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
      toast.success(t("rejected"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  const payloadEntries = Object.entries(action.payload ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "");

  // Mirrors audit/page.tsx's PlainFields formatCodedValue — fields whose
  // raw values are internal codes (e.g. kind: "IN") must never leak
  // untranslated into an Arabic-locale view.
  function formatCodedValue(key: string, value: unknown): string | null {
    if (key === "kind" && typeof value === "string") {
      return value === "IN" ? tTransactions("in") : value === "OUT" ? tTransactions("out") : value === "TRANSFER" ? tTransactions("transfer") : null;
    }
    return null;
  }

  return (
    <Card className="glass">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">
              <PendingRowSentence action={action} />
            </p>
            <p className="text-sm text-muted-foreground">{new Date(action.createdAt).toLocaleString()}</p>
          </div>
          <Badge variant={action.status === "PENDING" ? "secondary" : action.status === "APPROVED" ? "default" : "destructive"}>
            {t(action.status.toLowerCase())}
          </Badge>
        </div>

        {payloadEntries.length > 0 && (
          <dl className="flex flex-col gap-1 rounded-2xl bg-muted/40 p-3 text-sm">
            {payloadEntries.map(([key, value]) => {
              const labelKey = `field.${key}`;
              const label = tAudit.has(labelKey) ? tAudit(labelKey) : humanizeKey(key);
              const resolved = resolveEntityLabel(key, value) ?? formatCodedValue(key, value);
              return (
                <div key={key} className="flex gap-2">
                  <dt className="min-w-28 shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">
                    {resolved ?? (typeof value === "object" ? JSON.stringify(value) : formatPlainValue(value))}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        {action.status === "PENDING" && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => reject.mutate()} disabled={reject.isPending}>
              <X className="size-4" />
              {t("reject")}
            </Button>
            <Button size="sm" className="gap-2" onClick={() => approve.mutate()} disabled={approve.isPending}>
              <Check className="size-4" />
              {t("approve")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PendingActionsPage() {
  return (
    <RequirePermission>
      <PendingActionsPageContent />
    </RequirePermission>
  );
}

function PendingActionsPageContent() {
  const tNav = useTranslations("nav");
  const t = useTranslations("pending");
  const { accessToken } = useSession();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pending-actions"],
    queryFn: () => api.pendingActions.list("PENDING", accessToken ?? undefined),
    enabled: !!accessToken,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tNav("pending")} description={t("subtitle")} />

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message={error instanceof ApiError ? error.message : undefined} onRetry={() => refetch()} />
      ) : data && data.length > 0 ? (
        <div className="flex flex-col gap-3">
          {data.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </div>
      ) : (
        <EmptyState icon={ClipboardCheck} title={t("noPending")} description={t("noPendingHint")} />
      )}
    </div>
  );
}
