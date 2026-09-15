/**
 * Accept-check plugins — port TF gold plugin-accept-check.ts (N1).
 */

import {
  discoverPlugins,
  hasPluginPermission,
  type PluginAcceptanceSmoke,
  type PluginManifest,
} from "./runtime.js";
import { getRunningPlugins, proxyPluginHealth } from "./launcher.js";
import { runPluginTests } from "./test-runner.js";

export type AcceptCheckItem = {
  name: string;
  ok: boolean;
  status?: number;
  detail?: string;
};

export type AcceptCheckResult = {
  ok: boolean;
  pluginId: string;
  checks: AcceptCheckItem[];
  hint?: string;
};

const DEFAULT_SMOKES: PluginAcceptanceSmoke[] = [
  { method: "GET", path: "/health", expectStatus: 200 },
  { method: "GET", path: "/api/crm/stack/items", expectStatus: 200 },
];

export function resolvePluginSmokes(
  manifest: PluginManifest,
): PluginAcceptanceSmoke[] {
  const listed = manifest.acceptance?.smoke;
  if (listed && listed.length) return listed;
  if ((manifest.permissions || []).includes("crm:read")) {
    return DEFAULT_SMOKES;
  }
  return [{ method: "GET", path: "/health", expectStatus: 200 }];
}

async function smokeOne(
  base: string,
  smoke: PluginAcceptanceSmoke,
): Promise<AcceptCheckItem> {
  const method = (smoke.method || "GET").toUpperCase();
  const pathPart = smoke.path.startsWith("/") ? smoke.path : `/${smoke.path}`;
  const name = `${method} ${pathPart}`;
  const expect = smoke.expectStatus ?? 200;
  try {
    const res = await fetch(`${base}${pathPart}`, {
      method,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(smoke.timeoutMs ?? 5000),
    });
    const text = await res.text().catch(() => "");
    let bodySnippet = text.slice(0, 240);
    try {
      bodySnippet = JSON.stringify(JSON.parse(text)).slice(0, 240);
    } catch {
      /* plain */
    }
    const ok = res.status === expect;
    return {
      name,
      ok,
      status: res.status,
      detail: ok
        ? bodySnippet || `HTTP ${res.status}`
        : `attendu ${expect}, reçu ${res.status}: ${bodySnippet}`,
    };
  } catch (e) {
    return {
      name,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkPanelUi(
  base: string,
  manifest: PluginManifest,
): Promise<AcceptCheckItem> {
  const panelPath = manifest.panel?.path || "/";
  const name = "G5 UI (kit tf-)";
  try {
    const res = await fetch(
      `${base}${panelPath.startsWith("/") ? panelPath : `/${panelPath}`}`,
      {
        method: "GET",
        headers: { Accept: "text/html" },
        signal: AbortSignal.timeout(5000),
      },
    );
    const html = await res.text().catch(() => "");
    const referencesCss = html.includes("plugin-ui.css");
    const usesTfClasses = /class\s*=\s*["'][^"']*\btf-[a-z]/.test(html);
    const ok = res.ok && referencesCss && usesTfClasses;
    return {
      name,
      ok,
      status: res.status,
      detail: ok
        ? "plugin-ui.css référencé + classes tf- utilisées"
        : !res.ok
          ? `panel HTTP ${res.status}`
          : `manque : ${[
              referencesCss ? null : "référence à plugin-ui.css",
              usesTfClasses ? null : "classes tf- (tf-btn, tf-card, tf-table…)",
            ]
              .filter(Boolean)
              .join(" et ")}`,
    };
  } catch (e) {
    return {
      name,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runPluginAcceptCheck(
  id: string,
): Promise<AcceptCheckResult> {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p || p.error) {
    return {
      ok: false,
      pluginId: id,
      checks: [
        {
          name: "discover",
          ok: false,
          detail: p?.error || "plugin inconnu",
        },
      ],
      hint: "Plugin introuvable sous userData/plugins",
    };
  }

  const checks: AcceptCheckItem[] = [];
  const health = await proxyPluginHealth(id);
  checks.push({
    name: "health (control plane)",
    ok: health.ok,
    status: health.status,
    detail: health.ok
      ? JSON.stringify(health.body).slice(0, 200)
      : health.error || "health fail",
  });

  const run = getRunningPlugins().find((r) => r.id === id);
  if (!run?.port) {
    checks.push({
      name: "port",
      ok: false,
      detail: "plugin non démarré — POST …/restart",
    });
    return {
      ok: false,
      pluginId: id,
      checks,
      hint: "Redémarrer le plugin puis relancer accept-check",
    };
  }

  const base = `http://127.0.0.1:${run.port}`;
  for (const smoke of resolvePluginSmokes(p.manifest)) {
    checks.push(await smokeOne(base, smoke));
  }

  if (hasPluginPermission(p.manifest, "ui:panel")) {
    checks.push(await checkPanelUi(base, p.manifest));
  }

  try {
    const tests = await runPluginTests(id);
    checks.push({
      name: "tests plugin",
      ok: tests.ok,
      detail: tests.files.length
        ? `${tests.files.length} fichier(s), exit ${tests.exitCode}, ${tests.durationMs} ms`
        : "aucun test déclaré (compatibilité legacy)",
    });
  } catch (error) {
    checks.push({
      name: "tests plugin",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    pluginId: id,
    checks,
    hint: ok
      ? "Accept-check OK — tu peux marquer la todo done et ouvrir le panel"
      : checks.some((c) => c.name.startsWith("G5") && !c.ok)
        ? "Accept-check échoué (G5 UI) — le panel doit charger plugin-ui.css " +
          '(<link rel="stylesheet" href="/plugin-ui.css">) et utiliser les classes tf- ' +
          "du styleguide (tf-btn, tf-card, tf-table…) avant « done »"
        : "Accept-check échoué — corriger proxy/CRM/smoke avant « done » (health seul ≠ done)",
  };
}
