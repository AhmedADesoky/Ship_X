"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/session";

// Field-name -> which lookup list to resolve it against. Covers the FK
// fields that show up in audit-log/pending-action payloads across the app.
const ID_FIELD_BUCKETS: Record<string, "safes" | "parties" | "categories"> = {
  safeId: "safes",
  fromSafeId: "safes",
  toSafeId: "safes",
  partyId: "parties",
  clientId: "parties",
  categoryId: "categories",
};

/**
 * Resolves an *Id-suffixed payload field (safeId, partyId, categoryId, ...)
 * to the referenced record's display name, so raw UUIDs never have to be
 * shown to the user in logs/detail views. Falls back to null (caller shows
 * the raw id) only when the record can't be found in the fetched lists.
 */
export function useEntityLabelResolver() {
  const { accessToken } = useSession();

  const { data: safes } = useQuery({
    queryKey: ["safes"],
    queryFn: () => api.safes.list(accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const { data: parties } = useQuery({
    queryKey: ["parties", "ALL"],
    queryFn: () => api.parties.list(undefined, undefined, accessToken ?? undefined),
    enabled: !!accessToken,
  });
  const { data: categories } = useQuery({
    queryKey: ["categories", "ALL"],
    queryFn: () => api.categories.list(undefined, accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const maps: Record<"safes" | "parties" | "categories", Map<string, string>> = {
    safes: new Map((safes ?? []).map((s) => [s.id, s.name])),
    parties: new Map((parties ?? []).map((p) => [p.id, p.name])),
    categories: new Map((categories ?? []).map((c) => [c.id, c.name])),
  };

  return function resolveEntityLabel(key: string, value: unknown): string | null {
    if (typeof value !== "string") return null;
    const bucket = ID_FIELD_BUCKETS[key];
    if (!bucket) return null;
    return maps[bucket].get(value) ?? null;
  };
}
