"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname, Link } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/session";
import { guessRouteLabel } from "@/lib/route-label";
import { ShipXWordmark } from "@/components/brand/ship-x-logo";
import { LogOut, Globe, Menu, X, UserRound } from "lucide-react";

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppHeader() {
  const tNav = useTranslations("nav");
  const tApp = useTranslations("app");
  const tRoles = useTranslations("roles");
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { user, logout } = useSession();
  const { isMobile, open, openMobile } = useSidebar();
  const isSidebarOpen = isMobile ? openMobile : open;

  const title = guessRouteLabel(pathname, tNav, tApp);

  const otherLocale = locale === "en" ? "ar" : "en";

  return (
    <header className="glass sticky top-3 z-20 grid h-16 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-3xl px-4 sm:px-6">
      <div className="flex items-center gap-3 justify-self-start">
        <SidebarTrigger>
          {isSidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </SidebarTrigger>
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
      </div>

      <div className="flex items-center justify-self-center">
        <ShipXWordmark className="text-lg" tone="dark" />
      </div>

      <div className="flex items-center justify-self-end gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => router.replace(pathname, { locale: otherLocale })}
        >
          <Globe className="size-4" />
          {otherLocale.toUpperCase()}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex items-center gap-2 rounded-full py-1 ps-1 pe-3 transition hover:bg-accent">
                <Avatar className="size-8">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {initials(user?.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden flex-col items-start sm:flex">
                  <span className="text-sm font-medium leading-none">{user?.name ?? "—"}</span>
                </span>
                {user?.role && (
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {tRoles(user.role)}
                  </Badge>
                )}
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/profile" />}>
              <UserRound className="size-4" />
              {tNav("profile")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} variant="destructive">
              <LogOut className="size-4" />
              {tNav("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
