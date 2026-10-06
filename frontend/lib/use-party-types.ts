"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/session";

/**
 * Shared party-type list for the Parties and Clients "type" pickers, so a
 * custom type added on either page shows up as an option on the other.
 * Backed by GET /parties/types (distinct types already in use across both
 * tables, defaulting to AGENT/MERCHANT — see parties.service.ts). A type
 * just added in the current dialog (not yet saved) is merged in locally so
 * it's selectable immediately, before the next server round trip confirms it.
 */
export function usePartyTypes() {
  const { accessToken } = useSession();
  const queryClient = useQueryClient();
  const [pendingTypes, setPendingTypes] = useState<string[]>([]);

  const { data: serverTypes, isLoading } = useQuery({
    queryKey: ["party-types"],
    queryFn: () => api.parties.types(accessToken ?? undefined),
    enabled: !!accessToken,
  });

  const types = useMemo(() => {
    const merged = new Set<string>([...(serverTypes ?? ["AGENT", "MERCHANT"]), ...pendingTypes]);
    return Array.from(merged);
  }, [serverTypes, pendingTypes]);

  function addType(value: string) {
    setPendingTypes((prev) => (prev.includes(value) ? prev : [...prev, value]));
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["party-types"] });
  }

  return { types, isLoading, addType, refresh };
}
