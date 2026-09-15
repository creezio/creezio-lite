/**
 * AppMap générique — pages injectées via configureAssistantBrand({ appMap }).
 * Aucune page panier/dispatch/catalogue TF en dur.
 */
import type { AssistantAppPage } from "./types.js";
import { assistantAppMapPages } from "./registry.js";

export type AppPage = AssistantAppPage;

/** Alias historique. */
export const APP_MAP: AppPage[] = [];

export function getAppMap(): AppPage[] {
  return assistantAppMapPages();
}

export function appMapPromptSection(): string {
  const pages = getAppMap();
  if (!pages.length) {
    return "- (carte applicative non configurée — configureAssistantBrand({ appMap }))";
  }
  return pages
    .map((p) => {
      const syn = p.synonymes.join(", ");
      return `- **${p.route}** — ${p.titre} : ${p.role} (mots utilisateurs : ${syn})`;
    })
    .join("\n");
}

export function pageInfoFor(
  path: string,
): { route: string; titre: string; role: string; actions: string[] } | null {
  const clean = (path.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const segs = clean.split("/").filter(Boolean);
  let best: AppPage | null = null;
  for (const page of getAppMap()) {
    const pSegs = page.route.split("/").filter(Boolean);
    if (pSegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      const ps = pSegs[i]!;
      if (ps.startsWith(":")) continue;
      if (ps !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      best = page;
      break;
    }
  }
  if (!best) return null;
  return {
    route: best.route,
    titre: best.titre,
    role: best.role,
    actions: best.actions,
  };
}
