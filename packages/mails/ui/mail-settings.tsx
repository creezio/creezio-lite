"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import type { MailSendStatus } from "./mail-types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@creezio/shell-ui/ui/kit";
import { cn } from "@creezio/shell-ui";

type EffectiveTransport = {
  kind: string | null;
  source: string;
  preset: string | null;
  from: string | null;
  configured: boolean;
  credentialsPresent?: boolean;
  error: string | null;
  send?: MailSendStatus | null;
};

type ImapAccount = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  secretRef: string;
  syncState: string;
  lastSyncAt: string | null;
  lastError: string | null;
  enabled: boolean;
};

const TRANSPORT_CHOICES: Array<{ id: string; label: string; hint: string }> = [
  {
    id: "",
    label: "Automatique (env)",
    hint: "MAIL_TRANSPORT / SMTP_* / RESEND_API_KEY du serveur",
  },
  {
    id: "cloudflare",
    label: "Cloudflare Email Service",
    hint: "SMTP smtp.mx.cloudflare.net — fournir l'API token",
  },
  { id: "smtp", label: "SMTP direct", hint: "Votre serveur SMTP" },
  { id: "resend", label: "Resend", hint: "API Resend (clé re_…)" },
  {
    id: "file-sink",
    label: "File-sink (dev)",
    hint: "Écrit des JSON locaux, aucun envoi réel",
  },
];

const SOURCE_LABELS: Record<string, string> = {
  settings: "réglage instance",
  env: "variables d'environnement",
  inferred: "inféré (SMTP_* / RESEND_API_KEY)",
  none: "non configuré",
};

export type MailSettingsProps = {
  apiBase?: string;
};

/** Page paramètres email (owner) : transport, test d'envoi, comptes IMAP. */
export function MailSettings(props: MailSettingsProps = {}) {
  const apiBase = (props.apiBase || "/api/v1/email").replace(/\/$/, "");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [effective, setEffective] = useState<EffectiveTransport | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    ok: boolean;
    tone?: "ok" | "warn" | "error";
    message: string;
  } | null>(null);
  const [sendStatus, setSendStatus] = useState<MailSendStatus | null>(null);
  const [testTo, setTestTo] = useState("");

  const [accounts, setAccounts] = useState<ImapAccount[]>([]);
  const [accountForm, setAccountForm] = useState<{
    label: string;
    host: string;
    port: string;
    username: string;
    secret: string;
  } | null>(null);
  const [accountBusy, setAccountBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/settings`);
      if (r.status === 403) {
        setForbidden(true);
        return;
      }
      if (!r.ok) return;
      const j = await r.json();
      setSettings(j.settings || {});
      setEffective(j.effective || null);
      setSendStatus(j.send || j.effective?.send || null);
      const a = await fetch(`${apiBase}/accounts`);
      if (a.ok) setAccounts((await a.json()).rows || []);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  function setField(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch(`${apiBase}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "sauvegarde échouée");
      setSettings(j.settings || {});
      setEffective(j.effective || null);
      setSendStatus(j.send || j.effective?.send || null);
      setNotice({ ok: true, message: "Réglages enregistrés." });
    } catch (e) {
      setNotice({
        ok: false,
        message: e instanceof Error ? e.message : "sauvegarde échouée",
      });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch(`${apiBase}/settings/verify`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (j.send) setSendStatus(j.send);
      const send = j.send as MailSendStatus | undefined;
      if (send?.code === "nodemailer_absent" || (!j.ok && !j.credentialsPresent)) {
        setNotice({
          ok: false,
          tone: "error",
          message: send?.message || `Vérification échouée : ${j.error}`,
        });
      } else if (send?.state === "unavailable") {
        setNotice({
          ok: true,
          tone: "warn",
          message:
            send.message ||
            "Réglages OK — l'envoi réel ne fonctionne pas (domaine non onboardé / 550).",
        });
      } else if (j.ok && send?.state === "ok") {
        setNotice({
          ok: true,
          tone: "ok",
          message: `Transport ${j.kind || "mail"} opérationnel — envoi réel OK.`,
        });
      } else if (j.ok) {
        setNotice({
          ok: true,
          tone: "ok",
          message: `Réglages enregistrés (${j.kind || "mail"}).`,
        });
      } else {
        setNotice({
          ok: false,
          tone: "error",
          message: `Vérification échouée : ${j.error}`,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      setNotice({ ok: false, message: "Adresse de test requise." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch(`${apiBase}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [testTo.trim()],
          subject: "Test d'envoi — paramètres email",
          text: "Ce message confirme que le transport mail de votre instance fonctionne.",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "envoi échoué");
      setNotice({
        ok: true,
        message:
          "Mail de test mis en file d'attente — suivez son statut dans /mails (File d'attente puis Envoyés).",
      });
    } catch (e) {
      setNotice({
        ok: false,
        message: e instanceof Error ? e.message : "envoi échoué",
      });
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    if (!accountForm) return;
    setAccountBusy("create");
    try {
      const r = await fetch(`${apiBase}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: accountForm.label,
          host: accountForm.host,
          port: Number(accountForm.port) || 993,
          username: accountForm.username,
          secret: accountForm.secret,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice({ ok: false, message: j.error || "création échouée" });
        return;
      }
      setAccountForm(null);
      await load();
    } finally {
      setAccountBusy(null);
    }
  }

  async function accountAction(
    id: string,
    action: "verify" | "sync" | "delete",
  ) {
    setAccountBusy(id);
    try {
      if (action === "delete") {
        await fetch(`${apiBase}/accounts/${id}`, { method: "DELETE" });
      } else {
        const r = await fetch(`${apiBase}/accounts/${id}/${action}`, {
          method: "POST",
        });
        const j = await r.json().catch(() => ({}));
        setNotice(
          j.ok
            ? {
                ok: true,
                message:
                  action === "verify"
                    ? "Connexion IMAP OK."
                    : `Synchronisation : ${j.inserted ?? 0} nouveau(x) mail(s).`,
              }
            : { ok: false, message: j.error || `${action} échoué` },
        );
      }
      await load();
    } finally {
      setAccountBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-[#5c6478]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement…
      </div>
    );
  }
  if (forbidden) {
    return (
      <div className="p-8 text-center text-sm text-[#5c6478]">
        Les paramètres email sont réservés au propriétaire de l'instance.
      </div>
    );
  }

  const transport = settings.transport || "";
  const preset =
    transport === "cloudflare" ? "cloudflare" : settings.preset || "";
  const banner = sendStatus || effective?.send || null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-1">
      {banner && banner.state === "unconfigured" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Email Sending non configuré</p>
        </div>
      )}
      {banner && banner.state === "unavailable" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {banner.message ||
              "Token présent, envoi réel indisponible (domaine non onboardé / 550)."}
          </p>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transport d'envoi</CardTitle>
          {effective && (
            <p className="text-xs text-[#5c6478]">
              Actif :{" "}
              <span className="font-medium">
                {effective.configured
                  ? `${effective.kind}${effective.preset ? ` (${effective.preset})` : ""}`
                  : "aucun"}
              </span>{" "}
              — source : {SOURCE_LABELS[effective.source] || effective.source}
              {effective.error && (
                <span className="text-red-700"> · {effective.error}</span>
              )}
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TRANSPORT_CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setField("transport", c.id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  transport === c.id
                    ? "border-[#14182f] bg-[#14182f]/5"
                    : "border-[#e6e0d4] hover:border-[#c9c2b4]",
                )}
              >
                <p className="text-sm font-medium text-[#14182f]">{c.label}</p>
                <p className="text-xs text-[#9aa1b2]">{c.hint}</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Expéditeur (From)</Label>
              <Input
                value={settings.from || ""}
                onChange={(e) => setField("from", e.target.value)}
                placeholder="noreply@votre-domaine.fr"
                className="h-9"
              />
            </div>
            {(transport === "resend" ||
              transport === "smtp" ||
              transport === "cloudflare") && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">
                  Secret (référence integration://…)
                </Label>
                <Input
                  value={settings.secret_ref || ""}
                  onChange={(e) => setField("secret_ref", e.target.value)}
                  placeholder="integration://resend"
                  className="h-9"
                />
                <p className="text-[11px] text-[#9aa1b2]">
                  Créez la clé dans Admin → Intégrations puis référencez-la ici.
                </p>
              </div>
            )}
            {transport === "smtp" && !preset && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Hôte SMTP</Label>
                  <Input
                    value={settings.smtp_host || ""}
                    onChange={(e) => setField("smtp_host", e.target.value)}
                    placeholder="smtp.exemple.fr"
                    className="h-9"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Port</Label>
                  <Input
                    value={settings.smtp_port || ""}
                    onChange={(e) => setField("smtp_port", e.target.value)}
                    placeholder="587"
                    className="h-9"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Utilisateur</Label>
                  <Input
                    value={settings.smtp_user || ""}
                    onChange={(e) => setField("smtp_user", e.target.value)}
                    className="h-9"
                  />
                </div>
              </>
            )}
            {transport === "file-sink" && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Dossier de sortie</Label>
                <Input
                  value={settings.file_sink_dir || ""}
                  onChange={(e) => setField("file_sink_dir", e.target.value)}
                  placeholder="/tmp/mails"
                  className="h-9"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" disabled={busy} onClick={() => void save()}>
              Enregistrer
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void verify()}
            >
              Vérifier la connexion
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="test@exemple.fr"
                className="h-9 w-48"
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void sendTest()}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                Tester l'envoi
              </Button>
            </div>
          </div>

          {notice && (
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs",
                (notice.tone || (notice.ok ? "ok" : "error")) === "ok"
                  ? "text-emerald-700"
                  : (notice.tone || "error") === "warn"
                    ? "text-amber-800"
                    : "text-red-700",
              )}
            >
              {(notice.tone || (notice.ok ? "ok" : "error")) === "ok" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (notice.tone || "error") === "warn" ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {notice.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Comptes IMAP (réception)</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setAccountForm(
                accountForm
                  ? null
                  : { label: "", host: "", port: "993", username: "", secret: "" },
              )
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {accountForm && (
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-[#e6e0d4] p-3 sm:grid-cols-2">
              <Input
                value={accountForm.label}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, label: e.target.value })
                }
                placeholder="Libellé (ex. Boîte pro)"
                className="h-9"
              />
              <Input
                value={accountForm.host}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, host: e.target.value })
                }
                placeholder="imap.exemple.fr"
                className="h-9"
              />
              <Input
                value={accountForm.port}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, port: e.target.value })
                }
                placeholder="993"
                className="h-9"
              />
              <Input
                value={accountForm.username}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, username: e.target.value })
                }
                placeholder="compte@exemple.fr"
                className="h-9"
              />
              <Input
                type="password"
                value={accountForm.secret}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, secret: e.target.value })
                }
                placeholder="Mot de passe (stocké chiffré)"
                className="h-9"
              />
              <Button
                type="button"
                disabled={accountBusy === "create"}
                onClick={() => void createAccount()}
              >
                {accountBusy === "create" && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                )}
                Créer le compte
              </Button>
            </div>
          )}

          {accounts.length === 0 ? (
            <p className="text-xs text-[#9aa1b2]">
              Aucun compte IMAP — la réception passe par le domaine d'instance
              (Cloudflare Email Routing) si configuré.
            </p>
          ) : (
            <ul className="divide-y divide-[#f0ebe1]">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#14182f]">
                      {a.label}{" "}
                      <span className="font-normal text-[#9aa1b2]">
                        — {a.username} @ {a.host}:{a.port}
                      </span>
                    </p>
                    <p className="text-xs text-[#9aa1b2]">
                      État : {a.syncState}
                      {a.lastSyncAt &&
                        ` · dernière sync ${new Date(a.lastSyncAt).toLocaleString("fr-FR")}`}
                      {a.lastError && (
                        <span className="text-red-700"> · {a.lastError}</span>
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={accountBusy === a.id}
                    onClick={() => void accountAction(a.id, "verify")}
                  >
                    Tester
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={accountBusy === a.id}
                    onClick={() => void accountAction(a.id, "sync")}
                    title="Synchroniser"
                  >
                    <RefreshCw
                      className={cn(
                        "h-4 w-4",
                        accountBusy === a.id && "animate-spin",
                      )}
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-600 hover:text-red-700"
                    disabled={accountBusy === a.id}
                    onClick={() => void accountAction(a.id, "delete")}
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
