"use client";

/**
 * Section « Clés API » des Paramètres — création / révocation des clés
 * publiques product_live_... (Zapier / Make / n8n). La clé complète n'est
 * montrée qu'une fois à la création ; ensuite seul le prefix est visible.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BookOpen, Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../primitives/card";

export type ApiKeyItem = {
  id: number;
  name: string;
  prefix: string;
  scopes: string;
  user_id?: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type LinkableUser = { id: string; username: string; kind: "human" | "ai" };

function formatDate(value: string | null): string {
  if (!value) return "jamais";
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

export function ApiKeysSettings({
  initialKeys,
  linkableUsers,
  /** @deprecated → linkableUsers (compat Fidu/TF page props). */
  users,
}: {
  /** Si omis, charge GET /api/v1/api-keys au mount (page OS client). */
  initialKeys?: ApiKeyItem[];
  linkableUsers?: LinkableUser[];
  users?: Array<{ id: string; username: string; role?: string; kind?: "human" | "ai" }>;
}) {
  const [resolvedUsers, setResolvedUsers] = useState<LinkableUser[]>(
    () =>
      linkableUsers ??
      (users || []).map((u) => ({
        id: u.id,
        username: u.username,
        kind: u.kind ?? (u.role === "ai" || u.role === "agent" ? "ai" : "human"),
      })),
  );
  const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys ?? []);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("full");
  const [linkedUser, setLinkedUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialKeys) {
      setKeys(initialKeys);
      return;
    }
    let cancelled = false;
    void fetch("/api/v1/api-keys")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { api_keys?: ApiKeyItem[] } | null) => {
        if (!cancelled && Array.isArray(data?.api_keys)) setKeys(data.api_keys);
      })
      .catch(() => {
        /* liste vide tant que l'API est indisponible */
      });
    return () => {
      cancelled = true;
    };
  }, [initialKeys]);

  useEffect(() => {
    if (linkableUsers || users) {
      setResolvedUsers(
        linkableUsers ??
          (users || []).map((u) => ({
            id: u.id,
            username: u.username,
            kind: u.kind ?? (u.role === "ai" || u.role === "agent" ? "ai" : "human"),
          })),
      );
      return;
    }
    let cancelled = false;
    void fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { users?: Array<{ id: string; username: string; kind?: string; active?: boolean }> } | null) => {
        if (cancelled || !Array.isArray(data?.users)) return;
        setResolvedUsers(
          data.users
            .filter((u) => u.active !== false)
            .map((u) => ({
              id: u.id,
              username: u.username,
              kind: u.kind === "ai" ? "ai" : "human",
            })),
        );
      })
      .catch(() => {
        /* owner-only endpoint ; hors droits → liste vide */
      });
    return () => {
      cancelled = true;
    };
  }, [linkableUsers, users]);

  const requiresUser = scope === "tasks:run";

  async function createKey() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.message("Donnez un nom à la clé (ex. « Zapier production »)");
      return;
    }
    if (requiresUser && !linkedUser) {
      toast.message("Le scope « Tâches IA » exige un utilisateur lié");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          scopes: scope,
          user_id: linkedUser || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
      const created = data as { key: string; api_key: ApiKeyItem };
      setKeys((prev) => [created.api_key, ...prev]);
      setFreshKey(created.key);
      setCopied(false);
      setName("");
      setScope("full");
      setLinkedUser("");
      toast.success("Clé API créée — copiez-la maintenant, elle ne sera plus affichée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: number) {
    if (!window.confirm("Révoquer cette clé ? Les intégrations qui l'utilisent cesseront de fonctionner.")) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/api-keys/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
      setKeys((prev) =>
        prev.map((k) =>
          k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k,
        ),
      );
      toast.success("Clé révoquée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Révocation impossible");
    }
  }

  async function copyFreshKey() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
      toast.success("Clé copiée dans le presse-papiers");
    } catch {
      toast.error("Copie impossible — sélectionnez la clé manuellement");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-sky-600" />
          Clés API
        </CardTitle>
        <CardDescription>
          Automatisez Creezio avec Zapier, Make ou n8n. Chaque clé donne un
          accès complet à l&apos;API (120 requêtes/minute).{" "}
          <Link
            href="/developers"
            className="inline-flex items-center gap-1 font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Documentation API
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {freshKey ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-900">
              Votre nouvelle clé — copiez-la maintenant, elle ne sera plus jamais affichée :
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-[13px] text-emerald-950">
                {freshKey}
              </code>
              <Button size="sm" variant="outline" onClick={copyFreshKey}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copiée" : "Copier"}
              </Button>
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-emerald-700 underline underline-offset-2"
              onClick={() => setFreshKey(null)}
            >
              J&apos;ai copié la clé, masquer
            </button>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-[13px] font-medium text-slate-700">Nouvelle clé</p>
              <input
                className={inputCls}
                placeholder="Nom (ex. Zapier production)"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createKey();
                }}
              />
            </div>
            <Button onClick={createKey} disabled={busy} className="shrink-0">
              <Plus className="h-4 w-4" />
              {busy ? "Création…" : "Créer la clé"}
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-[13px] font-medium text-slate-700">Portée (scope)</p>
              <select
                className={inputCls}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="full">Accès complet (full)</option>
                <option value="crm:read">Lecture CRM (crm:read)</option>
                <option value="crm:write">Lecture + écriture CRM (crm:write)</option>
                <option value="tasks:run">Réveil des collaborateurs IA (tasks:run)</option>
              </select>
            </div>
            {requiresUser ? (
              <div className="min-w-0 flex-1">
                <p className="mb-1.5 text-[13px] font-medium text-slate-700">
                  Agir au nom de
                </p>
                <select
                  className={inputCls}
                  value={linkedUser}
                  onChange={(e) => setLinkedUser(e.target.value)}
                >
                  <option value="">— Choisir un utilisateur —</option>
                  {resolvedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                      {u.kind === "ai" ? " (IA)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {requiresUser ? (
            <p className="text-xs text-slate-500">
              Cette clé pourra créer et suivre des tâches de collaborateurs IA au nom de
              l&apos;utilisateur choisi (ex. depuis ChatGPT via le MCP, ou n8n).
            </p>
          ) : null}
        </div>

        {keys.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune clé pour l&apos;instant. Créez-en une pour connecter Zapier, Make ou n8n.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <span className="truncate">{k.name}</span>
                    {k.revoked_at ? (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                        Révoquée
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Active
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    <code className="font-mono">{k.prefix}…</code>
                    {" · "}créée le {formatDate(k.created_at)}
                    {" · "}dernière utilisation : {formatDate(k.last_used_at)}
                  </p>
                </div>
                {!k.revoked_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => revokeKey(k.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Révoquer
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
