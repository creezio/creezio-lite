"use client";

/**
 * Rendu public de la landing — consomme `GET /api/v1/modules/landing/public`
 * (contenu 100 % en DB brand). Page publique : aucune session requise.
 *
 * Surcharge marque : `components={{ hero: MonHero, "mon-kind": MaSection }}`
 * remplace/complète les préfabriqués kit (patron ADR-module-natif-hybride).
 */

import { useEffect, useState } from "react";
import { LANDING_PREFAB_COMPONENTS } from "./prefabs";
import type {
  LandingComponents,
  LandingSectionView,
  LandingSettingsView,
} from "./types";
import "./landing.css";

const API = "/api/v1/modules/landing";

export function LandingPublicPage({
  components,
  apiBase,
}: {
  components?: LandingComponents;
  /** Base API (défaut : même origine). */
  apiBase?: string;
}) {
  const [sections, setSections] = useState<LandingSectionView[] | null>(null);
  const [settings, setSettings] = useState<LandingSettingsView>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase || ""}${API}/public`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!cancelled && j?.ok) {
          setSections(j.sections || []);
          setSettings(j.settings || {});
        } else if (!cancelled) {
          setSections([]);
        }
      } catch {
        if (!cancelled) setSections([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (settings.title) document.title = String(settings.title);
  }, [settings.title]);

  const registry: LandingComponents = {
    ...LANDING_PREFAB_COMPONENTS,
    ...(components || {}),
  };

  const style = {
    ...(settings.accent ? { "--lnd-accent": String(settings.accent) } : {}),
    ...(settings.background ? { "--lnd-bg": String(settings.background) } : {}),
  } as React.CSSProperties;

  return (
    <div className="lnd-root" style={style}>
      {sections === null ? (
        <div className="lnd-empty">…</div>
      ) : sections.length === 0 ? (
        <div className="lnd-empty">
          Cette page n&apos;est pas encore configurée.
        </div>
      ) : (
        sections.map((s) => {
          const Comp = registry[s.kind];
          if (!Comp) return null;
          return <Comp key={s.id} content={s.content} settings={settings} />;
        })
      )}
    </div>
  );
}
