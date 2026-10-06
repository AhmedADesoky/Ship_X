/**
 * Framework-agnostic read/write access to the persisted client session
 * (localStorage key `fs-session`). Exists as a separate module (no React,
 * no imports from api-client.ts) so `api-client.ts` can read the stored
 * access token and update it after a silent refresh, without creating a
 * circular import between it and `session.tsx` (which itself imports types
 * from api-client.ts).
 *
 * The refresh token is deliberately NOT stored here (or anywhere in JS-
 * readable storage) — it lives only in the httpOnly cookie the backend
 * sets on login/refresh, so an XSS payload can read the short-lived access
 * token at worst, never the 7-day refresh token.
 */

export interface StoredSession {
  user: unknown;
  accessToken: string;
}

const STORAGE_KEY = "fs-session";

export function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function writeStoredAccessToken(accessToken: string) {
  if (typeof window === "undefined") return;
  try {
    const current = readStoredSession();
    if (!current) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, accessToken }));
  } catch {
    // ignore storage errors
  }
}

export function clearStoredSession() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    document.cookie = "session=; path=/; max-age=0";
  } catch {
    // ignore
  }
}
