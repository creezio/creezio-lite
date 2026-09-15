"use client";

/**
 * Page Intégrations — gestion des clés d'outils externes (OpenAI, Notion…).
 * Design system kit (shell-ui). Les autres modules consomment les
 * intégrations PAR RÉFÉRENCE (`integration://<slug>`), jamais par valeur.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Power,
  Cable,
} from "lucide-react";
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
} from "@lite/shell-ui/ui/kit";

type ProviderInfo = {
  id: string;
  label: string;
  secretPlaceholder: string;

};

type Integration = {
  id: string;
  slug: string;
  reference: string;
  provider: string;
  label: string;
  secretHint: string;
  readable: boolean;
  meta: Record<string, unknown>;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

const API = "/api/v1/platform/integrations";

async function jsonFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null; error: string }> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    });
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: typeof (data as any)?.error === "string" ? (data as any).error : (data as any)?.error?.message || res.statusText,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function CopyReferenceButton({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      title="Copier la référence"
      onClick={() => {
        void navigator.clipboard?.writeText(reference).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

export function IntegrationsClient() {
  const [items, setItems] = useState<Integration[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Dialog création / édition
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [formProvider, setFormProvider] = useState("openai");
  const [formLabel, setFormLabel] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formSecret, setFormSecret] = useState("");
  const [formHeaderName, setFormHeaderName] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const providerById = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  const refresh = useCallback(async () => {
    const [list, catalog] = await Promise.all([
      jsonFetch<{ integrations: Integration[] }>(API),
      jsonFetch<{ providers: ProviderInfo[] }>(`${API}/catalog`),
    ]);
    if (list.ok && list.data) {
      setItems(list.data.integrations || []);
      setLoadError("");
    }
    if (!list.ok) setLoadError(list.error);
    if (!catalog.ok) setLoadError(catalog.error);
    if (catalog.ok && catalog.data) setProviders(catalog.data.providers || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setEditing(null);
    setFormProvider("openai");
    setFormLabel("");
    setFormSlug("");
    setFormSecret("");
    setFormHeaderName("");
    setFormBaseUrl("");
    setDialogOpen(true);
  }

  function openEdit(item: Integration) {
    setEditing(item);
    setFormProvider(item.provider);
    setFormLabel(item.label);
    setFormSlug(item.slug);
    setFormSecret("");
    setFormHeaderName(
      typeof item.meta.headerName === "string" ? item.meta.headerName : "",
    );
    setFormBaseUrl(String(item.meta.baseUrl || ""));
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    const meta = {
      ...(formProvider === "custom" ? {headerName: formHeaderName.trim() || "Authorization"} : {}),
      ...(formProvider === "hermes" ? {baseUrl: formBaseUrl.trim()} : {}),
    };
    const r = editing
      ? await jsonFetch<{ integration: Integration }>(
          `${API}/${editing.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...(formProvider === "custom" ? {label:formLabel,slug:formSlug} : {}),
              version: editing.version,
              ...(formSecret.trim() ? { secret: formSecret } : {}),
              meta,
            }),
          },
        )
      : await jsonFetch<{ integration: Integration }>(API, {
          method: "POST",
          body: JSON.stringify({
            provider: formProvider,
            ...(formProvider === "custom" ? {label:formLabel,slug:formSlug} : {}),
            secret: formSecret,
            ...(Object.keys(meta).length ? { meta } : {}),
          }),
        });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(
      editing ? "Intégration mise à jour" : "Intégration enregistrée",
    );
    setDialogOpen(false);
    setFormSecret("");
    window.dispatchEvent(new Event("lite-integrations-changed"));
    void refresh();
  }

  async function remove(item: Integration) {
    if (
      !window.confirm(
        `Supprimer l'intégration « ${item.label} » (${item.reference}) ?`,
      )
    ) {
      return;
    }
    setBusyId(item.id);
    const r = await jsonFetch(`${API}/${item.id}?version=${item.version}`, { method: "DELETE" });
    setBusyId(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Intégration supprimée");
    window.dispatchEvent(new Event("lite-integrations-changed"));
    void refresh();
  }

  async function testConnection(item: Integration) {
    setBusyId(item.id);
    const r = await jsonFetch<{message:string}>(`${API}/${item.id}/test`, {method:"POST",body:"{}"});
    setBusyId(null);
    if (!r.ok) {toast.error(r.error);return;}
    toast.success(r.data?.message || "Connexion vérifiée");
  }
  async function toggle(item: Integration) {
    setBusyId(item.id);
    const r=await jsonFetch(`${API}/${item.id}`,{method:"PATCH",body:JSON.stringify({enabled:!item.enabled,version:item.version})});
    setBusyId(null);
    if (!r.ok) {toast.error(r.error);return;}
    await refresh();window.dispatchEvent(new Event("lite-integrations-changed"));
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <KeyRound className="h-6 w-6" />
            Intégrations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connectez OpenAI ou votre serveur Hermes pour utiliser l’assistant.
            Les clés des autres services restent disponibles par référence.
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>

      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError} <Button variant="outline" onClick={()=>void refresh()}>Réessayer</Button></p> : null}
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement…
        </div>
      ) : loadError ? null : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aucune intégration</CardTitle>
            <CardDescription>
              Ajoutez votre première clé (ex. OpenAI) — elle sera référencée
              par <code>integration://openai</code> partout dans l'app.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const provider = providerById.get(item.provider);
            const busy = busyId === item.id;
            return (
              <Card key={item.id}>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.label}</span>
                      <Badge variant="secondary">
                        {provider?.label || item.provider}
                      </Badge>
                      {!item.readable ? (
                        <Badge variant="danger">
                          clé illisible — re-saisir
                        </Badge>
                      ) : null}
                      {!item.enabled ? <Badge variant="outline">Désactivée</Badge> : null}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5">
                        {item.reference}
                      </code>
                      <CopyReferenceButton reference={item.reference} />
                      <span>· clé {item.secretHint}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {["openai","hermes"].includes(item.provider) ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>void testConnection(item)}><Cable className="h-4 w-4"/>Tester</Button> : null}
                    <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={()=>void toggle(item)} title={item.enabled?"Désactiver":"Activer"}><Power className="h-4 w-4"/></Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => openEdit(item)}
                      title={item.provider === "custom"?"Configurer l’intégration":"Modifier la clé"}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => void remove(item)}
                      title="Supprimer"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-red-500" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={open=>{setDialogOpen(open);if(!open)setFormSecret("");}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? `Modifier « ${editing.label} »`
                : "Ajouter une intégration"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Laissez le champ clé vide pour la conserver."
                : "La clé est chiffrée et utilisée uniquement côté serveur."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!editing ? (
              <div className="space-y-1.5">
                <Label>Service</Label>
                <Select value={formProvider} onValueChange={setFormProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {formProvider === "custom" ? <>
              <div className="space-y-1.5"><Label htmlFor="integration-label">Libellé</Label><Input id="integration-label" value={formLabel} onChange={e=>setFormLabel(e.target.value)} placeholder="Mon service"/></div>
              <div className="space-y-1.5"><Label htmlFor="integration-reference">Référence (integration://…)</Label><Input id="integration-reference" value={formSlug} onChange={e=>setFormSlug(e.target.value)} placeholder="mon-service"/></div>
            </> : null}
            <div className="space-y-1.5">
              <Label>Clé / secret</Label>
              <Input
                type="password"
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
                placeholder={
                  editing
                    ? `inchangée (${editing.secretHint})`
                    : providerById.get(formProvider)?.secretPlaceholder ||
                      "valeur du secret"
                }
                autoComplete="off"
              />
            </div>
            {formProvider === "hermes" ? <div className="space-y-1.5"><Label htmlFor="integration-url">URL du serveur Hermes</Label><Input id="integration-url" type="url" value={formBaseUrl} onChange={e=>setFormBaseUrl(e.target.value)} placeholder="https://hermes.votre-domaine.fr"/><p className="text-xs text-muted-foreground">Adresse HTTPS publique de votre passerelle Hermes.</p></div> : null}
            {formProvider === "custom" ? (
              <div className="space-y-1.5">
                <Label>Header HTTP</Label>
                <Input
                  value={formHeaderName}
                  onChange={(e) => setFormHeaderName(e.target.value)}
                  placeholder="Authorization"
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              disabled={
                saving ||
                (formProvider === "custom" && (!formLabel.trim() || !formSlug.trim())) ||
                (!editing && !formSecret.trim()) || (formProvider === "hermes" && !formBaseUrl.trim())
              }
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? "Enregistrer" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
