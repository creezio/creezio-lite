"use client";

/**
 * Wizard first-run : compte local + recovery key + slug tunnel + OpenAI.
 * Electron : IPC via getShellDesktopApi() ; Docker / navigateur : HTTP
 * `/api/v1/os/setup` (createHttpSetupDesktopApi). Branding via getShellUiBrand().
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button, Input } from "@creezio/shell-ui/ui/kit";
import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";
import { getOnboardingUiConfig } from "../onboarding/configure";
import {
  createHttpSetupDesktopApi,
  probeHttpSetupAvailable,
  type SetupDesktopApiSubset,
} from "./http-setup-api";
import {
  DEFAULT_SETUP_ACCENT,
  DEFAULT_SETUP_BACKGROUND,
  DEFAULT_SETUP_STEP_LABELS,
  DEFAULT_SLUG_PLACEHOLDER,
  SLUG_RE,
  type SetupWizardConfig,
} from "./setup-types";

/** Home CRM — jamais `/onboarding` par défaut (placeholder mort interdit). */
export const DEFAULT_AFTER_SETUP_HREF = "/";

type Step = 1 | 2 | 3 | 4;

type SetupApi = SetupDesktopApiSubset;

function resolveAfterCompleteHref(config: SetupWizardConfig): string {
  const ui = getOnboardingUiConfig();
  if (ui.productOnboardingEnabled === false) {
    return config.afterCompleteHref ?? ui.afterCompleteHref ?? DEFAULT_AFTER_SETUP_HREF;
  }
  return (
    config.afterCompleteHref ??
    ui.afterCompleteHref ??
    DEFAULT_AFTER_SETUP_HREF
  );
}

export function SetupWizard(props?: { config?: SetupWizardConfig }) {
  const config = props?.config ?? {};
  const brand = getShellUiBrand();
  const productName = brand.productName;
  const hostSuffix = brand.publicHostSuffix;
  const accent = config.accentColor ?? DEFAULT_SETUP_ACCENT;
  const background = config.backgroundColor ?? DEFAULT_SETUP_BACKGROUND;
  const stepLabels = config.stepLabels ?? [...DEFAULT_SETUP_STEP_LABELS];
  const slugPlaceholder = config.slugPlaceholder ?? DEFAULT_SLUG_PLACEHOLDER;
  const requireOpenaiKey = config.requireOpenaiKey !== false;
  const afterCompleteHref = resolveAfterCompleteHref(config);
  const tunnelHelp =
    config.tunnelHelp ??
    "Choisissez l'adresse d'accès de votre CRM :";

  const apiRef = useRef<SetupApi | null>(null);
  const [ready, setReady] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryAck, setRecoveryAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugOk, setSlugOk] = useState<boolean | null>(null);
  const [slugReason, setSlugReason] = useState<string | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  function resolveApi(): SetupApi | null {
    return apiRef.current;
  }

  useEffect(() => {
    void resolveApi()?.setAssistantChrome?.("hidden");
  }, [ready]);

  useEffect(() => {
    if (step !== 2 || recoveryKey) return;
    void ensureRecoveryKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const electron = getShellDesktopApi() as SetupApi | undefined;
      let api: SetupApi | null = null;
      if (electron?.getSetupStatus) {
        api = electron;
      } else if (await probeHttpSetupAvailable()) {
        api = createHttpSetupDesktopApi();
      }
      if (cancelled) return;
      if (!api?.getSetupStatus) {
        setDesktop(false);
        setReady(true);
        return;
      }
      apiRef.current = api;
      setDesktop(true);
      void api.setAssistantChrome?.("hidden");
      try {
        const s = await api.getSetupStatus();
        if (cancelled) return;
        if (s.setupComplete) {
          window.location.href = "/login";
          return;
        }
        if (s.username) setUsername(s.username);
        if (s.tunnelSlug) setSlug(s.tunnelSlug);
        if (s.hasTunnel && !s.hasOpenai) setStep(3);
        else if (s.tunnelSlug && !s.hasTunnel) setStep(3);
      } catch {
        if (cancelled) return;
        // API HTTP indisponible après probe — fallback message desktop-only.
        apiRef.current = null;
        setDesktop(false);
      }
      setReady(true);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function ensureRecoveryKey(): Promise<string | null> {
    if (recoveryKey) return recoveryKey;
    const api = resolveApi();
    if (!api?.generateRecoveryKey) {
      setError("Génération de clé indisponible.");
      return null;
    }
    const r = await api.generateRecoveryKey();
    setRecoveryKey(r.recoveryKey);
    return r.recoveryKey;
  }

  async function checkSlug() {
    const api = resolveApi();
    if (!api?.checkTunnelSlug) return;
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      setSlugOk(false);
      setSlugReason("Slug invalide (a-z, 0-9, tirets, 2–48 car.)");
      return;
    }
    setCheckingSlug(true);
    setSlugReason(null);
    try {
      const r = await api.checkTunnelSlug(s);
      setSlugOk(r.available);
      setSlugReason(r.reason || null);
    } catch (e) {
      setSlugOk(false);
      setSlugReason(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setCheckingSlug(false);
    }
  }

  async function nextFromAccount(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (username.trim().length < 2) {
      setError("Choisissez un identifiant (min. 2 caractères).");
      return;
    }
    if (password.length < 6) {
      setError("Mot de passe trop court (min. 6 caractères).");
      return;
    }
    if (password !== password2) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    const key = await ensureRecoveryKey();
    if (!key) return;
    setRecoveryAck(false);
    setCopied(false);
    setStep(2);
  }

  function nextFromRecovery(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!recoveryKey) {
      setError("Clé de récupération manquante.");
      return;
    }
    if (!recoveryAck) {
      setError("Cochez la case pour confirmer que vous avez noté la clé.");
      return;
    }
    setStep(3);
  }

  function nextFromSlug(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      setError("Slug invalide.");
      return;
    }
    if (slugOk === false) {
      setError(slugReason || "Slug indisponible.");
      return;
    }
    setStep(4);
  }

  async function copyRecoveryKey() {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Impossible de copier — sélectionnez et copiez manuellement.");
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const api = resolveApi();
    if (!api?.completeSetup) {
      setError(`Cette étape nécessite l'application desktop ${productName}.`);
      return;
    }
    if (requireOpenaiKey && !openaiKey.trim()) {
      setError("Collez votre clé OpenAI (sk-…).");
      return;
    }
    if (!recoveryKey || !recoveryAck) {
      setError("Revenez à l'étape clé de récupération et confirmez l'avoir notée.");
      setStep(2);
      return;
    }
    setBusy(true);
    setStatusLine("Enregistrement du compte, réservation du tunnel, activation…");
    try {
      const payload = {
        username: username.trim(),
        password,
        openaiKey: openaiKey.trim(),
        slug: slug.trim().toLowerCase(),
        recoveryKey,
        stayLoggedIn,
      };
      const r = await api.completeSetup(payload);
      if (!r.ok) {
        setError(r.error || "Échec de la configuration");
        setBusy(false);
        setStatusLine(null);
        return;
      }
      setStatusLine(
        afterCompleteHref === "/" || afterCompleteHref === "/dashboard"
          ? `Prêt — ${r.hostname}. Ouverture de l'espace…`
          : `Prêt — ${r.hostname}. Suite de la configuration…`,
      );
      window.setTimeout(() => {
        window.location.href = afterCompleteHref;
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
      setBusy(false);
      setStatusLine(null);
    }
  }

  if (!ready) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-white"
        style={{ backgroundColor: background }}
      >
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: accent }} />
      </div>
    );
  }

  if (!desktop) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Configuration initiale</h1>
          <p className="mt-2 text-sm text-slate-600">
            Le premier lancement (compte, clé de récupération, tunnel{" "}
            <code className="text-xs">*.{hostSuffix}</code>, clé OpenAI) est
            indisponible ici. Ouvrez{" "}
            <code className="text-xs">/setup</code> sur le serveur Docker, ou
            l&apos;application desktop {productName}.
          </p>
        </div>
      </div>
    );
  }

  const btnAccent = { backgroundColor: accent } as const;

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4 text-white"
      style={{ backgroundColor: background }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
        <div className="text-center">
          <div className="text-2xl font-bold tracking-tight" style={{ color: accent }}>
            {productName}
          </div>
          <p className="mt-1 text-sm text-white/70">Configuration du premier lancement</p>
          <button
            type="button"
            className="mt-2 text-sm text-white/70 underline decoration-white/30 hover:text-white"
            onClick={() => {
              void resolveApi()?.rechooseConnection?.();
            }}
          >
            Changer de serveur…
          </button>
        </div>

        <ol className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
          {stepLabels.map((label, idx) => {
            const n = (idx + 1) as Step;
            return (
              <li
                key={label}
                className={
                  n === step
                    ? "rounded-full px-2.5 py-1 font-medium text-white"
                    : n < step
                      ? "rounded-full bg-emerald-600/80 px-2.5 py-1 text-white"
                      : "rounded-full bg-white/10 px-2.5 py-1 text-white/50"
                }
                style={n === step ? btnAccent : undefined}
              >
                {label}
              </li>
            );
          })}
        </ol>

        {step === 1 ? (
          <form onSubmit={(e) => void nextFromAccount(e)} className="mt-6 space-y-3">
            <p className="text-sm text-white/80">
              Créez votre compte local — cet identifiant vous servira à vous reconnecter.
            </p>
            <Input
              type="text"
              autoComplete="username"
              placeholder="Identifiant"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="bg-white text-slate-900"
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-white text-slate-900"
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Confirmer le mot de passe"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              className="bg-white text-slate-900"
            />
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={stayLoggedIn}
                onChange={(e) => setStayLoggedIn(e.target.checked)}
                className="rounded border-white/30"
              />
              Rester connecté sur cet ordinateur
            </label>
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            <Button type="submit" className="w-full hover:opacity-90" style={btnAccent}>
              Continuer
            </Button>
          </form>
        ) : null}

        {step === 2 ? (
          <form onSubmit={nextFromRecovery} className="mt-6 space-y-3">
            <p className="text-sm text-white/80">
              Notez cette <strong className="text-white">clé de récupération</strong> dans un
              endroit sûr. Aucune copie n&apos;est conservée chez {productName} — c&apos;est le seul
              moyen de réinitialiser votre mot de passe local.
            </p>
            <div className="rounded-lg border border-amber-400/40 bg-black/40 p-3">
              <p className="break-all font-mono text-sm leading-relaxed tracking-wide text-amber-100">
                {recoveryKey || "…"}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyRecoveryKey()}
                className="mt-3 border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Copié
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copier
                  </>
                )}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={recoveryAck}
                onChange={(e) => setRecoveryAck(e.target.checked)}
                className="mt-0.5 rounded border-white/30"
                required
              />
              J&apos;ai bien noté cette clé de récupération. Je comprends qu&apos;elle ne sera
              plus affichée.
            </label>
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                Retour
              </Button>
              <Button
                type="submit"
                disabled={!recoveryAck}
                className="flex-1 hover:opacity-90 disabled:opacity-40"
                style={btnAccent}
              >
                Continuer
              </Button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form onSubmit={nextFromSlug} className="mt-6 space-y-3">
            <p className="text-sm text-white/80">
              {tunnelHelp}{" "}
              <span className="font-mono" style={{ color: accent }}>
                {slug.trim() || "votre-slug"}.{hostSuffix}
              </span>
            </p>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder={slugPlaceholder}
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  setSlugOk(null);
                  setSlugReason(null);
                }}
                required
                className="bg-white text-slate-900"
              />
              <Button
                type="button"
                variant="outline"
                disabled={checkingSlug}
                onClick={() => void checkSlug()}
                className="shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                {checkingSlug ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vérifier"}
              </Button>
            </div>
            {slugOk === true ? (
              <p className="text-sm text-emerald-300">Slug disponible</p>
            ) : null}
            {slugOk === false ? (
              <p className="text-sm text-rose-300">{slugReason || "Indisponible"}</p>
            ) : null}
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(2)}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                Retour
              </Button>
              <Button type="submit" className="flex-1 hover:opacity-90" style={btnAccent}>
                Continuer
              </Button>
            </div>
          </form>
        ) : null}

        {step === 4 ? (
          <form onSubmit={(e) => void finish(e)} className="mt-6 space-y-3">
            <p className="text-sm text-white/80">
              Collez votre clé OpenAI (BYOK). Elle reste chiffrée sur cet ordinateur et active
              l&apos;assistant.
            </p>
            <Input
              type="password"
              placeholder="sk-…"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              required={requireOpenaiKey}
              className="bg-white text-slate-900"
              disabled={busy}
            />
            {statusLine ? <p className="text-sm text-sky-200">{statusLine}</p> : null}
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setStep(3)}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                Retour
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="flex-1 hover:opacity-90"
                style={btnAccent}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Configuration…
                  </>
                ) : (
                  "Terminer et démarrer"
                )}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
