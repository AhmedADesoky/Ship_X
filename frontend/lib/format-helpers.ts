// camelCase/snake_case -> "Camel Case" / "Snake Case" so an unmapped field
// still reads as words instead of raw code, before checking for a nicer
// translated label. Shared by any page that renders a generic payload
// (audit log, pending actions).
export function humanizeKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

// Maps a raw route's first segment (e.g. "auth/refresh" -> "auth") to the
// key used under messages.*.audit.entityType, so a route path never has to
// be shown to the user as-is. Unrecognized segments fall back to
// humanizeKey() by the caller.
const ENTITY_TYPE_KEYS: Record<string, string> = {
  auth: "auth",
  users: "users",
  safes: "safes",
  categories: "categories",
  parties: "parties",
  transactions: "transactions",
  reconciliations: "reconciliations",
  settings: "settings",
  import: "import",
  "pending-actions": "pendingActions",
};

export function entityTypeKey(entityType: string): string {
  // AuditInterceptor stores the route with a leading slash (e.g.
  // "/auth/refresh"), so splitting on "/" without stripping it first
  // yields an empty first segment — an empty dropdown label/key.
  const first = entityType.replace(/^\/+/, "").split("/")[0];
  return ENTITY_TYPE_KEYS[first] ?? first;
}

export function formatPlainValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  }
  if (typeof value === "string") {
    // ISO-ish timestamps read nicer localized than raw.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    return value;
  }
  return String(value);
}
