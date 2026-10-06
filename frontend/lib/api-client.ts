/**
 * Small typed fetch wrapper around the NestJS backend, using
 * NEXT_PUBLIC_API_URL. Attaches the app JWT (see lib/session.ts) as a
 * Bearer token once real Supabase-backed auth is wired up on both ends;
 * for now the session is a client-side stub (see TODOs there).
 *
 * The refresh token itself is never held here — it lives only in the
 * httpOnly cookie the backend sets on login (scoped to /auth), so
 * `credentials: "include"` is required on any call that needs it.
 */

import { clearStoredSession, readStoredSession, writeStoredAccessToken } from "./session-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  // The parsed response body, when the server returned one — lets a caller
  // inspect a structured error payload (e.g. a 409's nested `message`
  // object) instead of only the flattened string `message` above.
  public body?: unknown;

  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string;
}

// A single in-flight refresh is shared across concurrent 401s so a burst of
// requests doesn't fire the refresh endpoint multiple times in parallel.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // No refresh token is held in JS — it's only in the httpOnly cookie, so
  // there's nothing to read here; just check a session was ever
  // established (accessToken present) before bothering to call the API.
  const stored = readStoredSession();
  if (!stored?.accessToken) return null;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.accessToken) return null;
        writeStoredAccessToken(data.accessToken);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("fs-token-refreshed", { detail: { accessToken: data.accessToken } }));
        }
        return data.accessToken as string;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function rawFetch(path: string, method: string, body: unknown, token?: string) {
  return fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}, _isRetry = false): Promise<T> {
  const { method = "GET", body, token } = options;

  const res = await rawFetch(path, method, body, token);

  if (res.status === 401 && token && !_isRetry && path !== "/auth/login" && path !== "/auth/refresh") {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, { ...options, token: newToken }, true);
    }
    clearStoredSession();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("fs-auth-logout"));
    }
  }

  if (!res.ok) {
    let message: unknown = res.statusText;
    let parsedBody: unknown;
    try {
      parsedBody = await res.json();
      message = (parsedBody as { message?: unknown })?.message ?? message;
    } catch {
      // ignore body parse errors
    }
    // `message` is normally a string (or an array of validation strings),
    // but some errors (e.g. the رواسل open-drawings 409) nest a structured
    // object there instead — fall back to the status text rather than
    // stringifying it as "[object Object]", and keep the full parsed body
    // on `err.body` so a caller can still read the structured payload.
    const flatMessage = Array.isArray(message)
      ? message.join(", ")
      : typeof message === "string"
        ? message
        : res.statusText;
    const err = new ApiError(res.status, flatMessage);
    err.body = parsedBody;
    throw err;
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string, mfaCode?: string) =>
    apiFetch<{ accessToken: string; user: SessionUser } | { mfaRequired: true }>("/auth/login", {
      method: "POST",
      body: mfaCode ? { email, password, mfaCode } : { email, password },
    }),
  // Clears the httpOnly refresh-token cookie server-side. Best-effort —
  // the frontend also wipes its own local session regardless of whether
  // this call succeeds.
  logout: () => apiFetch<void>("/auth/logout", { method: "POST" }),
  forgotPassword: (email: string) =>
    apiFetch<{ message: string; devToken?: string }>("/auth/forgot-password", { method: "POST", body: { email } }),
  resetPassword: (email: string, token: string, newPassword: string) =>
    apiFetch<{ message: string }>("/auth/reset-password", { method: "POST", body: { email, token, newPassword } }),
  mfa: {
    enroll: (token?: string) => apiFetch<{ secret: string; otpauthUrl: string }>("/auth/mfa/enroll", { method: "POST", token }),
    verify: (code: string, token?: string) =>
      apiFetch<{ mfaEnabled: boolean }>("/auth/mfa/verify", { method: "POST", body: { code }, token }),
    disable: (password: string, token?: string) =>
      apiFetch<{ mfaEnabled: boolean }>("/auth/mfa/disable", { method: "POST", body: { password }, token }),
  },
  safes: {
    list: (token?: string) => apiFetch<SafeWithBalance[]>("/safes", { token }),
    create: (dto: { name: string; type: string; isMain?: boolean }, token?: string) =>
      apiFetch<SafeWithBalance>("/safes", { method: "POST", body: dto, token }),
    transfer: (dto: { fromSafeId: string; toSafeId: string; amount: number; description?: string }, token?: string) =>
      apiFetch("/safes/transfer", { method: "POST", body: dto, token }),
    adjustBalance: (id: string, dto: { targetBalance: number; note?: string }, token?: string) =>
      apiFetch(`/safes/${id}/adjust-balance`, { method: "POST", body: dto, token }),
    deposit: (id: string, dto: { amount: number; note?: string }, token?: string) =>
      apiFetch(`/safes/${id}/deposit`, { method: "POST", body: dto, token }),
    remove: (id: string, token?: string) => apiFetch(`/safes/${id}`, { method: "DELETE", token }),
  },
  users: {
    list: (token?: string, includeInactive?: boolean) =>
      apiFetch<SessionUser[]>(`/users${includeInactive ? "?includeInactive=true" : ""}`, { token }),
    create: (
      dto: { email: string; name: string; title?: string; role: string; password: string; extraPermissions?: string[] },
      token?: string,
    ) => apiFetch<SessionUser>("/users", { method: "POST", body: dto, token }),
    update: (
      id: string,
      dto: {
        name?: string;
        title?: string;
        role?: string;
        active?: boolean;
        password?: string;
        extraPermissions?: string[];
      },
      token?: string,
    ) => apiFetch<SessionUser>(`/users/${id}`, { method: "PATCH", body: dto, token }),
    remove: (id: string, token?: string) => apiFetch<SessionUser>(`/users/${id}`, { method: "DELETE", token }),
    updateSelf: (dto: { name?: string }, token?: string) =>
      apiFetch<SessionUser>("/users/me", { method: "PATCH", body: dto, token }),
    uploadAvatar: (file: File, token?: string) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetchForm<SessionUser>("/users/me/avatar", form, token);
    },
    removeAvatar: (token?: string) => apiFetch<SessionUser>("/users/me/avatar", { method: "DELETE", token }),
  },
  audit: {
    list: (
      filters: { actorId?: string; entityType?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
      token?: string,
    ) => {
      const params = new URLSearchParams();
      if (filters.actorId) params.set("actorId", filters.actorId);
      if (filters.entityType) params.set("entityType", filters.entityType);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.page) params.set("page", String(filters.page));
      if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
      const qs = params.toString();
      return apiFetch<AuditLogEntry[]>(`/audit${qs ? `?${qs}` : ""}`, { token });
    },
  },
  reports: {
    dashboard: (token?: string) => apiFetch<DashboardReport>("/reports/dashboard", { token }),
    range: (start?: string, end?: string, token?: string) => {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const qs = params.toString();
      return apiFetch<ReportsRange>(`/reports${qs ? `?${qs}` : ""}`, { token });
    },
  },
  categories: {
    list: (kind?: "IN" | "OUT", token?: string) =>
      apiFetch<Category[]>(`/categories${kind ? `?kind=${kind}` : ""}`, { token }),
    create: (
      dto: { name: string; kind: "IN" | "OUT"; partyType?: "AGENT" | "MERCHANT" | null; requiresCourier?: boolean },
      token?: string,
    ) => apiFetch<Category>("/categories", { method: "POST", body: dto, token }),
    update: (
      id: string,
      dto: { name?: string; active?: boolean; partyType?: "AGENT" | "MERCHANT" | null; requiresCourier?: boolean },
      token?: string,
    ) => apiFetch<Category>(`/categories/${id}`, { method: "PATCH", body: dto, token }),
    remove: (id: string, token?: string) => apiFetch(`/categories/${id}`, { method: "DELETE", token }),
    summary: (id: string, token?: string) => apiFetch(`/categories/${id}/summary`, { token }),
  },
  parties: {
    list: (partyType?: string, q?: string, token?: string) => {
      const params = new URLSearchParams();
      if (partyType) params.set("partyType", partyType);
      if (q) params.set("q", q);
      const qs = params.toString();
      return apiFetch<Party[]>(`/parties${qs ? `?${qs}` : ""}`, { token });
    },
    types: (token?: string) => apiFetch<string[]>("/parties/types", { token }),
    get: (id: string, token?: string) => apiFetch<Party>(`/parties/${id}`, { token }),
    create: (
      dto: { name: string; partyType: string; province?: string; phone?: string; notes?: string },
      token?: string,
    ) => apiFetch<Party>("/parties", { method: "POST", body: dto, token }),
    update: (id: string, dto: Partial<Party>, token?: string) =>
      apiFetch<Party>(`/parties/${id}`, { method: "PATCH", body: dto, token }),
    remove: (id: string, token?: string) => apiFetch(`/parties/${id}`, { method: "DELETE", token }),
    summary: (id: string, token?: string) => apiFetch<PartySummary>(`/parties/${id}/summary`, { token }),
    statement: (id: string, start?: string, end?: string, token?: string) => {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const qs = params.toString();
      return apiFetch<PartyStatementEvent[]>(`/parties/${id}/statement${qs ? `?${qs}` : ""}`, { token });
    },
    drawings: (id: string, token?: string) => apiFetch<PartyDrawing[]>(`/parties/${id}/drawings`, { token }),
    addDrawing: (id: string, dto: { safeId: string; amount: number; note?: string }, token?: string) =>
      apiFetch(`/parties/${id}/drawings`, { method: "POST", body: dto, token }),
    deferred: (id: string, token?: string) => apiFetch<PartyDeferred[]>(`/parties/${id}/deferred`, { token }),
    addDeferred: (id: string, dto: { originalAmount: number }, token?: string) =>
      apiFetch(`/parties/${id}/deferred`, { method: "POST", body: dto, token }),
    addDeferredPayment: (
      id: string,
      deferredId: string,
      dto: { safeId: string; amount: number },
      token?: string,
    ) => apiFetch(`/parties/${id}/deferred/${deferredId}/payments`, { method: "POST", body: dto, token }),
    cancelDrawing: (id: string, drawingId: string, dto: { note?: string }, token?: string) =>
      apiFetch(`/parties/${id}/drawings/${drawingId}/cancel`, { method: "POST", body: dto, token }),
    drawingApplications: (id: string, drawingId: string, token?: string) =>
      apiFetch<WithdrawalApplication[]>(`/parties/${id}/drawings/${drawingId}/applications`, { token }),
    settlements: (id: string, token?: string) => apiFetch<PartySettlement[]>(`/parties/${id}/settlements`, { token }),
    createSettlement: (
      id: string,
      dto: {
        safeId: string;
        grossAmount: number;
        note?: string;
        date?: string;
        applicationMode: SettlementApplicationMode;
        customTotal?: number;
        specificApplications?: { drawingId: string; amount: number }[];
        clientRequestId?: string;
      },
      token?: string,
    ) => apiFetch<PartySettlement>(`/parties/${id}/settlements`, { method: "POST", body: dto, token }),
    // Lists every MERCHANT party's outstanding-withdrawal total in one
    // request, replacing the drawings page's former per-party N+1 fetch.
    outstandingSummary: (partyType?: string, token?: string) =>
      apiFetch<{ partyId: string; outstandingTotal: number; count: number; lastDate: string | null }[]>(
        `/parties/drawings/outstanding-summary${partyType ? `?partyType=${partyType}` : ""}`,
        { token },
      ),
    // Same shape, for آجل (PartyDeferred.remainingAmount) instead of
    // مسحوبات — replaces the deferred page's former per-party N+1 fetch
    // (it used to fetch each party's FULL deferred list just to show the
    // most recent originalAmount, not the real outstanding figure).
    deferredOutstandingSummary: (partyType?: string, token?: string) =>
      apiFetch<{ partyId: string; outstandingTotal: number; count: number; lastDate: string | null }[]>(
        `/parties/deferred/outstanding-summary${partyType ? `?partyType=${partyType}` : ""}`,
        { token },
      ),
  },
  // مناديب القاهرة والجيزة (Cairo & Giza Couriers) — deliberately its own
  // section, not a Party-shaped sub-resource: a courier is not a Party
  // (see backend/prisma/schema.prisma's comment above the Courier model).
  couriers: {
    list: (q?: string, status?: string, token?: string) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      const qs = params.toString();
      return apiFetch<Courier[]>(`/couriers${qs ? `?${qs}` : ""}`, { token });
    },
    // Batch outstanding totals for every courier in one request — avoids
    // an N+1 per-courier fetch on the list page.
    summaryBatch: (token?: string) => apiFetch<CourierBatchSummary[]>("/couriers/summary", { token }),
    get: (id: string, token?: string) => apiFetch<Courier>(`/couriers/${id}`, { token }),
    create: (dto: { name: string; phone?: string; notes?: string; active?: boolean }, token?: string) =>
      apiFetch<Courier>("/couriers", { method: "POST", body: dto, token }),
    update: (id: string, dto: Partial<{ name: string; phone: string; notes: string; active: boolean }>, token?: string) =>
      apiFetch<Courier>(`/couriers/${id}`, { method: "PATCH", body: dto, token }),
    remove: (id: string, token?: string) => apiFetch(`/couriers/${id}`, { method: "DELETE", token }),
    summary: (id: string, token?: string) => apiFetch<CourierSummary>(`/couriers/${id}/summary`, { token }),
    statement: (id: string, start?: string, end?: string, token?: string) => {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const qs = params.toString();
      return apiFetch<CourierStatementEvent[]>(`/couriers/${id}/statement${qs ? `?${qs}` : ""}`, { token });
    },
    sheetCollections: (id: string, token?: string) =>
      apiFetch<CourierSheetCollection[]>(`/couriers/${id}/sheet-collections`, { token }),
    // courierId nullable in the body — historical/opening collections have
    // no specific courier. Single endpoint used both from a courier's own
    // page (pre-filled) and the standalone list page's "تحصيل تاريخي" entry.
    addSheetCollection: (
      dto: { courierId: string | null; safeId: string; amount: number; note?: string; source?: string },
      token?: string,
    ) => apiFetch<CourierSheetCollection>("/couriers/sheet-collections", { method: "POST", body: dto, token }),
    // غير محدد — unassigned/historical sheet collections, for the review +
    // reassign-to-courier flow (Phase 35).
    listUnassignedSheetCollections: (token?: string) =>
      apiFetch<CourierSheetCollection[]>("/couriers/sheet-collections/unassigned", { token }),
    assignSheetCollection: (collectionId: string, courierId: string, token?: string) =>
      apiFetch<CourierSheetCollection>(`/couriers/sheet-collections/${collectionId}/assign`, {
        method: "PATCH",
        body: { collectionId, courierId },
        token,
      }),
    advances: (id: string, token?: string) => apiFetch<CourierAdvance[]>(`/couriers/${id}/advances`, { token }),
    addAdvance: (id: string, dto: { safeId: string; amount: number; note?: string }, token?: string) =>
      apiFetch<CourierAdvance>(`/couriers/${id}/advances`, { method: "POST", body: dto, token }),
    addRepayment: (
      id: string,
      advanceId: string,
      dto: { advanceId: string; safeId: string; amount: number; note?: string },
      token?: string,
    ) =>
      apiFetch<{ repayment: CourierAdvanceRepayment; advance: CourierAdvance }>(
        `/couriers/${id}/advances/${advanceId}/repayments`,
        { method: "POST", body: dto, token },
      ),
  },
  transactions: {
    list: (
      filters: {
        q?: string;
        kind?: string;
        safeId?: string;
        categoryId?: string;
        partyId?: string;
        start?: string;
        end?: string;
        page?: number;
        pageSize?: number;
      } = {},
      token?: string,
    ) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, String(v)));
      const qs = params.toString();
      return apiFetch<Transaction[]>(`/transactions${qs ? `?${qs}` : ""}`, { token });
    },
    get: (id: string, token?: string) => apiFetch<Transaction>(`/transactions/${id}`, { token }),
    create: (
      dto: {
        kind: "IN" | "OUT";
        amount: number;
        safeId: string;
        categoryId?: string;
        partyId?: string;
        courierId?: string;
        description?: string;
        referenceNo?: string;
        notes?: string;
      },
      token?: string,
    ) => apiFetch<Transaction>("/transactions", { method: "POST", body: dto, token }),
    update: (id: string, dto: Partial<Transaction> & Record<string, unknown>, token?: string) =>
      apiFetch<Transaction>(`/transactions/${id}`, { method: "PATCH", body: dto, token }),
    void: (id: string, token?: string) => apiFetch(`/transactions/${id}/void`, { method: "POST", token }),
    // طلب سريع — several IN/OUT rows sharing one optional party, created
    // atomically (all rows succeed together or none do).
    createBatch: (
      dto: {
        partyId?: string;
        courierId?: string;
        items: {
          kind: "IN" | "OUT";
          categoryId: string;
          safeId: string;
          amount: number;
          description?: string;
          referenceNo?: string;
        }[];
      },
      token?: string,
    ) =>
      apiFetch<Transaction[] | { queued: true; pendingActionId: string }>("/transactions/batch", {
        method: "POST",
        body: dto,
        token,
      }),
  },
  reconciliations: {
    list: (token?: string) => apiFetch<Reconciliation[]>("/reconciliations", { token }),
    create: (dto: { safeId: string; reconDate: string; actualBalance: number; note?: string }, token?: string) =>
      apiFetch<Reconciliation>("/reconciliations", { method: "POST", body: dto, token }),
  },
  settings: {
    get: (token?: string) => apiFetch<Record<string, string>>("/settings", { token }),
    update: (payload: Record<string, string>, token?: string) =>
      apiFetch<Record<string, string>>("/settings", { method: "PUT", body: payload, token }),
    reset: (confirm: string, token?: string) =>
      apiFetch<{ reset: boolean }>("/settings/reset", { method: "POST", body: { confirm }, token }),
    // Zeroes out transactions/drawings/deferred/reconciliations/audit
    // history and safe balances, but keeps every party/category/safe row
    // intact — a lighter sibling of reset() for starting a fresh period
    // without recreating entities.
    clearNumbers: (confirm: string, token?: string) =>
      apiFetch<{ cleared: boolean }>("/settings/clear-numbers", { method: "POST", body: { confirm }, token }),
    // Full business-data snapshot (safes, categories, parties, transactions,
    // drawings/deferred, reconciliations, import batches, settings) — the
    // manual safety net alongside Supabase's own backups. Fetched as a blob
    // rather than through apiFetch/JSON since the response is a file
    // download that still needs the Bearer token attached.
    exportFull: async (token?: string): Promise<Blob> => {
      const res = await fetch(`${API_URL}/settings/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      return res.blob();
    },
  },
  pendingActions: {
    list: (status?: string, token?: string) =>
      apiFetch<PendingAction[]>(`/pending-actions${status ? `?status=${status}` : ""}`, { token }),
    approve: (id: string, token?: string) => apiFetch(`/pending-actions/${id}/approve`, { method: "POST", token }),
    reject: (id: string, token?: string) => apiFetch(`/pending-actions/${id}/reject`, { method: "POST", token }),
  },
  importBatches: {
    inspect: (file: File, token?: string) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetchForm<ImportInspectResult>("/import/inspect", form, token);
    },
    commit: (file: File, defaultSafeId: string, token?: string) => {
      const form = new FormData();
      form.append("file", file);
      form.append("defaultSafeId", defaultSafeId);
      return apiFetchForm<ImportCommitResult>("/import/commit", form, token);
    },
    history: (token?: string) => apiFetch<ImportBatch[]>("/import/history", { token }),
  },
};

async function apiFetchForm<T>(path: string, form: FormData, token?: string, _isRetry = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (res.status === 401 && token && !_isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetchForm<T>(path, form, newToken, true);
    }
    clearStoredSession();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("fs-auth-logout"));
    }
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.message ?? message;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, Array.isArray(message) ? message.join(", ") : message);
  }
  return res.json() as Promise<T>;
}

export const ALL_PERMISSIONS = [
  "view_reports",
  "view_dashboard",
  "view_safes",
  "edit_transactions",
  "manage_users",
  "view_audit_log",
  "manage_safes",
  "delete_safes",
  "manage_categories",
  "manage_parties",
  "manage_couriers",
  "manage_transactions",
  "manage_reconciliations",
  "manage_settings",
  "manage_import",
  "manage_pending_actions",
  "reset_system",
  "delete_users",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  title?: string | null;
  role: "OWNER" | "MANAGER" | "ACCOUNTANT" | "EMPLOYEE";
  extraPermissions?: string[];
  permissions?: string[];
  active?: boolean;
  avatarUrl?: string | null;
  mfaEnabled?: boolean;
}

export interface SafeWithBalance {
  id: string;
  name: string;
  type: string;
  isMain: boolean;
  balance: number;
}

export type DrawingStatus = "OPEN" | "PARTIALLY_APPLIED" | "APPLIED" | "CANCELLED";

export interface PartyDrawing {
  id: string;
  partyId: string;
  safeId: string;
  amount: string | number;
  date: string;
  note?: string | null;
  cancelled: boolean;
  cancelledAt?: string | null;
  cancelledNote?: string | null;
  appliedAmount: number;
  remaining: number;
  status: DrawingStatus;
}

export type SettlementApplicationMode = "ALL" | "CUSTOM_TOTAL" | "SPECIFIC" | "NONE";

export interface WithdrawalApplication {
  id: string;
  drawingId: string;
  settlementId: string;
  amount: string | number;
  createdAt: string;
  settlement?: { id: string; date: string; grossAmount: string | number; netAmount: string | number; safe?: { name: string } };
}

export interface PartySettlement {
  id: string;
  partyId: string;
  safeId: string;
  safe?: { id: string; name: string };
  grossAmount: string | number;
  appliedAmount: string | number;
  netAmount: string | number;
  transactionId?: string | null;
  note?: string | null;
  date: string;
  status: "POSTED" | "VOIDED";
  applications?: WithdrawalApplication[];
  warnings?: string[];
  queued?: boolean;
  pendingActionId?: string;
}

export interface PartyDeferredPayment {
  id: string;
  amount: string | number;
  date: string;
}

export interface PartyDeferred {
  id: string;
  partyId: string;
  originalAmount: string | number;
  remainingAmount: string | number;
  createdAt: string;
  payments: PartyDeferredPayment[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  semanticAction?: string | null;
  entityLabel?: string | null;
  before?: unknown;
  after?: unknown;
  createdAt: string;
  actor?: { id: string; name: string; email: string } | null;
}

export interface RecentTransaction {
  id: string;
  kind: "IN" | "OUT" | "TRANSFER";
  amount: string | number;
  description?: string | null;
  createdAt: string;
  safe?: { name: string } | null;
  client?: { name: string } | null;
  createdBy?: { name: string } | null;
}

export interface DashboardReport {
  totalBalance: number;
  safes: SafeWithBalance[];
  recentTransactions: RecentTransaction[];
  series: { date: string; in: number; out: number }[];
  clientBreakdown: { name: string; total: number }[];
  categoryBreakdown: { name: string; kind: "IN" | "OUT"; total: number }[];
  partyTypeBreakdown: { type: string; total: number }[];
  monthlySeries: { month: string; in: number; out: number }[];
  deferredTrend: { month: string; outstanding: number }[];
  reconciliationDrift: { date: string; safe: string; difference: number }[];
  safeBalanceTrend: Record<string, string | number>[];
  safeSeries: { id: string; name: string }[];
  pendingCount: number;
  // مناديب القاهرة والجيزة — three independent metrics, never combined
  // into one balance (see CouriersService.summary()'s hard business rule).
  courierCollectionsTotal?: number;
  courierAdvancesTotal?: number;
  courierOutstandingAdvances?: number;
}

export interface Category {
  id: string;
  name: string;
  kind: "IN" | "OUT";
  active: boolean;
  partyType?: "AGENT" | "MERCHANT" | null;
  requiresCourier?: boolean;
  systemKey?: string | null;
}

export interface Party {
  id: string;
  name: string;
  partyType: string;
  province?: string | null;
  phone?: string | null;
  notes?: string | null;
  active: boolean;
}

export interface Courier {
  id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
  active: boolean;
  createdAt: string;
}

export interface CourierBatchSummary {
  courierId: string;
  sheetCollectionsTotal: number;
  sheetCollectionsCount: number;
  advancesTotal: number;
  outstandingAdvances: number;
}

export interface CourierSummary {
  sheetCollectionsTotal: number;
  sheetCollectionsCount: number;
  advancesTotal: number;
  outstandingAdvances: number;
}

export interface CourierSheetCollection {
  id: string;
  courierId: string | null;
  courier?: Courier | null;
  safeId: string;
  safe?: { id: string; name: string };
  amount: string | number;
  note?: string | null;
  date: string;
  transactionId?: string | null;
  // Purely descriptive — which screen this entry was created from. Never
  // used in any total/validation logic.
  source?: string | null;
}

export type CourierAdvanceStatus = "OPEN" | "PARTIALLY_REPAID" | "FULLY_REPAID";

export interface CourierAdvance {
  id: string;
  courierId: string;
  safeId: string;
  safe?: { id: string; name: string };
  originalAmount: string | number;
  remainingAmount: string | number;
  note?: string | null;
  status: CourierAdvanceStatus;
  createdAt: string;
  repayments?: CourierAdvanceRepayment[];
}

export interface CourierAdvanceRepayment {
  id: string;
  advanceId: string;
  safeId: string;
  safe?: { id: string; name: string };
  amount: string | number;
  date: string;
}

export interface CourierStatementEvent {
  id: string;
  type: "SHEET_COLLECTION" | "ADVANCE" | "ADVANCE_REPAYMENT";
  date: string;
  amount: number;
  direction: "IN" | "OUT";
  safe?: { id: string; name: string };
  note?: string | null;
  // Current remaining/settled state of the specific advance this event
  // belongs to — present on ADVANCE/ADVANCE_REPAYMENT, absent otherwise.
  remaining?: number;
  settled?: boolean;
}

export interface PartyStatementEvent {
  id: string;
  type: "TRANSACTION" | "DRAWING" | "SETTLEMENT" | "DEFERRED" | "DEFERRED_PAYMENT";
  date: string;
  amount: number;
  direction: "IN" | "OUT";
  safe?: { id: string; name: string } | null;
  note?: string | null;
  // Current remaining/settled state of the specific drawing/deferred
  // record this event belongs to — present on DRAWING/DEFERRED/
  // DEFERRED_PAYMENT, absent otherwise.
  remaining?: number;
  settled?: boolean;
}

export interface PartySummary {
  party: Party;
  metric: "income" | "payout";
  total: number;
  count: number;
  firstDate?: string | null;
  lastDate?: string | null;
  transactions: Transaction[];
  byMonth: { month: string; total: number; count: number }[];
  totalDrawings: number;
  totalWithdrawn: number;
  totalApplied: number;
  totalDeferredOriginal: number;
  totalDeferredPaid: number;
  totalDeferredRemaining: number;
  netOutstanding: number;
  drawingsCount: number;
  outstandingDrawingsCount: number;
  deferredCount: number;
}

export interface PendingAction {
  id: string;
  actorId: string;
  actor?: { name: string; email: string };
  method: string;
  route: string;
  entityType: string;
  entityId?: string | null;
  payload: Record<string, unknown>;
  semanticAction?: string | null;
  entityLabel?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedBy?: { name: string } | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface Transaction {
  id: string;
  kind: "IN" | "OUT" | "TRANSFER";
  amount: string | number;
  safeId: string;
  safe?: { id: string; name: string };
  categoryId?: string | null;
  category?: { id: string; name: string; kind: string } | null;
  partyId?: string | null;
  party?: { id: string; name: string; partyType: string } | null;
  courierId?: string | null;
  courier?: { id: string; name: string } | null;
  createdById?: string | null;
  createdBy?: { id: string; name: string } | null;
  description?: string | null;
  referenceNo?: string | null;
  notes?: string | null;
  status: string;
  relatedTransactionId?: string | null;
  createdAt: string;
}

export interface Reconciliation {
  id: string;
  safeId: string;
  safe?: { name: string };
  reconDate: string;
  expectedBalance: string | number;
  actualBalance: string | number;
  difference: string | number;
  note?: string | null;
  createdAt: string;
}

export interface ReportsRange {
  totals: { income: number; expense: number; net: number; count: number };
  byCategory: { category: string; kind: string; total: number; count: number }[];
  byParty: { party: string; kind: string; total: number; count: number }[];
  bySafe: { safe: string; net: number }[];
  series: { date: string; in: number; out: number }[];
  courierCollectionsTotal: number;
  courierAdvancesTotal: number;
  courierOutstandingAdvances: number;
  // مسحوبات / آجل / سلف company-wide report sections (Phase 39d) — each
  // kept separate, never netted against the others.
  drawingsTotal: number;
  drawingsCount: number;
  drawingsByParty: { party: string; total: number; count: number; remaining: number; settled: boolean }[];
  drawingsOutstandingTotal: number;
  topOutstandingDrawings: { party: string; remaining: number }[];
  deferredTotal: number;
  deferredCount: number;
  deferredByParty: { party: string; total: number; count: number; remaining: number; settled: boolean }[];
  deferredOutstandingTotal: number;
  topOutstandingDeferred: { party: string; remaining: number }[];
  advancesByCourier: { courier: string; total: number; count: number; remaining: number; settled: boolean }[];
  topOutstandingCourierAdvances: { courier: string; remaining: number }[];
}

export interface ImportInspectResult {
  filename: string;
  hash: string;
  sheets: { name: string; rows: number; headers: string[] }[];
  rows: number;
  mapping: Record<string, string | null>;
  sample: { sheet: string; date: string; description: string; income: number; expense: number; amount: number }[];
  incomeTotal: number;
  expenseTotal: number;
  warnings: string[];
  alreadyImported: boolean;
}

export interface ImportCommitResult {
  batchId: string;
  rowsRead: number;
  imported: number;
  skipped: number;
  review: number;
  incomeTotal: number;
  expenseTotal: number;
}

export interface ImportBatch {
  id: string;
  filename: string;
  status: string;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsReview: number;
  incomeTotal: string | number;
  expenseTotal: string | number;
  startedAt: string;
  completedAt?: string | null;
}
