"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import { EmptyState } from "./empty-state";
import { usePermission } from "@/lib/use-permission";
import { usePathname } from "@/i18n/navigation";
import { permissionForRoute } from "@/lib/permissions";
import type { Permission } from "@/lib/api-client";

/**
 * Gates an entire page behind a permission — renders children when the
 * logged-in user has it, otherwise a "no permission" state instead of the
 * page content. This is what actually stops a worker from seeing a page's
 * UI (charts, buttons, forms) they have no permission for; proxy.ts's
 * middleware redirect is a second, earlier layer for the same route→
 * permission map (see lib/permissions.ts), and the backend's RolesGuard is
 * the real security boundary underneath both — this component is purely
 * about not showing someone a shell they can't use.
 *
 * `permission` is optional (Phase 34a) — when omitted, it's derived
 * automatically from the current pathname via lib/permissions.ts's
 * ROUTE_PERMISSIONS, the same single source of truth the sidebar and
 * proxy.ts already use, so a page can never drift out of sync with its own
 * route entry by hardcoding a stale/different permission here. Pass an
 * explicit override only for the rare case a component needs a permission
 * check unrelated to its own route.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission?: Permission | Permission[] | null;
  children: ReactNode;
}) {
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const effectivePermission = permission !== undefined ? permission : permissionForRoute(pathname);
  const allowed = usePermission(effectivePermission);

  if (!allowed) {
    return (
      <EmptyState
        icon={ShieldOff}
        title={tCommon("noPermissionTitle")}
        description={tCommon("noPermissionDescription")}
      />
    );
  }

  return <>{children}</>;
}
