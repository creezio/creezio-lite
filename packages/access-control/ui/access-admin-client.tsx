"use client";

/**
 * Écran admin « Rôles & accès » — matrice rôles × permissions groupées par
 * module (toggles allow/deny, réinitialisation au défaut), gestion du rôle
 * des comptes et journal d'audit. Consomme /api/v1/access/* (module natif
 * monté par app-runtime ; garde platform.access.manage côté serveur).
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Minus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@creezio/shell-ui";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@creezio/shell-ui/ui/kit";

type MatrixRole = {
  id: string;
  label: string;
  locked: boolean;
  defaults: string[];
  effective: string[];
};

type MatrixGroup = {
  id: string;
  label: string;
  permissions: Array<{ id: string; label: string }>;
};

type MatrixOverride = {
  role: string;
  permission: string;
  effect: "allow" | "deny";
  updatedBy: string | null;
  updatedAt: string;
};

type MatrixPayload = {
  ok: true;
  managePermission: string;
  roles: MatrixRole[];
  groups: MatrixGroup[];
  overrides: MatrixOverride[];
};

type AccessUser = {
  id: string;
  username: string;
  kind: string;
  active: boolean;
  kitRole: "owner" | "collaborator";
  role: string | null;
  permissions: string[];
  /** Permissions issues du rôle seul (sans overrides du compte). */
  roleBaseline: string[];
  /** Ajustements par compte (allow/deny) — priment sur le rôle. */
  overrides: Array<{ permission: string; effect: "allow" | "deny" }>;
};

type UsersPayload = {
  ok: true;
  users: AccessUser[];
  roles: Array<{ id: string; label: string }>;
  defaultRole: string | null;
};

type AuditEntry = {
  id: number;
  actor: string;
  action: string;
  role: string | null;
  permission: string | null;
  effect: string | null;
  targetUserId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

type Effect = "allow" | "deny" | "inherit";

const ACTION_LABELS: Record<string, string> = {
  "override.set": "Permission ajustée",
  "override.clear": "Override retiré",
  "user.role": "Rôle modifié",
  "user.override.set": "Permission de compte ajustée",
  "user.override.clear": "Permission de compte réinitialisée",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Matrice rôles × permissions — édition locale puis sauvegarde groupée. */
function MatrixPanel({ data, onSaved }: { data: MatrixPayload; onSaved: () => void }) {
  const initialDraft = useMemo(() => {
    const map = new Map<string, Effect>();
    for (const o of data.overrides) {
      map.set(`${o.role}${o.permission}`, o.effect);
    }
    return map;
  }, [data.overrides]);
  const [draft, setDraft] = useState<Map<string, Effect>>(initialDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(initialDraft), [initialDraft]);

  const defaultOf = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const role of data.roles) {
      const defaults = new Set(role.defaults);
      for (const group of data.groups) {
        for (const p of group.permissions) {
          map.set(`${role.id}${p.id}`, defaults.has(p.id));
        }
      }
    }
    return map;
  }, [data.roles, data.groups]);

  const effectiveOf = useCallback(
    (roleId: string, permissionId: string): boolean => {
      const effect = draft.get(`${roleId}${permissionId}`) ?? "inherit";
      if (effect === "allow") return true;
      if (effect === "deny") return false;
      return defaultOf.get(`${roleId}${permissionId}`) ?? false;
    },
    [draft, defaultOf],
  );

  const dirty =
    [...draft.entries()].some(
      ([key, effect]) => effect !== (initialDraft.get(key) ?? "inherit"),
    ) || draft.size !== initialDraft.size;

  function toggle(roleId: string, permissionId: string) {
    const key = `${roleId}${permissionId}`;
    const nextEffective = !effectiveOf(roleId, permissionId);
    const isDefault = defaultOf.get(key) ?? false;
    const effect: Effect =
      nextEffective === isDefault ? "inherit" : nextEffective ? "allow" : "deny";
    setDraft((prev) => {
      const next = new Map(prev);
      if (effect === "inherit") next.delete(key);
      else next.set(key, effect);
      return next;
    });
  }

  function resetCell(roleId: string, permissionId: string) {
    setDraft((prev) => {
      const next = new Map(prev);
      next.delete(`${roleId}${permissionId}`);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const changes: Array<{ role: string; permission: string; effect: Effect }> = [];
      const keys = new Set([...draft.keys(), ...initialDraft.keys()]);
      for (const key of keys) {
        const next = draft.get(key) ?? "inherit";
        const prev = initialDraft.get(key) ?? "inherit";
        if (next === prev) continue;
        const [role, permission] = key.split("");
        changes.push({ role, permission, effect: next });
      }
      const res = await fetch("/api/v1/access/matrix", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error || "Échec de la sauvegarde");
        return;
      }
      toast.success(
        changes.length > 0
          ? `${changes.length} changement${changes.length > 1 ? "s" : ""} appliqué${changes.length > 1 ? "s" : ""}`
          : "Aucun changement",
      );
      onSaved();
    } catch {
      toast.error("Échec de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Matrice des accès</CardTitle>
          <CardDescription>
            Toggles par rôle et par module. Un point marque un écart au défaut
            du rôle — réinitialisable cellule par cellule.
          </CardDescription>
        </div>
        <Button onClick={() => void save()} disabled={!dirty || saving} size="sm">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Enregistrer
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-4 text-left font-medium text-slate-500">
                Permission
              </th>
              {data.roles.map((role) => (
                <th
                  key={role.id}
                  className="min-w-[110px] px-2 py-2 text-center font-medium text-slate-700"
                >
                  {role.label}
                  {role.locked ? (
                    <span className="ml-1 text-[10px] font-normal text-slate-400">
                      (figé)
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group) => (
              <GroupRows
                key={group.id}
                group={group}
                roles={data.roles}
                effectiveOf={effectiveOf}
                isOverridden={(roleId, permissionId) =>
                  draft.has(`${roleId}${permissionId}`)
                }
                onToggle={toggle}
                onReset={resetCell}
              />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function GroupRows({
  group,
  roles,
  effectiveOf,
  isOverridden,
  onToggle,
  onReset,
}: {
  group: MatrixGroup;
  roles: MatrixRole[];
  effectiveOf: (roleId: string, permissionId: string) => boolean;
  isOverridden: (roleId: string, permissionId: string) => boolean;
  onToggle: (roleId: string, permissionId: string) => void;
  onReset: (roleId: string, permissionId: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-100 bg-slate-50/60">
        <td
          colSpan={roles.length + 1}
          className="px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
        >
          {group.label}
        </td>
      </tr>
      {group.permissions.map((permission) => (
        <tr
          key={permission.id}
          className="border-b border-slate-100 last:border-0"
        >
          <td className="py-1.5 pr-4">
            <div className="text-[13px] text-slate-800">{permission.label}</div>
            <div className="font-mono text-[11px] text-slate-400">
              {permission.id}
            </div>
          </td>
          {roles.map((role) => {
            const on = role.locked || effectiveOf(role.id, permission.id);
            const overridden =
              !role.locked && isOverridden(role.id, permission.id);
            return (
              <td key={role.id} className="px-2 py-1.5 text-center">
                <span className="relative inline-flex items-center">
                  <button
                    type="button"
                    disabled={role.locked}
                    onClick={() => onToggle(role.id, permission.id)}
                    title={
                      role.locked
                        ? "Le propriétaire a tous les accès"
                        : on
                          ? "Autorisé — cliquer pour refuser"
                          : "Refusé — cliquer pour autoriser"
                    }
                    data-creezio-aid={`access-cell-${role.id}-${permission.id}`}
                    className={cn(
                      "inline-flex h-6 w-10 items-center rounded-full transition-colors",
                      on ? "bg-emerald-500" : "bg-slate-200",
                      role.locked
                        ? "cursor-not-allowed opacity-60"
                        : "hover:opacity-90",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform",
                        on ? "translate-x-[18px]" : "translate-x-[2px]",
                      )}
                    >
                      {on ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Minus className="h-3 w-3 text-slate-400" />
                      )}
                    </span>
                  </button>
                  {overridden ? (
                    <button
                      type="button"
                      onClick={() => onReset(role.id, permission.id)}
                      title="Revenir au défaut du rôle"
                      className="absolute -right-5 text-amber-500 hover:text-amber-600"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/**
 * Éditeur des permissions d'UN compte — toggles tri-état vs le rôle :
 * inherit (suit le rôle) / allow / deny. Sauvegarde groupée par compte.
 */
function UserPermissionsEditor({
  user,
  groups,
  onSaved,
}: {
  user: AccessUser;
  groups: MatrixGroup[];
  onSaved: () => void;
}) {
  const initialDraft = useMemo(() => {
    const map = new Map<string, Effect>();
    for (const o of user.overrides) map.set(o.permission, o.effect);
    return map;
  }, [user.overrides]);
  const [draft, setDraft] = useState<Map<string, Effect>>(initialDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(initialDraft), [initialDraft]);

  const baseline = useMemo(() => new Set(user.roleBaseline), [user.roleBaseline]);

  const effectiveOf = useCallback(
    (permissionId: string): boolean => {
      const effect = draft.get(permissionId) ?? "inherit";
      if (effect === "allow") return true;
      if (effect === "deny") return false;
      return baseline.has(permissionId);
    },
    [draft, baseline],
  );

  const dirty =
    [...draft.entries()].some(
      ([key, effect]) => effect !== (initialDraft.get(key) ?? "inherit"),
    ) || draft.size !== initialDraft.size;

  function toggle(permissionId: string) {
    const nextEffective = !effectiveOf(permissionId);
    const fromRole = baseline.has(permissionId);
    const effect: Effect =
      nextEffective === fromRole ? "inherit" : nextEffective ? "allow" : "deny";
    setDraft((prev) => {
      const next = new Map(prev);
      if (effect === "inherit") next.delete(permissionId);
      else next.set(permissionId, effect);
      return next;
    });
  }

  function resetCell(permissionId: string) {
    setDraft((prev) => {
      const next = new Map(prev);
      next.delete(permissionId);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const changes: Array<{ permission: string; effect: Effect }> = [];
      const keys = new Set([...draft.keys(), ...initialDraft.keys()]);
      for (const key of keys) {
        const next = draft.get(key) ?? "inherit";
        const prev = initialDraft.get(key) ?? "inherit";
        if (next === prev) continue;
        changes.push({ permission: key, effect: next });
      }
      const res = await fetch(
        `/api/v1/access/users/${encodeURIComponent(user.id)}/permissions`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error || "Échec de la sauvegarde");
        return;
      }
      toast.success(
        changes.length > 0
          ? `Permissions de ${user.username} mises à jour`
          : "Aucun changement",
      );
      onSaved();
    } catch {
      toast.error("Échec de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] text-slate-500">
          Permissions du compte <strong>{user.username}</strong> — un point
          orange marque un écart au rôle (réinitialisable).
        </p>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving}
          data-creezio-aid={`access-user-perms-save-${user.username}`}
        >
          {saving ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-2 h-3.5 w-3.5" />
          )}
          Enregistrer
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.id} className="rounded border border-slate-200 bg-white p-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.permissions.map((permission) => {
                const on = effectiveOf(permission.id);
                const overridden = draft.has(permission.id);
                return (
                  <div
                    key={permission.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-[12px] text-slate-700" title={permission.id}>
                      {permission.label}
                    </span>
                    <span className="relative inline-flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => toggle(permission.id)}
                        title={
                          on
                            ? "Autorisé — cliquer pour refuser"
                            : "Refusé — cliquer pour autoriser"
                        }
                        data-creezio-aid={`access-user-cell-${user.username}-${permission.id}`}
                        className={cn(
                          "inline-flex h-5 w-9 items-center rounded-full transition-colors hover:opacity-90",
                          on ? "bg-emerald-500" : "bg-slate-200",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex h-4 w-4 transform items-center justify-center rounded-full bg-white shadow transition-transform",
                            on ? "translate-x-[18px]" : "translate-x-[2px]",
                          )}
                        >
                          {on ? (
                            <Check className="h-2.5 w-2.5 text-emerald-600" />
                          ) : (
                            <Minus className="h-2.5 w-2.5 text-slate-400" />
                          )}
                        </span>
                      </button>
                      {overridden ? (
                        <button
                          type="button"
                          onClick={() => resetCell(permission.id)}
                          title="Revenir au rôle"
                          className="absolute -right-4 text-amber-500 hover:text-amber-600"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Comptes — changement de rôle immédiat + permissions par compte. */
function UsersPanel({
  data,
  groups,
  onChanged,
}: {
  data: UsersPayload;
  groups: MatrixGroup[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function setRole(userId: string, role: string | null) {
    setBusyId(userId);
    try {
      const res = await fetch(
        `/api/v1/access/users/${encodeURIComponent(userId)}/role`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error || "Échec du changement de rôle");
        return;
      }
      toast.success("Rôle mis à jour");
      onChanged();
    } catch {
      toast.error("Échec du changement de rôle");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Comptes</CardTitle>
        <CardDescription>
          Rôle de chaque compte + permissions par compte (cliquer sur le
          compteur pour ajuster module par module). Les changements suivent
          immédiatement (sidebar et API) — sans réinitialiser de mot de passe.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-4 text-left font-medium text-slate-500">
                Compte
              </th>
              <th className="py-2 pr-4 text-left font-medium text-slate-500">
                Type
              </th>
              <th className="py-2 pr-4 text-left font-medium text-slate-500">
                Rôle
              </th>
              <th className="py-2 text-left font-medium text-slate-500">
                Permissions
              </th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((user) => (
              <Fragment key={user.id}>
                <tr className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-2 text-[13px] text-slate-800">
                      <UserRound className="h-3.5 w-3.5 text-slate-400" />
                      {user.username}
                      {!user.active ? (
                        <Badge variant="outline" className="text-[10px]">
                          inactif
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-[12px] text-slate-500">
                    {user.kind === "ai" ? "Agent IA" : "Humain"}
                  </td>
                  <td className="py-2 pr-4">
                    {user.kitRole === "owner" ? (
                      <Badge variant="secondary">Propriétaire</Badge>
                    ) : (
                      <Select
                        value={user.role ?? ""}
                        onValueChange={(value) =>
                          void setRole(user.id, value === "" ? null : value)
                        }
                        disabled={busyId === user.id}
                      >
                        <SelectTrigger className="h-8 w-[180px]">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {data.defaultRole !== null ? (
                            <SelectItem value="">
                              Par défaut ({data.defaultRole})
                            </SelectItem>
                          ) : null}
                          {data.roles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="py-2 text-[12px] text-slate-500">
                    {user.kitRole === "owner" ? (
                      <span title={user.permissions.join("\n")}>
                        toutes (propriétaire)
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId((cur) =>
                            cur === user.id ? null : user.id,
                          )
                        }
                        data-creezio-aid={`access-user-perms-${user.username}`}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
                        title={user.permissions.join("\n")}
                      >
                        {user.permissions.length} permission
                        {user.permissions.length > 1 ? "s" : ""}
                        {user.overrides.length > 0 ? (
                          <span className="text-amber-500">
                            ({user.overrides.length} écart
                            {user.overrides.length > 1 ? "s" : ""})
                          </span>
                        ) : null}
                        <span className="text-slate-400">
                          {expandedId === user.id ? "▲" : "▼"}
                        </span>
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === user.id && user.kitRole !== "owner" ? (
                  <tr className="border-b border-slate-100 last:border-0">
                    <td colSpan={4} className="py-2">
                      <UserPermissionsEditor
                        user={user}
                        groups={groups}
                        onSaved={onChanged}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Journal d'audit des changements d'accès. */
function AuditPanel({ entries }: { entries: AuditEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Journal d&apos;audit</CardTitle>
        <CardDescription>
          Derniers changements de rôles et de permissions (plus récents en
          premier).
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Aucun changement enregistré.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-4 text-left font-medium text-slate-500">
                  Date
                </th>
                <th className="py-2 pr-4 text-left font-medium text-slate-500">
                  Acteur
                </th>
                <th className="py-2 pr-4 text-left font-medium text-slate-500">
                  Action
                </th>
                <th className="py-2 text-left font-medium text-slate-500">
                  Détail
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="whitespace-nowrap py-1.5 pr-4 text-[12px] text-slate-500">
                    {entry.createdAt}
                  </td>
                  <td className="py-1.5 pr-4 text-[13px] text-slate-800">
                    {entry.actor}
                  </td>
                  <td className="py-1.5 pr-4">
                    <Badge variant="outline" className="text-[11px]">
                      {actionLabel(entry.action)}
                    </Badge>
                  </td>
                  <td className="py-1.5 font-mono text-[11px] text-slate-500">
                    {entry.action === "user.role"
                      ? `${String(entry.detail?.username ?? entry.targetUserId ?? "")} : ${String(entry.detail?.from ?? "—")} → ${entry.role ?? "—"}`
                      : entry.action.startsWith("user.override")
                        ? `${String(entry.detail?.username ?? entry.targetUserId ?? "")} · ${entry.permission ?? ""}${
                            entry.effect ? ` → ${entry.effect}` : " → rôle"
                          }`
                        : `${entry.role ?? ""} · ${entry.permission ?? ""}${
                            entry.effect ? ` → ${entry.effect}` : ""
                          }`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export function AccessAdminClient() {
  const [matrix, setMatrix] = useState<MatrixPayload | null>(null);
  const [users, setUsers] = useState<UsersPayload | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [matrixRes, usersRes, auditRes] = await Promise.all([
        fetch("/api/v1/access/matrix"),
        fetch("/api/v1/access/users"),
        fetch("/api/v1/access/audit?limit=100"),
      ]);
      if (matrixRes.status === 404) {
        setError("Le module access-control n'est pas configuré pour cette marque.");
        setLoading(false);
        return;
      }
      if (matrixRes.status === 401 || matrixRes.status === 403) {
        setError("Accès réservé (permission platform.access.manage).");
        setLoading(false);
        return;
      }
      if (!matrixRes.ok || !usersRes.ok || !auditRes.ok) {
        setError("Chargement impossible — réessayer.");
        setLoading(false);
        return;
      }
      setMatrix((await matrixRes.json()) as MatrixPayload);
      setUsers((await usersRes.json()) as UsersPayload);
      setAudit(((await auditRes.json()) as { entries?: AuditEntry[] }).entries ?? []);
      setLoading(false);
    } catch {
      setError("Chargement impossible — réessayer.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-slate-500" />
        <h1 className="text-lg font-semibold text-slate-900">Rôles &amp; accès</h1>
      </div>
      <Tabs defaultValue="matrix">
        <TabsList>
          <TabsTrigger value="matrix">Matrice des rôles</TabsTrigger>
          <TabsTrigger value="users">Comptes</TabsTrigger>
          <TabsTrigger value="audit">Journal</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix" className="pt-4">
          {matrix ? (
            <MatrixPanel data={matrix} onSaved={() => void load()} />
          ) : null}
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          {users ? (
            <UsersPanel
              data={users}
              groups={matrix?.groups ?? []}
              onChanged={() => void load()}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="audit" className="pt-4">
          <AuditPanel entries={audit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}