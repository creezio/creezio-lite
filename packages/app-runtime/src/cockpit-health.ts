/**
 * Santé agrégée cockpit (kit-native) — parité kit `lib/cockpit-health.ts`.
 *
 * Lit les envs posés par le harness / desktop après warm natif :
 * - Meili   : MEILI_HOST → GET /health
 * - Hermes  : HERMES_API_URL / HERMES_GATEWAY_URL → GET /health
 * - n8n     : N8N_BASE_URL / N8N_API_URL → GET /healthz
 * - tunnel  : APP_PUBLIC_URL / MCP_PUBLIC_URL
 *
 * Jamais de throw — `{ configured, ok, url, error? }` par service.
 */

import fs from "node:fs";

export type CockpitServiceHealth = {
  configured: boolean;
  ok: boolean;
  url: string | null;
  error?: string;
};

export type CockpitHealthPayload = {
  generated_at: string;
  next: { ok: boolean; db: boolean; db_path: string };
  meili: CockpitServiceHealth;
  hermes: CockpitServiceHealth;
  n8n: CockpitServiceHealth;
  tunnel: { configured: boolean; public_url: string | null };
};

async function pingJson(
  url: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function normalizeBase(raw: string | undefined): string | null {
  const s = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  return /^https?:\/\//i.test(s) ? s : null;
}

async function serviceHealth(
  base: string | null,
  healthPath: string,
): Promise<CockpitServiceHealth> {
  if (!base) return { configured: false, ok: false, url: null };
  const r = await pingJson(`${base}${healthPath}`);
  return {
    configured: true,
    ok: r.ok,
    url: base,
    ...(r.error ? { error: r.error } : {}),
  };
}

export async function buildCockpitHealth(opts?: {
  dbPath?: string | null;
}): Promise<CockpitHealthPayload> {
  const dbPath = String(opts?.dbPath || process.env.BRAND_DB_PATH || "").trim();
  const dbOk = (() => {
    if (!dbPath) return false;
    try {
      return fs.existsSync(dbPath);
    } catch {
      return false;
    }
  })();

  const meiliBase =
    normalizeBase(process.env.MEILI_HOST) || "http://127.0.0.1:7701";
  const hermesBase = normalizeBase(
    process.env.HERMES_API_URL || process.env.HERMES_GATEWAY_URL,
  );
  const n8nBase =
    normalizeBase(process.env.N8N_BASE_URL) ||
    (normalizeBase(process.env.N8N_API_URL)?.replace(/\/api\/v1$/, "") ?? null);
  const publicUrl = normalizeBase(
    process.env.APP_PUBLIC_URL || process.env.MCP_PUBLIC_URL,
  );

  const [meili, hermes, n8n] = await Promise.all([
    serviceHealth(meiliBase, "/health"),
    serviceHealth(hermesBase, "/health"),
    serviceHealth(n8nBase, "/healthz"),
  ]);

  return {
    generated_at: new Date().toISOString(),
    next: { ok: dbOk, db: dbOk, db_path: dbPath },
    meili,
    hermes,
    n8n,
    tunnel: { configured: Boolean(publicUrl), public_url: publicUrl },
  };
}
