"use client";

/**
 * Panneau configuration / webhook / livraisons Granola.
 * Possédé par GRANOLA-2 — santé, endpoints distants, empty/error.
 * Ne pas réécrire `granola-notes-panel.tsx` depuis ici.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/granola";
const MODULE_UNREGISTERED =
  "Le module Granola n'est pas enregistré sur ce serveur";
const ALL_EVENT_TYPES = "__all__";
const EVENT_TYPES = [
  "note.generated",
  "note.edited",
  "note.access_granted",
] as const;

type GranolaConfigView = {
  apiKey: string | null;
  signingSecret: string | null;
  publicBaseUrl: string | null;
  apiBaseUrl: string | null;
  webhookEndpointId: string | null;
};

type WebhookInfo = {
  url: string | null;
  apiKeyConfigured: boolean;
  signingSecretConfigured: boolean;
  webhookEndpointId: string | null;
};

type EventRow = {
  event_id: string;
  event_type: string;
  note_id: string | null;
  occurred_at: string | null;
  received_at: string;
  verified: number;
  deliveries: number;
};

type RemoteEndpoint = {
  id: string;
  url?: string;
  scopes?: string[];
  events?: string[];
  enabled?: boolean;
};

type ApiJson = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

type ConfirmAction = {
  kind: "disable" | "delete";
  endpoint: RemoteEndpoint;
};

export type GranolaConnectPanelProps = {
  /** Clic sur une livraison avec `note_id` — le parent ouvre / scrolle, sans éditer la fiche. */
  onSelectNote?: (noteId: string) => void;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function currentOrigin(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.location.origin || "";
  } catch {
    return "";
  }
}

function isHttpsUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith("https://"));
}

function joinList(values: unknown): string {
  if (!Array.isArray(values) || values.length === 0) return "—";
  return values.filter((v) => typeof v === "string").join(", ") || "—";
}

function parseRemoteEndpoints(data: unknown): RemoteEndpoint[] {
  const rec = asRecord(data);
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(rec?.webhook_endpoints)
      ? (rec?.webhook_endpoints as unknown[])
      : Array.isArray(rec?.items)
        ? (rec?.items as unknown[])
        : [];
  return raw.filter((item): item is RemoteEndpoint => {
    const row = asRecord(item);
    return Boolean(row && typeof row.id === "string");
  });
}

async function parseApiResponse(r: Response): Promise<{
  status: number;
  json: ApiJson | null;
  unregistered: boolean;
}> {
  const contentType = r.headers.get("content-type") || "";
  let json: ApiJson | null = null;
  try {
    if (contentType.includes("json") || contentType === "") {
      json = (await r.json()) as ApiJson;
    }
  } catch {
    json = null;
  }
  const unregistered =
    json?.error === "db_unavailable" ||
    (!json && (r.status === 404 || r.status === 503)) ||
    (r.status === 404 && !contentType.includes("json"));
  return { status: r.status, json, unregistered };
}

function reportApiError(
  json: ApiJson | null,
  fallback: string,
  unregistered: boolean,
): string {
  if (unregistered) return MODULE_UNREGISTERED;
  if (typeof json?.error === "string" && json.error) return json.error;
  return fallback;
}

export function GranolaConnectPanel({ onSelectNote }: GranolaConnectPanelProps = {}) {
  const [config, setConfig] = useState<GranolaConfigView | null>(null);
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [endpoints, setEndpoints] = useState<RemoteEndpoint[]>([]);
  const [endpointsLoaded, setEndpointsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [eventType, setEventType] = useState<string>(ALL_EVENT_TYPES);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [originPlaceholder, setOriginPlaceholder] = useState("");

  const [apiKey, setApiKey] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");

  useEffect(() => {
    setOriginPlaceholder(currentOrigin());
  }, []);

  const refreshEndpoints = useCallback(async () => {
    try {
      const r = await fetch(`${API}/remote/webhook-endpoints`, {
        cache: "no-store",
      });
      const parsed = await parseApiResponse(r);
      if (parsed.unregistered) {
        setEndpoints([]);
        setEndpointsLoaded(true);
        return { unregistered: true as const };
      }
      if (parsed.status === 409 || parsed.json?.error === "granola_api_key_missing") {
        setEndpoints([]);
        setEndpointsLoaded(true);
        return { missingKey: true as const };
      }
      if (!parsed.json?.ok) {
        setEndpoints([]);
        setEndpointsLoaded(true);
        return {
          error: reportApiError(
            parsed.json,
            "Impossible de lister les endpoints",
            false,
          ),
        };
      }
      setEndpoints(parseRemoteEndpoints(parsed.json.data));
      setEndpointsLoaded(true);
      return { ok: true as const };
    } catch {
      setEndpoints([]);
      setEndpointsLoaded(true);
      return { unregistered: true as const };
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [cRes, iRes, eRes] = await Promise.all([
        fetch(`${API}/config`, { cache: "no-store" }),
        fetch(`${API}/webhook-info`, { cache: "no-store" }),
        fetch(`${API}/events?limit=50`, { cache: "no-store" }),
      ]);
      const [c, i, e] = await Promise.all([
        parseApiResponse(cRes),
        parseApiResponse(iRes),
        parseApiResponse(eRes),
      ]);
      if (c.unregistered || i.unregistered || e.unregistered) {
        setError(MODULE_UNREGISTERED);
        toast.error(MODULE_UNREGISTERED);
        return;
      }
      if (c.json?.ok) {
        setConfig(c.json.config as GranolaConfigView);
      } else if (c.json?.error) {
        const msg = reportApiError(c.json, "Config injoignable", false);
        setError(msg);
        toast.error(msg);
        return;
      }
      if (i.json?.ok) {
        setInfo(i.json as unknown as WebhookInfo);
      }
      if (e.json?.ok) {
        setEvents(
          Array.isArray(e.json.items) ? (e.json.items as EventRow[]) : [],
        );
      }
      setError(null);
      const endpointsResult = await refreshEndpoints();
      if (endpointsResult && "error" in endpointsResult && endpointsResult.error) {
        toast.error(endpointsResult.error);
      }
    } catch {
      setError(MODULE_UNREGISTERED);
      toast.error(MODULE_UNREGISTERED);
    }
  }, [refreshEndpoints]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const unverifiedWithSecret = useMemo(
    () =>
      Boolean(info?.signingSecretConfigured) &&
      events.some((row) => row.verified === 0),
    [info, events],
  );

  const filteredEvents = useMemo(() => {
    if (eventType === ALL_EVENT_TYPES) return events;
    return events.filter((row) => row.event_type === eventType);
  }, [events, eventType]);

  const saveConfig = useCallback(async () => {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (signingSecret.trim()) body.signingSecret = signingSecret.trim();
      if (publicBaseUrl.trim()) body.publicBaseUrl = publicBaseUrl.trim();
      const r = await fetch(`${API}/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await parseApiResponse(r);
      if (parsed.unregistered) {
        setError(MODULE_UNREGISTERED);
        toast.error(MODULE_UNREGISTERED);
        return;
      }
      if (parsed.json?.ok) {
        setApiKey("");
        setSigningSecret("");
        setPublicBaseUrl("");
        toast.success("Configuration enregistrée.");
        setError(null);
        await refresh();
        return;
      }
      const msg = reportApiError(
        parsed.json,
        "Échec de l'enregistrement",
        false,
      );
      setError(msg);
      toast.error(msg);
    } catch {
      setError(MODULE_UNREGISTERED);
      toast.error(MODULE_UNREGISTERED);
    } finally {
      setBusy(false);
    }
  }, [apiKey, signingSecret, publicBaseUrl, refresh]);

  const registerWebhook = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/register-webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scopes: ["personal", "public"] }),
      });
      const parsed = await parseApiResponse(r);
      if (parsed.unregistered) {
        setError(MODULE_UNREGISTERED);
        toast.error(MODULE_UNREGISTERED);
        return;
      }
      if (parsed.json?.ok) {
        toast.success(
          parsed.json.secretStored
            ? "Webhook enregistré — signing secret stocké côté serveur."
            : "Webhook enregistré côté Granola.",
        );
        setError(null);
      } else {
        const msg = reportApiError(
          parsed.json,
          `Échec : ${parsed.status}`,
          false,
        );
        setError(msg);
        toast.error(msg);
      }
      await refresh();
    } catch {
      setError(MODULE_UNREGISTERED);
      toast.error(MODULE_UNREGISTERED);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const runEndpointAction = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const id = encodeURIComponent(confirm.endpoint.id);
      const r =
        confirm.kind === "disable"
          ? await fetch(`${API}/remote/webhook-endpoints/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled: false }),
            })
          : await fetch(`${API}/remote/webhook-endpoints/${id}`, {
              method: "DELETE",
            });
      const parsed = await parseApiResponse(r);
      if (parsed.unregistered) {
        setError(MODULE_UNREGISTERED);
        toast.error(MODULE_UNREGISTERED);
        return;
      }
      if (parsed.json?.ok || (r.ok && !parsed.json)) {
        toast.success(
          confirm.kind === "disable"
            ? "Endpoint désactivé."
            : "Endpoint supprimé.",
        );
        setError(null);
        setConfirm(null);
        await refresh();
        return;
      }
      const msg = reportApiError(parsed.json, `Échec : ${parsed.status}`, false);
      setError(msg);
      toast.error(msg);
    } catch {
      setError(MODULE_UNREGISTERED);
      toast.error(MODULE_UNREGISTERED);
    } finally {
      setBusy(false);
    }
  }, [confirm, refresh]);

  const copyUrl = useCallback(async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      toast.success("URL webhook copiée.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Presse-papiers indisponible.");
    }
  }, [info]);

  const fillPublicBaseUrl = useCallback(() => {
    if (!originPlaceholder) return;
    setPublicBaseUrl(originPlaceholder);
  }, [originPlaceholder]);

  const httpsOk = isHttpsUrl(info?.url);

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Card className="border-destructive p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {unverifiedWithSecret ? (
        <Card className="border-destructive bg-destructive/5 p-4 text-sm text-destructive">
          Signature invalide — livraisons rejetées / à auditer. Un secret est
          configuré mais au moins une livraison a `verified=0`.
        </Card>
      ) : null}

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Santé du connecteur</CardTitle>
          <CardDescription>
            Badges de configuration — les secrets ne sont jamais affichés en
            clair.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-2">
          {info?.url ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted p-2 text-xs">
                {info.url}
              </code>
              <Button size="sm" variant="outline" onClick={copyUrl}>
                {copied ? "Copié !" : "Copier"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Renseignez l&apos;origine publique HTTPS (`publicBaseUrl`) pour
              composer l&apos;URL webhook.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={info?.apiKeyConfigured ? "default" : "outline"}>
              Clé API {info?.apiKeyConfigured ? "configurée" : "manquante"}
            </Badge>
            <Badge
              variant={info?.signingSecretConfigured ? "default" : "outline"}
            >
              Secret{" "}
              {info?.signingSecretConfigured ? "configuré" : "non configuré"}
            </Badge>
            <Badge variant={httpsOk ? "default" : "outline"}>
              {httpsOk
                ? "URL HTTPS"
                : info?.url
                  ? "URL non HTTPS"
                  : "URL absente"}
            </Badge>
            {info?.webhookEndpointId ? (
              <Badge variant="secondary">
                Endpoint {info.webhookEndpointId}
              </Badge>
            ) : (
              <Badge variant="outline">Endpoint id absent</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>
            Saisissez uniquement les valeurs à remplacer. Le masque actuel
            (`…`) n&apos;est pas le secret.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-2">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="granola-api-key">
                Clé API Granola
                {config?.apiKey ? ` (actuelle : ${config.apiKey})` : ""}
              </Label>
              <Input
                id="granola-api-key"
                type="password"
                autoComplete="off"
                placeholder="grn_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="granola-signing-secret">
                Signing secret
                {config?.signingSecret
                  ? ` (actuel : ${config.signingSecret})`
                  : ""}
              </Label>
              <Input
                id="granola-signing-secret"
                type="password"
                autoComplete="off"
                placeholder="whsec_…"
                value={signingSecret}
                onChange={(e) => setSigningSecret(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="granola-public-base-url">
                Origine publique (HTTPS)
              </Label>
              <Input
                id="granola-public-base-url"
                placeholder={
                  config?.publicBaseUrl ||
                  originPlaceholder ||
                  "https://crm.exemple.fr"
                }
                value={publicBaseUrl}
                onChange={(e) => setPublicBaseUrl(e.target.value)}
              />
              {originPlaceholder && !config?.publicBaseUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-auto justify-start px-0 text-xs"
                  onClick={fillPublicBaseUrl}
                >
                  Utiliser l&apos;origine actuelle ({originPlaceholder})
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void saveConfig()}
              disabled={
                busy ||
                (!apiKey.trim() &&
                  !signingSecret.trim() &&
                  !publicBaseUrl.trim())
              }
            >
              Enregistrer
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void registerWebhook()}
              disabled={busy || !info?.apiKeyConfigured || !httpsOk}
            >
              Enregistrer le webhook via l&apos;API Granola
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Endpoints distants</CardTitle>
          <CardDescription>
            Liste `GET remote/webhook-endpoints`. Désactiver = PATCH{" "}
            `enabled: false`. Le `signing_secret` reste côté serveur
            (`secretStored`).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {!endpointsLoaded ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : !info?.apiKeyConfigured ? (
            <p className="text-sm text-muted-foreground">
              Configurez une clé API pour lister les endpoints Granola.
            </p>
          ) : endpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun endpoint distant. Enregistrez le webhook via l&apos;API
              Granola (HTTPS requis).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">
                  Endpoints webhook Granola
                </caption>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Id
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      URL
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Scopes
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Events
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((ep) => (
                    <tr key={ep.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 align-top">
                        <code className="text-xs">{ep.id}</code>
                        {ep.enabled === false ? (
                          <Badge variant="outline" className="ml-2">
                            off
                          </Badge>
                        ) : null}
                      </td>
                      <td className="max-w-[14rem] truncate py-2 pr-3 align-top text-xs">
                        {ep.url || "—"}
                      </td>
                      <td className="py-2 pr-3 align-top text-xs">
                        {joinList(ep.scopes)}
                      </td>
                      <td className="py-2 pr-3 align-top text-xs">
                        {joinList(ep.events)}
                      </td>
                      <td className="py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || ep.enabled === false}
                            onClick={() =>
                              setConfirm({ kind: "disable", endpoint: ep })
                            }
                          >
                            Désactiver
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({ kind: "delete", endpoint: ep })
                            }
                          >
                            Supprimer
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Livraisons webhook ({filteredEvents.length}
            {eventType !== ALL_EVENT_TYPES ? ` / ${events.length}` : ""})
          </h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="granola-event-type">Type d&apos;événement</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger id="granola-event-type" className="sm:w-64">
                <SelectValue placeholder="Tous les types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EVENT_TYPES}>Tous les types</SelectItem>
                {EVENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {filteredEvents.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            {events.length === 0
              ? "Aucune livraison reçue. Enregistrez le webhook puis générez une note dans Granola."
              : "Aucune livraison pour ce type. Changez le filtre."}
          </Card>
        ) : null}
        {filteredEvents.map((row) => {
          const clickable = Boolean(row.note_id && onSelectNote);
          return (
            <Card
              key={row.event_id}
              className={clickable ? "cursor-pointer p-3 hover:bg-accent" : "p-3"}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => {
                if (row.note_id && onSelectNote) onSelectNote(row.note_id);
              }}
              onKeyDown={(e) => {
                if (!clickable) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (row.note_id) onSelectNote?.(row.note_id);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{row.event_type}</span>
                <div className="flex items-center gap-1">
                  <Badge variant={row.verified ? "default" : "outline"}>
                    {row.verified ? "signée" : "non vérifiée"}
                  </Badge>
                  {row.deliveries > 1 ? (
                    <Badge variant="secondary">×{row.deliveries}</Badge>
                  ) : null}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {row.note_id || "—"} · {fmtDate(row.received_at)}
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent role="alertdialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "disable"
                ? "Désactiver cet endpoint ?"
                : "Supprimer cet endpoint ?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "disable"
                ? `Granola cessera d'envoyer des livraisons vers ${confirm.endpoint.id}.`
                : `Suppression définitive de ${confirm?.endpoint.id ?? "cet endpoint"}. Cette action est irréversible.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={busy}
            >
              Annuler
            </Button>
            <Button
              variant={confirm?.kind === "delete" ? "destructive" : "default"}
              onClick={() => void runEndpointAction()}
              disabled={busy}
            >
              {confirm?.kind === "disable" ? "Désactiver" : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
