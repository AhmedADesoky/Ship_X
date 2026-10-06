// Shared by app-header.tsx (the page title) and flow-trail.tsx (a trail
// step's placeholder label before a detail page overrides it with a real
// entity name) — a pathname's first segment maps to the sidebar's own
// `nav.*` translation keys, falling back to the app name for routes with
// no matching key (e.g. dynamic detail routes like parties/[id]).
export function guessRouteLabel(
  pathname: string,
  tNav: { has: (key: string) => boolean; (key: never): string },
  tApp: (key: never) => string,
): string {
  const segment = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  // t.has() checks without logging — calling tNav() directly on a route
  // segment with no matching key reports a MISSING_MESSAGE console error
  // from next-intl even when the result is otherwise discarded.
  return tNav.has(segment) ? tNav(segment as never) : tApp("name" as never);
}
