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
  Workflow,
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
} from "@creezio/shell-ui/ui/kit";

type ProviderInfo = {
  id: string;
  label: string;
  secretPlaceholder: string;
  n8nCredentialType: string;
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
  n8nCredentialId: string | null;
  n8nSyncedAt: string | null;
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
      error: (data as { error?: string } | null)?.error || res.statusText,
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
  const [n8nAvailable, setN8nAvailable] = useState(false);
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
  const [saving, setSaving] = useState(false);

  const providerById = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  const refresh = useCallback(async () => {
    const [list, catalog] = await Promise.all([
      jsonFetch<{ integrations: Integration[]; n8nAvailable: boolean }>(API),
      jsonFetch<{ providers: ProviderInfo[] }>(`${API}/catalog`),
    ]);
    if (list.ok && list.data) {
      setItems(list.data.integrations || []);
      setN8nAvailable(Boolean(list.data.n8nAvailable));
    }
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
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    const meta =
      formProvider === "custom" && formHeaderName.trim()
        ? { headerName: formHeaderName.trim() }
        : {};
    const r = editing
      ? await jsonFetch<{ integration: Integration }>(
          `${API}/${editing.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              label: formLabel,
              ...(formSecret.trim() ? { secret: formSecret } : {}),
              ...(formProvider === "custom" ? { meta } : {}),
            }),
          },
        )
      : await jsonFetch<{ integration: Integration }>(API, {
          method: "POST",
          body: JSON.stringify({
            provider: formProvider,
            label: formLabel,
            secret: formSecret,
            ...(formSlug.trim() ? { slug: formSlug.trim() } : {}),
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
    const r = await jsonFetch(`${API}/${item.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Intégration supprimée");
    void refresh();
  }

  async function syncN8n(item: Integration) {
    setBusyId(item.id);
    const r = await jsonFetch(`${API}/${item.id}/sync-n8n`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setBusyId(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Credential n8n synchronisée");
    void refresh();
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
            Clés d'outils externes (OpenAI, Notion…) utilisables par
            l'assistant, les plugins et les workflows n8n — toujours par
            référence, jamais en clair.
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement…
        </div>
      ) : items.length === 0 ? (
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
                        <Badge variant="destructive">
                          clé illisible — re-saisir
                        </Badge>
                      ) : null}
                      {item.n8nCredentialId ? (
                        <Badge
                          variant="outline"
                          className="gap-1 text-emerald-700"
                          title={`Credential n8n ${item.n8nCredentialId}`}
                        >
                          <Workflow className="h-3 w-3" />
                          n8n
                        </Badge>
                      ) : n8nAvailable ? (
                        <Badge variant="outline" className="text-amber-600">
                          n8n non synchronisée
                        </Badge>
                      ) : null}
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
                    {n8nAvailable && !item.n8nCredentialId ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void syncN8n(item)}
                        title="Pousser vers n8n"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        n8n
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => openEdit(item)}
                      title="Renommer / remplacer la clé"
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                : "La clé est chiffrée au repos et poussée vers n8n si disponible."}
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
            <div className="space-y-1.5">
              <Label>Libellé</Label>
              <Input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="ex. OpenAI production"
              />
            </div>
            {!editing ? (
              <div className="space-y-1.5">
                <Label>
                  Référence{" "}
                  <span className="font-normal text-muted-foreground">
                    (integration://…)
                  </span>
                </Label>
                <Input
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  placeholder={
                    formProvider === "custom" ? "mon-service" : formProvider
                  }
                />
              </div>
            ) : null}
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
            {formProvider === "custom" ? (
              <div className="space-y-1.5">
                <Label>Header HTTP (pour n8n)</Label>
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
                !formLabel.trim() ||
                (!editing && !formSecret.trim())
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
