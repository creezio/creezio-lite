"use client";

/**
 * Racine de la démo interactive — à monter une fois dans le chrome de la
 * marque (layout / BrandChrome). Charge les scénarios depuis le mount
 * `/api/v1/modules/interactive-demo`, lance automatiquement le scénario
 * `autoStart` à la première visite (après setup/onboarding), affiche le
 * lanceur flottant « Visite guidée » et écoute l'événement
 * `creezio-interactive-demo` pour un déclenchement programmatique.
 *
 * « Déjà vu » : localStorage (immédiat) + preferences serveur (par
 * utilisateur, si `userKey` fourni) — best effort, jamais bloquant.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoScenario } from "@creezio/interactive-demo";
import { scenarioMatchesRole } from "@creezio/interactive-demo";
import { registerSidebarActionsProvider } from "@creezio/shell-ui/ui";
import { DemoPlayer } from "./demo-player";

/** Icône du lanceur (play) — inline : lucide-react est un peer optionnel. */
function LauncherIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  );
}

export const INTERACTIVE_DEMO_EVENT = "creezio-interactive-demo";

/** Déclenche la démo depuis n'importe où (bouton marque, page d'aide…). */
export function startInteractiveDemo(scenarioId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(INTERACTIVE_DEMO_EVENT, { detail: { scenarioId } }),
  );
}

export type InteractiveDemoRootProps = {
  /** Base du mount api-kernel (défaut `/api/v1/modules/interactive-demo`). */
  apiBase?: string;
  /** Navigation SPA (ex. `router.push` Next) — fortement recommandé. */
  navigate?: (href: string) => void;
  /** Clé utilisateur pour la persistance serveur du « déjà vu ». */
  userKey?: string | null;
  /**
   * Rôle de l'utilisateur courant : le lanceur et l'autoStart ne proposent
   * que les scénarios sans `roles` ou dont `roles` inclut ce rôle.
   * `null`/`undefined` = pas de filtrage (comportement historique). Un
   * lancement explicite (`startInteractiveDemo(id)`) ignore ce filtre.
   */
  role?: string | null;
  /** Lancement auto du scénario `autoStart` à la première visite (défaut true). */
  autoStart?: boolean;
  /** Affiche le bouton flottant « Visite guidée » (défaut true). */
  showLauncher?: boolean;
  /**
   * Placement du lanceur : "floating" = bouton flottant historique (défaut,
   * rétrocompatible) ; "sidebar" = entrée d'action dans la sidebar kit
   * (registre @creezio/shell-ui — visible uniquement dans le workspace
   * authentifié, jamais sur /login) ; "none" = aucun lanceur (déclenchement
   * uniquement via `startInteractiveDemo()`).
   */
  launcher?: "floating" | "sidebar" | "none";
  /** Libellé du lanceur. */
  launcherLabel?: string;
  /** Scénarios injectés (tests / offline) — court-circuite le fetch. */
  scenarios?: DemoScenario[];
  /** Badge du faux curseur (défaut « Démo »). */
  cursorLabel?: string;
};

function seenStorageKey(id: string) {
  return `creezio-demo-seen:${id}`;
}

function hasSeenLocally(id: string): boolean {
  try {
    return window.localStorage.getItem(seenStorageKey(id)) != null;
  } catch {
    return false;
  }
}

function markSeenLocally(id: string) {
  try {
    window.localStorage.setItem(seenStorageKey(id), new Date().toISOString());
  } catch {
    /* stockage indisponible — le serveur garde la trace */
  }
}

export function InteractiveDemoRoot({
  apiBase = "/api/v1/modules/interactive-demo",
  navigate,
  userKey,
  role,
  autoStart = true,
  showLauncher = true,
  launcher = "floating",
  launcherLabel = "Visite guidée",
  scenarios: injected,
  cursorLabel,
}: InteractiveDemoRootProps) {
  const [scenarios, setScenarios] = useState<DemoScenario[]>(injected ?? []);
  const [active, setActive] = useState<DemoScenario | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const autoStartedRef = useRef(false);
  const serverSeenRef = useRef<Set<string>>(new Set());

  const enabled = scenarios.filter((s) => s.enabled !== false && s.steps.length > 0);
  /* Lanceur + autoStart : scénarios visibles pour le rôle courant. */
  const visible = enabled.filter((s) => scenarioMatchesRole(s, role));

  /* Chargement des scénarios + « déjà vu » serveur. */
  useEffect(() => {
    if (injected) {
      setScenarios(injected);
      return;
    }
    let disposed = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/scenarios`);
        if (!res.ok) return;
        const data = (await res.json()) as { scenarios?: DemoScenario[] };
        if (!disposed && Array.isArray(data.scenarios)) {
          setScenarios(data.scenarios);
        }
      } catch {
        /* mount absent — pas de démo */
      }
      if (disposed || !userKey) return;
      try {
        const res = await fetch(
          `${apiBase}/preferences?user=${encodeURIComponent(userKey)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { answers?: Record<string, unknown> };
        if (!disposed && data.answers) {
          for (const key of Object.keys(data.answers)) {
            if (key.startsWith("seen:")) {
              serverSeenRef.current.add(key.slice("seen:".length));
            }
          }
        }
      } catch {
        /* préférences indisponibles — localStorage suffit */
      }
    })();
    return () => {
      disposed = true;
    };
  }, [apiBase, injected, userKey]);

  const markSeen = useCallback(
    (id: string) => {
      markSeenLocally(id);
      serverSeenRef.current.add(id);
      if (!userKey) return;
      fetch(`${apiBase}/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: userKey,
          answers: { [`seen:${id}`]: new Date().toISOString() },
        }),
        keepalive: true,
      }).catch(() => {
        /* best effort */
      });
    },
    [apiBase, userKey],
  );

  const start = useCallback(
    (scenarioId?: string) => {
      setMenuOpen(false);
      const list = scenarios.filter((s) => s.enabled !== false && s.steps.length > 0);
      // Id explicite (startInteractiveDemo) : lancement forcé, sans filtre rôle.
      if (scenarioId) {
        const scenario = list.find((s) => s.id === scenarioId);
        if (scenario) setActive(scenario);
        return;
      }
      const candidates = list.filter((s) => scenarioMatchesRole(s, role));
      const scenario = candidates.find((s) => s.autoStart) ?? candidates[0];
      if (scenario) setActive(scenario);
    },
    [scenarios, role],
  );

  /* Déclenchement programmatique. */
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ scenarioId?: string }>).detail;
      start(detail?.scenarioId);
    };
    window.addEventListener(INTERACTIVE_DEMO_EVENT, onEvent);
    return () => window.removeEventListener(INTERACTIVE_DEMO_EVENT, onEvent);
  }, [start]);

  /* Lancement auto à la première visite. */
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || active) return;
    const candidate = visible.find((s) => s.autoStart);
    if (!candidate) return;
    if (hasSeenLocally(candidate.id) || serverSeenRef.current.has(candidate.id)) {
      return;
    }
    autoStartedRef.current = true;
    const timer = setTimeout(() => setActive(candidate), 1400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, active, scenarios, role]);

  /* Lanceur « sidebar » : entrée d'action dans la sidebar kit dès qu'un
     scénario est proposable pour le rôle courant. L'entrée reste visible
     même pendant une lecture (cliquer relance proprement via start()). Le
     provider est relu à chaque (ré)enregistrement — garder la closure pure. */
  useEffect(() => {
    if (launcher !== "sidebar" || visible.length === 0) return;
    return registerSidebarActionsProvider(() => [
      {
        id: "interactive-demo",
        label: launcherLabel,
        icon: LauncherIcon,
        onSelect: () => start(),
      },
    ]);
  }, [launcher, launcherLabel, visible.length, start]);

  const stop = useCallback(
    (finished: boolean) => {
      if (active) markSeen(active.id);
      void finished;
      setActive(null);
    },
    [active, markSeen],
  );

  if (active) {
    return (
      <DemoPlayer
        scenario={active}
        navigate={navigate}
        cursorLabel={cursorLabel}
        onFinish={() => stop(true)}
        onExit={() => stop(false)}
      />
    );
  }

  if (launcher !== "floating" || !showLauncher || visible.length === 0) {
    return null;
  }

  return (
    <div data-creezio-demo-ui="1">
      {menuOpen && visible.length > 1 ? (
        <div className="creezio-demo-launcher-menu">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              className="creezio-demo-launcher-item"
              onClick={() => start(s.id)}
            >
              <p className="creezio-demo-launcher-item-title">{s.title}</p>
              {s.description ? (
                <p className="creezio-demo-launcher-item-desc">{s.description}</p>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="creezio-demo-launcher"
        onClick={() =>
          visible.length > 1 ? setMenuOpen((v) => !v) : start(visible[0]!.id)
        }
        aria-label={launcherLabel}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 3l14 9-14 9V3z" />
        </svg>
        {launcherLabel}
      </button>
    </div>
  );
}
