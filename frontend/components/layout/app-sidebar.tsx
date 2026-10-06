"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useSession } from "@/lib/session";
import { ROUTE_PERMISSIONS, hasPermission } from "@/lib/permissions";
import { useFlowTrail } from "@/lib/flow-trail";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShipXWordmark } from "@/components/brand/ship-x-logo";
import {
  LayoutDashboard,
  Landmark,
  Users2,
  ShieldCheck,
  UsersRound,
  LogOut,
  Truck,
  UserCheck,
  ArrowLeftRight,
  BarChart3,
  Scale,
  Settings as SettingsIcon,
  FileSpreadsheet,
  TrendingDown,
  TrendingUp,
  Wallet,
  Receipt,
  ClipboardCheck,
  Bike,
} from "lucide-react";

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const NAV_ITEMS = [
  { href: "/dashboard", key: "dashboard" as const, icon: LayoutDashboard },
  { href: "/safes", key: "safes" as const, icon: Landmark },
  { href: "/transactions", key: "transactions" as const, icon: ArrowLeftRight },
  { href: "/expenses", key: "expenses" as const, icon: TrendingDown },
  { href: "/income", key: "income" as const, icon: TrendingUp },
  { href: "/senders", key: "senders" as const, icon: Truck },
  { href: "/agents", key: "agents" as const, icon: UserCheck },
  { href: "/couriers", key: "couriers" as const, icon: Bike },
  { href: "/drawings", key: "drawings" as const, icon: Wallet },
  { href: "/deferred", key: "deferred" as const, icon: Receipt },
  { href: "/clients", key: "clients" as const, icon: Users2 },
  { href: "/reports", key: "reports" as const, icon: BarChart3 },
  { href: "/reconciliation", key: "reconciliation" as const, icon: Scale },
  { href: "/import", key: "import" as const, icon: FileSpreadsheet },
  { href: "/users", key: "users" as const, icon: UsersRound },
  { href: "/pending", key: "pending" as const, icon: ClipboardCheck },
  { href: "/audit", key: "audit" as const, icon: ShieldCheck },
  { href: "/settings", key: "settings" as const, icon: SettingsIcon },
].map((item) => ({ ...item, requiredPermission: ROUTE_PERMISSIONS[item.href] ?? null }));

/**
 * TODO(supabase-auth): permission data here comes from the client-side
 * session stub (see lib/session.tsx). It's a UX convenience only — the
 * backend's RolesGuard is the real enforcement, and proxy.ts is a second
 * layer, so a user who edits localStorage still can't reach protected data.
 */
export function AppSidebar() {
  const t = useTranslations("nav");
  const tRoles = useTranslations("roles");
  const pathname = usePathname();
  const locale = useLocale();
  const { user, logout } = useSession();
  const { resetTrail } = useFlowTrail();

  return (
    <Sidebar
      side={locale === "ar" ? "right" : "left"}
      variant="floating"
      className="border-none text-sidebar-foreground"
    >
      <SidebarHeader className="flex items-center justify-center px-5 py-6">
        <ShipXWordmark className="text-lg" tone="light" pill />
      </SidebarHeader>
      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {NAV_ITEMS.filter((item) => hasPermission(user, item.requiredPermission)).map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href} className="mx-1">
                    <SidebarMenuButton
                      isActive={active}
                      className={cn(
                        "rounded-full text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        active &&
                          "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground shadow-sm",
                      )}
                      render={<Link href={item.href} onClick={() => resetTrail(t(item.key), item.href)} />}
                    >
                      <Icon className="size-4" />
                      {t(item.key)}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 pb-5">
        {user && (
          <div className="mb-2 flex items-center gap-2 rounded-2xl bg-sidebar-accent/60 px-3 py-2 text-xs">
            <Avatar className="size-8 shrink-0">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium text-sidebar-foreground">{user.name}</p>
              <p className="text-sidebar-foreground/60">{tRoles(user.role)}</p>
            </div>
          </div>
        )}
        <Button
          variant="outline"
          className="w-full justify-center gap-2 border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={logout}
        >
          <LogOut className="size-4" />
          {t("logout")}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
