"use client";

/**
 * Configuration en mode serveur web (navigateur → serveur headless Docker).
 *
 * Hors Electron, `getShellDesktopApi()` est absent : les panneaux Desktop*
 * historiques se rendaient null et TOUS les onglets de Configuration étaient
 * vides. Ces cartes consomment la surface HTTP que le serveur expose déjà
 * (`/api/v1/os/*`, `/api/v1/core/version`, `/api/v1/platform/llm-keys`) pour
 * rendre chaque onglet réel : statut Hermes/n8n, tunnel et URLs publiques,
 * version d'image, clés IA (owner).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Network,
  RefreshCw,
  ServerCog,
  Workflow,
} from "lucide-react";
import { getShellUiBrand } from "@creezio/shell-ui";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../primitives/card";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone =
    status === "running" || status === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : status === "installing" || status === "starting"
        ? "border-sky-200 bg-sky-50 text-sky-900"
        : status === "missing" || status === "error"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

const SERVICE_STATUS_LABELS: Record<string, string> = {
  running: "En cours",
  stopped: "Arrêté",
  missing: "Runtime absent",
  installing: "Installation…",
  starting: "Démarrage…",
  error: "Erreur",
  ready: "Prêt",
};

/* ── Connexion : instance serveur ────────────────────────────────────────── */

type CoreVersion = {
  ok: boolean;
  version: string;
  architectureVersion?: string;
  brandId?: string;
};

/** Onglet Connexion en web : cette page EST le serveur — identité + version. */
export function ServerInstanceCard() {
  const [version, setVersion] = useState<CoreVersion | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    void getJson<CoreVersion>("/api/v1/core/version").then(setVersion);
  }, []);

  const productName = getShellUiBrand().productName;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4" />
          Serveur {productName}
        </CardTitle>
        <CardDescription>
          Vous êtes connecté directement au serveur : tous les postes et
          mobiles utilisent cette même URL. Le profil Héberger / Rejoindre ne
          concerne que l&apos;application desktop.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="rounded-md border bg-muted/40 px-3 py-2">
          URL du serveur :{" "}
          <span className="font-medium text-foreground">{origin || "…"}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Version {version?.version ?? "…"}
          {version?.architectureVersion
            ? ` · architecture ${version.architectureVersion}`
            : ""}
          {version?.brandId ? ` · ${version.brandId}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── Hermes / n8n : statut + ensure ──────────────────────────────────────── */

type ServiceKind = "hermes" | "n8n";

type ServiceStatusPayload = {
  status?: string;
  mode?: string;
  version?: string | null;
  detail?: string;
  apiUrl?: string | null;
  webuiUrl?: string | null;
  uiUrl?: string | null;
  bootstrapPhase?: string;
  bootstrapError?: string | null;
};

type ServiceStatusResponse = {
  ok: boolean;
  status?: ServiceStatusPayload;
  nativeReady?: boolean;
};

const SERVICE_META: Record<
  ServiceKind,
  { title: string; description: string; icon: typeof Bot }
> = {
  hermes: {
    title: "Hermes (agent IA)",
    description:
      "Cerveau IA embarqué du serveur : exécute les tâches IA du kanban et pilote le web.",
    icon: Bot,
  },
  n8n: {
    title: "n8n (automatisations)",
    description:
      "Moteur de workflows embarqué : webhooks, intégrations et automatisations.",
    icon: Workflow,
  },
};

/** Statut Hermes/n8n en web : GET /api/v1/os/{kind}/status + ensure. */
export function ServerServiceStatusCard({ kind }: { kind: ServiceKind }) {
  const [payload, setPayload] = useState<ServiceStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = SERVICE_META[kind];
  const Icon = meta.icon;

  const refresh = useCallback(async () => {
    setPayload(await getJson<ServiceStatusResponse>(`/api/v1/os/${kind}/status`));
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onEnsure() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/os/${kind}/ensure`, { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; detail?: string };
      if (body.ok) toast.success(body.detail || "Service vérifié");
      else toast.error(body.detail || "Vérification en échec");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const st = payload?.status;
  const status = st?.status || (payload === null ? "" : "unknown");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {meta.title}
        </CardTitle>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {status ? (
            <StatusPill
              status={status}
              label={SERVICE_STATUS_LABELS[status] || status}
            />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {st?.version ? (
            <span className="text-xs text-muted-foreground">
              v{st.version}
            </span>
          ) : null}
          {st?.mode ? (
            <span className="text-xs text-muted-foreground">({st.mode})</span>
          ) : null}
        </div>
        {st?.detail ? (
          <p className="text-xs text-muted-foreground">{st.detail}</p>
        ) : null}
        {st?.bootstrapError ? (
          <p className="text-xs text-destructive">{st.bootstrapError}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void onEnsure()}
          >
            {busy ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Vérifier / démarrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Tunnel : URLs publiques ─────────────────────────────────────────────── */

type TunnelStatusResponse = {
  ok: boolean;
  status?: {
    configured?: boolean;
    online?: boolean;
    slug?: string | null;
    hostname?: string | null;
    publicUrl?: string | null;
    publicUrls?: { crm?: string; n8n?: string; hermes?: string } | null;
    error?: string | null;
  } | null;
  publicMcp?: string | null;
};

/** true si la session courante est le compte propriétaire (non impersoné). */
async function fetchIsOwner(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/auth/me", { cache: "no-store" });
    if (!res.ok) return false;
    const me = (await res.json()) as {
      role?: string;
      impersonating?: boolean;
    };
    return me.role === "owner" && !me.impersonating;
  } catch {
    return false;
  }
}

const TUNNEL_SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])$/;

/**
 * Accès distant en web : GET /api/v1/os/tunnel/status + actions owner
 * (/api/v1/platform/tunnel/* — miroir HTTP des IPC tunnel:* desktop).
 */
export function ServerTunnelCard() {
  const [payload, setPayload] = useState<TunnelStatusResponse | null>(null);
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState("");
  const [checking, setChecking] = useState(false);
  const [avail, setAvail] = useState<{
    available: boolean;
    reason?: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setPayload(await getJson<TunnelStatusResponse>("/api/v1/os/tunnel/status"));
  }, []);

  useEffect(() => {
    void refresh();
    void fetchIsOwner().then(setOwner);
  }, [refresh]);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copiée");
    } catch {
      toast.error("Impossible de copier l'URL");
    }
  }

  async function tunnelAction(action: "start" | "stop") {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/platform/tunnel/${action}`, {
        method: "POST",
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error || "Action impossible");
        return;
      }
      toast.success(
        action === "start" ? "Tunnel démarré" : "Tunnel arrêté",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function checkSlug() {
    const s = slug.trim().toLowerCase();
    if (!TUNNEL_SLUG_RE.test(s)) {
      setAvail({
        available: false,
        reason: "Slug invalide (a-z, 0-9, tirets, 2–48 car.)",
      });
      return;
    }
    setChecking(true);
    setAvail(null);
    try {
      const res = await fetch("/api/v1/platform/tunnel/check-slug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: s }),
      });
      setAvail((await res.json()) as { available: boolean; reason?: string });
    } catch (e) {
      setAvail({
        available: false,
        reason: e instanceof Error ? e.message : "Erreur réseau",
      });
    } finally {
      setChecking(false);
    }
  }

  async function reserve() {
    const s = slug.trim().toLowerCase();
    if (!TUNNEL_SLUG_RE.test(s)) {
      toast.error("Slug invalide");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/platform/tunnel/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: s }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        hostname?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error(body.error || "Réservation impossible");
        return;
      }
      toast.success(`Réservé : ${body.hostname}`);
      setSlug("");
      setAvail(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const st = payload?.status;
  const configured = st?.configured ?? false;
  const online = st?.online ?? false;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" />
          Accès distant (tunnel)
        </CardTitle>
        <CardDescription>
          URLs publiques HTTPS de ce serveur. Le propriétaire peut démarrer /
          arrêter le tunnel ou réserver un nouveau sous-domaine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {payload === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !configured ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
            Aucun tunnel configuré sur cette instance.
          </p>
        ) : (
          <>
            <p
              className={
                online
                  ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800"
                  : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
              }
            >
              {online
                ? `En ligne — ${st?.hostname || st?.publicUrl}`
                : `Hors ligne — ${st?.hostname || "tunnel configuré"}`}
            </p>
            <ul className="space-y-1 font-mono text-[12px]">
              {(
                [
                  ["CRM", st?.publicUrls?.crm || st?.publicUrl],
                  ["n8n", st?.publicUrls?.n8n],
                  ["Hermes", st?.publicUrls?.hermes],
                  ["MCP", payload.publicMcp],
                ] as const
              )
                .filter(([, url]) => Boolean(url))
                .map(([label, url]) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 font-sans text-xs text-muted-foreground">
                      {label}
                    </span>
                    <span className="truncate">{url}</span>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => void copy(String(url))}
                      aria-label={`Copier l'URL ${label}`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
            </ul>
            {owner ? (
              <div className="flex flex-wrap gap-2">
                {online ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void tunnelAction("stop")}
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Arrêter le tunnel
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void tunnelAction("start")}
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Démarrer le tunnel
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
        {st?.error ? (
          <p className="text-xs text-destructive">{st.error}</p>
        ) : null}
        {owner && payload !== null ? (
          <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-3">
            <p className="text-xs font-medium text-slate-700">
              {configured
                ? "Réserver un autre sous-domaine (remplace l'actuel)"
                : "Réserver un sous-domaine"}
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={slug}
                onChange={(e) => {
                  setSlug(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  );
                  setAvail(null);
                }}
                placeholder="mon-restaurant"
                className="flex-1"
                maxLength={48}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={checking || !slug}
                onClick={() => void checkSlug()}
              >
                {checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Vérifier dispo"
                )}
              </Button>
              <Button
                size="sm"
                disabled={busy || !avail?.available}
                onClick={() => void reserve()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Réserver & activer"
                )}
              </Button>
            </div>
            {avail ? (
              <p
                className={
                  avail.available
                    ? "text-sm text-emerald-700"
                    : "text-sm text-amber-800"
                }
              >
                {avail.available
                  ? `Disponible : ${slug}`
                  : avail.reason || "Indisponible"}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ── Clés IA (owner) via /api/v1/platform/llm-keys ───────────────────────── */

type LlmKeysResponse = {
  ok: boolean;
  openai: { stored: boolean; active: boolean };
  anthropic: { stored: boolean; active: boolean };
  assistantReady: boolean;
};

/** Clés IA en web : GET/PUT /api/v1/platform/llm-keys (owner uniquement). */
export function ServerLlmKeysCard() {
  const [state, setState] = useState<LlmKeysResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({
    openai: "",
    anthropic: "",
  });
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/platform/llm-keys", {
        cache: "no-store",
      });
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      if (res.ok) setState((await res.json()) as LlmKeysResponse);
    } catch {
      /* réseau : la carte reste en chargement */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (forbidden) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Clés IA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Réservé au compte propriétaire.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function save(provider: "openai" | "anthropic") {
    const key = drafts[provider].trim();
    setSaving(provider);
    try {
      const res = await fetch("/api/v1/platform/llm-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: key || null }),
      });
      const body = (await res.json()) as LlmKeysResponse & { error?: string };
      if (!res.ok) {
        toast.error(body.error || "Échec de l'enregistrement");
        return;
      }
      setState(body);
      setDrafts((d) => ({ ...d, [provider]: "" }));
      toast.success(
        key ? `Clé ${provider} enregistrée et active` : `Clé ${provider} supprimée`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSaving(null);
    }
  }

  const rows: Array<{
    provider: "openai" | "anthropic";
    name: string;
    placeholder: string;
    required: boolean;
  }> = [
    { provider: "openai", name: "OpenAI", placeholder: "sk-…", required: true },
    {
      provider: "anthropic",
      name: "Anthropic (optionnel)",
      placeholder: "sk-ant-…",
      required: false,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Clés IA (Bring Your Own Key)
        </CardTitle>
        <CardDescription>
          Clés stockées chiffrées sur le serveur, jamais envoyées ailleurs que
          chez le fournisseur du modèle. L&apos;assistant les utilise
          immédiatement ; Hermes et les embeds au prochain redémarrage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <p
            className={
              state.assistantReady
                ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            }
          >
            {state.assistantReady
              ? "Assistant : prêt (clé OpenAI active côté serveur)"
              : "Assistant : désactivé — clé OpenAI requise"}
          </p>
        )}
        {rows.map(({ provider, name, placeholder, required }) => {
          const info = state?.[provider];
          const busy = saving === provider;
          return (
            <div key={provider} className="flex items-center gap-2">
              <span className="w-44 shrink-0 text-sm">
                {name}
                {required ? (
                  <span className="ml-1 text-xs text-amber-700">requis</span>
                ) : null}
                <span
                  className={
                    info?.active
                      ? "ml-1 text-xs text-emerald-600"
                      : "ml-1 text-xs text-muted-foreground"
                  }
                >
                  (
                  {info?.active
                    ? "active"
                    : info?.stored
                      ? "enregistrée"
                      : "non configuré"}
                  )
                </span>
              </span>
              <Input
                type="password"
                value={drafts[provider]}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [provider]: e.target.value }))
                }
                placeholder={info?.stored ? "•••••• (remplacer)" : placeholder}
                className="flex-1"
                disabled={busy}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || state === null}
                onClick={() => void save(provider)}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : drafts[provider].trim() ? (
                  "Enregistrer"
                ) : info?.stored ? (
                  "Supprimer"
                ) : (
                  "Enregistrer"
                )}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ── Système : version + opérations gérées par l'opérateur ───────────────── */

/** Version d'image en web — remplace l'auto-update Electron. */
export function ServerVersionCard() {
  const [version, setVersion] = useState<CoreVersion | null>(null);

  useEffect(() => {
    void getJson<CoreVersion>("/api/v1/core/version").then(setVersion);
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ServerCog className="h-4 w-4" /> Version du serveur
        </CardTitle>
        <CardDescription>
          Les mises à jour de ce serveur sont déployées par l&apos;opérateur
          (admin flotte) — rien à faire de votre côté.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          Version installée :{" "}
          <span className="font-medium">{version?.version ?? "…"}</span>
          {version?.architectureVersion ? (
            <span className="text-xs text-muted-foreground">
              {" "}
              · architecture {version.architectureVersion}
            </span>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

/** Encart « opération gérée par l'opérateur serveur » (web). */
export function ServerOperatorNotice({ label }: { label: string }) {
  const productName = getShellUiBrand().productName;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      <ServerCog className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
      <div>
        <p className="font-medium text-slate-700">
          Géré par l&apos;opérateur {productName}
        </p>
        <p className="mt-1">
          Sur un serveur hébergé, {label} relève de l&apos;opérateur de
          l&apos;instance (admin flotte), pas de cette interface.
        </p>
      </div>
    </div>
  );
}
