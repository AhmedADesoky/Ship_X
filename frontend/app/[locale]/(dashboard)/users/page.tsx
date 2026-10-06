"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { RequirePermission } from "@/components/layout/require-permission";
import { ALL_PERMISSIONS, api, ApiError, type Permission, type SessionUser } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { MoreVertical, Plus, UsersRound } from "lucide-react";

const ROLES: SessionUser["role"][] = ["OWNER", "MANAGER", "ACCOUNTANT", "EMPLOYEE"];

// Mirrors backend/src/common/role-permissions.ts — for UI hinting only
// (showing which permissions a role already grants by default, so the
// checklist below only needs to cover the extra, per-user grants). The
// backend is the real source of truth and re-validates independently.
const ROLE_BASE_PERMISSIONS: Record<SessionUser["role"], Permission[]> = {
  OWNER: [
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
    "manage_transactions",
    "manage_reconciliations",
    "manage_settings",
    "manage_import",
    "manage_pending_actions",
    "reset_system",
    "delete_users",
  ],
  MANAGER: [
    "view_reports",
    "view_dashboard",
    "view_safes",
    "edit_transactions",
    "manage_users",
    "view_audit_log",
    "manage_safes",
    "manage_categories",
    "manage_parties",
    "manage_transactions",
    "manage_reconciliations",
    "manage_settings",
    "manage_import",
    "manage_pending_actions",
  ],
  ACCOUNTANT: [
    "view_reports",
    "edit_transactions",
    "manage_safes",
    "manage_categories",
    "manage_parties",
    "manage_transactions",
    "manage_reconciliations",
    "manage_import",
  ],
  // Deliberately empty — mirrors backend/src/common/role-permissions.ts's
  // EMPLOYEE default. An Employee has ONLY whatever's checked below; there
  // is no implicit baseline (unlike the other three roles).
  EMPLOYEE: [],
};

function UserFormDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: SessionUser;
}) {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const tRoles = useTranslations("roles");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.name ?? "");
  const [title, setTitle] = useState(user?.title ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<SessionUser["role"]>(user?.role ?? "EMPLOYEE");
  const [password, setPassword] = useState("");
  // Permissions are now fully free-form for every role except OWNER (whose
  // permissions are hardcoded-full server-side and never row-driven — see
  // role-permissions.ts). Initialized from the user's full `permissions`
  // (not `extraPermissions`): post-backfill the two are the same list for
  // non-OWNER roles, but `permissions` is the field that actually reflects
  // what the account can currently do.
  const [extraPermissions, setExtraPermissions] = useState<string[]>(user?.permissions ?? []);

  function togglePermission(permission: Permission, checked: boolean) {
    setExtraPermissions((prev) =>
      checked ? [...new Set([...prev, permission])] : prev.filter((p) => p !== permission),
    );
  }

  // Only a convenience default when creating a brand-new user — picking a
  // role pre-fills the checklist with that role's suggested starting
  // permissions, but every box stays freely editable afterward (including
  // this one). Never runs for an existing user being edited, so switching
  // the role dropdown on an edit doesn't clobber their current grants.
  function handleRoleChange(nextRole: SessionUser["role"]) {
    setRole(nextRole);
    if (!user) setExtraPermissions(ROLE_BASE_PERMISSIONS[nextRole]);
  }

  const mutation = useMutation({
    mutationFn: () =>
      user
        ? api.users.update(
            user.id,
            { name, title: title || undefined, role, extraPermissions, ...(password ? { password } : {}) },
            accessToken ?? undefined,
          )
        : api.users.create(
            { email, name, title: title || undefined, role, password, extraPermissions },
            accessToken ?? undefined,
          ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(tCommon("success"));
      onOpenChange(false);
      if (!user) {
        setName("");
        setTitle("");
        setEmail("");
        setRole("EMPLOYEE");
        setPassword("");
        setExtraPermissions([]);
      }
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{user ? t("editUserTitle") : t("addUserTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-name">{t("name")}</Label>
            <Input id="user-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-title">{t("jobTitle")}</Label>
            <Input
              id="user-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("jobTitlePlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("jobTitleHint")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-email">{t("email")}</Label>
            <Input
              id="user-email"
              type="email"
              required
              disabled={!!user}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("role")}</Label>
            <Select value={role} onValueChange={(v) => handleRoleChange((v as SessionUser["role"]) ?? "EMPLOYEE")}>
              <SelectTrigger className="w-full">
                <SelectValue>{tRoles(role)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tRoles(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("permissions")}</Label>
            <p className="text-xs text-muted-foreground">
              {role === "OWNER" ? t("ownerAlwaysFullAccess") : t("permissionsHint")}
            </p>
            <div className="grid max-h-32 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto rounded-2xl border border-border bg-muted/30 p-3 scrollbar-hide sm:grid-cols-2">
              {ALL_PERMISSIONS.map((permission) => {
                const checked = role === "OWNER" || extraPermissions.includes(permission);
                return (
                  <label
                    key={permission}
                    className={`flex items-center gap-2 text-sm ${role === "OWNER" ? "opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 rounded"
                      checked={checked}
                      disabled={role === "OWNER"}
                      onChange={(e) => togglePermission(permission, e.target.checked)}
                    />
                    <span className="truncate">{t(`permissionLabels.${permission}`)}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-password">{user ? t("newPassword") : t("password")}</Label>
            <Input
              id="user-password"
              type="password"
              required={!user}
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={user ? t("newPasswordPlaceholder") : undefined}
            />
            <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {user ? tCommon("save") : tCommon("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  return (
    <RequirePermission>
      <UsersPageContent />
    </RequirePermission>
  );
}

function UsersPageContent() {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const tRoles = useTranslations("roles");
  const { accessToken, user: currentUser } = useSession();
  const queryClient = useQueryClient();

  const [showInactive, setShowInactive] = useState(false);

  const {
    data: users,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["users", showInactive],
    queryFn: () => api.users.list(accessToken ?? undefined, showInactive),
    enabled: !!accessToken,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SessionUser | null>(null);
  const [search, setSearch] = useState("");

  const filteredUsers = users?.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const deactivateMutation = useMutation({
    mutationFn: (u: SessionUser) => api.users.update(u.id, { active: !u.active }, accessToken ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(tCommon("success"));
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            {t("addUser")}
          </Button>
        }
      />

      <UserFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editing && <UserFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} user={editing} />}

      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder={tCommon("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(!!v)} />
          {t("showInactive")}
        </label>
      </div>

      <Card className="glass">
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState message={error instanceof ApiError ? error.message : undefined} onRetry={() => refetch()} />
          ) : filteredUsers && filteredUsers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("email")}</TableHead>
                  <TableHead>{t("role")}</TableHead>
                  <TableHead>{t("active")}</TableHead>
                  <TableHead className="text-right">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{u.name}</span>
                        {u.title && <span className="text-xs text-muted-foreground">{u.title}</span>}
                      </div>
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tRoles(u.role)}</Badge>
                    </TableCell>
                    <TableCell>{u.active ? "✓" : "—"}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreVertical className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(u)}>{tCommon("edit")}</DropdownMenuItem>
                          {u.id !== currentUser?.id && (
                            <DropdownMenuItem
                              variant={u.active ? "destructive" : undefined}
                              onClick={() => {
                                if (!u.active || confirm(tCommon("confirmDelete"))) deactivateMutation.mutate(u);
                              }}
                            >
                              {u.active ? t("deactivate") : t("activate")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={UsersRound} title={t("noUsers")} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
