#!/usr/bin/env node
/**
 * Gate parité serveur Docker headless — phases TF2 portées dans le harness
 * (`startBrandKernelHarness`), prouvées FONCTIONNELLEMENT en sandbox :
 *
 * - HPP1 : boot harness synthétique complet →
 *     · import catalogue APRÈS le listen (METIER_BASE_URL posé — plus de skip) ;
 *     · tunnel AUTO-PROVISIONNÉ via l'API Cloudflare MOCKÉE (POST cfd_tunnel
 *       → PUT configurations → DNS) + faux cloudflared spawné IN-PROCESS
 *       avec le token (aucun DNS/réseau réel) — fin du provisioner VPS ;
 *     · MCP OAuth public = URL tunnel https (plus de 127.0.0.1 forcé) ;
 *     · EMAIL_INBOUND_SECRET opérateur persisté + EMAIL_DOMAIN dérivé du
 *       tunnel CF (mails entrants) ;
 *     · plugins démarrés + control plane (CREEZIO_PLUGINS=1) ;
 *     · fleet agent démarré, no-op propre sur endpoint sentinelle ;
 *     · toutes les étapes visibles dans /api/v1/os/boot-status.
 * - HPP2 : ordre du code harness (catalog-import post-listen, bridge Hermes
 *     post-warm, n8n publicBaseUrl) + Dockerfile cloudflared + template factory.
 * - HPP3 : applyBrandCatalogEnvDefaults (défaut léger tests / opt-in prod).
 * - HPP4 : sonde publique tunnel (retry/backoff, succès réel, échec honnêt)
 *     + câblage du nouveau contrat CF dans la phase (plus de sidecar).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAppManifest } from "../packages/brand-config/dist/index.js";
import {
  applyBrandCatalogEnvDefaults,
  probeTunnelPublicUrl,
  startBrandKernelHarness,
} from "../packages/app-runtime/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENV_KEYS = [
  "CREEZIO_SKIP_KIT_BINARIES",
  "CREEZIO_NATIVE_WARM",
  "CREEZIO_PLUGINS",
  "CREEZIO_CF_API_TOKEN",
  "CREEZIO_CF_ACCOUNT_ID",
  "CREEZIO_CF_ZONE_ID",
  "CREEZIO_CF_ZONE_NAME",
  "CREEZIO_CF_UNIVERSAL_SSL",
  "CREEZIO_TUNNEL_SLUG",
  "CREEZIO_TUNNEL_PUBLIC_PROBE",
  "CREEZIO_CLOUDFLARED_BINARY",
  "CREEZIO_FLEET_ENDPOINT",
  "CREEZIO_GATE_CF_MARKER",
  "EMAIL_INBOUND_SECRET",
  "EMAIL_DOMAIN",
  "APP_PUBLIC_URL",
  "MCP_PUBLIC_URL",
  "AUTH_SECRET",
  "MCP_JWT_SECRET",
  "METIER_BASE_URL",
];
const saveEnv = () =>
  Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = (saved) => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

/**
 * API Cloudflare v4 MOCKÉE (stateful : tunnels + DNS) — seul
 * api.cloudflare.com est intercepté, tout le reste passe au fetch réel
 * (boot-status, sondes locales du harness).
 */
function startCfMock() {
  const calls = [];
  const tunnels = new Map(); // id → { id, name, config }
  const dns = new Map(); // id → record
  let seqT = 0;
  let seqD = 0;
  const json = (result, status = 200) =>
    new Response(JSON.stringify({ success: status < 400, result }), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fail = (status, message) =>
    new Response(
      JSON.stringify({ success: false, errors: [{ message }], result: null }),
      { status, headers: { "content-type": "application/json" } },
    );
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== "api.cloudflare.com") return prev(url, init);
    const p = u.pathname.replace(/^\/client\/v4/, "");
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: p, body });
    let m;
    if ((m = p.match(/^\/accounts\/[^/]+\/cfd_tunnel$/)) && method === "POST") {
      const id = `t-gate-${++seqT}`;
      tunnels.set(id, { id, name: body?.name, config: null });
      return json({ id, name: body?.name, token: `tok-${id}` });
    }
    if ((m = p.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)$/))) {
      const t = tunnels.get(m[1]);
      if (method === "GET") {
        return t ? json({ id: t.id, name: t.name }) : fail(404, "not found");
      }
    }
    if (
      (m = p.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/configurations$/))
    ) {
      const t = tunnels.get(m[1]);
      if (!t) return fail(404, "not found");
      if (method === "PUT") {
        t.config = body?.config || null;
        return json({ config: t.config });
      }
      return t.config ? json({ config: t.config }) : fail(404, "no config");
    }
    if ((m = p.match(/^\/zones\/[^/]+\/dns_records$/))) {
      if (method === "GET") {
        const name = u.searchParams.get("name") || "";
        const type = u.searchParams.get("type") || "";
        return json(
          [...dns.values()].filter(
            (r) => r.name === name && (!type || r.type === type),
          ),
        );
      }
      if (method === "POST") {
        const id = `dns-${++seqD}`;
        dns.set(id, { id, ...body });
        return json({ id, ...body });
      }
    }
    if ((m = p.match(/^\/zones\/[^/]+\/dns_records\/([^/]+)$/))) {
      const rec = dns.get(m[1]);
      if (!rec) return fail(404, "not found");
      if (method === "PUT") {
        dns.set(m[1], { ...rec, ...body });
        return json(dns.get(m[1]));
      }
    }
    return fail(400, `route inconnue du mock: ${method} ${p}`);
  };
  return {
    calls,
    tunnels,
    dns,
    restore: () => {
      globalThis.fetch = prev;
    },
  };
}

/** Faux cloudflared : écrit ses args puis émet la ligne « Registered … ». */
function writeFakeCloudflared(dir) {
  const bin = path.join(dir, "cloudflared");
  fs.writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\n' "$@" > "$CREEZIO_GATE_CF_MARKER"
echo "Registered tunnel connection (gate stub)"
# exec : child.kill() du kit tue bien le sleep (pas d'orphelin qui retient
# les pipes stdio du process de test).
exec sleep 300
`,
    { mode: 0o755 },
  );
  return bin;
}

test("HPP1 harness : catalogue post-listen + tunnel CF auto-provisionné + MCP public + plugins + fleet", async () => {
  const saved = saveEnv();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-parity-"));
  const cf = startCfMock();
  const marker = path.join(tmp, "cloudflared-args.txt");
  let handle = null;
  try {
    delete process.env.AUTH_SECRET;
    delete process.env.MCP_JWT_SECRET;
    delete process.env.EMAIL_DOMAIN;
    delete process.env.CREEZIO_FLEET_ENDPOINT; // sentinelle ingest-disabled
    delete process.env.CREEZIO_CF_UNIVERSAL_SSL; // mode flat (défaut D2)
    process.env.CREEZIO_SKIP_KIT_BINARIES = "1";
    process.env.CREEZIO_NATIVE_WARM = "0";
    process.env.CREEZIO_PLUGINS = "1";
    // Contrat CF (cf.env de l'instance en prod) — l'instance provisionne
    // elle-même son tunnel via l'API Cloudflare (mockée ici).
    process.env.CREEZIO_CF_API_TOKEN = "cf-gate-token";
    process.env.CREEZIO_CF_ACCOUNT_ID = "acc-gate";
    process.env.CREEZIO_CF_ZONE_ID = "zone-gate";
    process.env.CREEZIO_CF_ZONE_NAME = "gate.test";
    process.env.CREEZIO_TUNNEL_SLUG = "probe";
    process.env.CREEZIO_TUNNEL_PUBLIC_PROBE = "0"; // sonde publique off (DNS fictif)
    process.env.CREEZIO_CLOUDFLARED_BINARY = writeFakeCloudflared(tmp);
    process.env.CREEZIO_GATE_CF_MARKER = marker;
    // Secret mails entrants : fourni par l'opérateur (secrets.env) —
    // persisté au provisioning, EMAIL_DOMAIN dérivé du tunnel CF.
    process.env.EMAIL_INBOUND_SECRET = "inbound-secret-gate";

    const manifest = createAppManifest({
      brandId: "harnessprobe",
      productName: "Harness Probe",
      domain: "harnessprobe.local",
      sandbox: true,
    });

    // Host catalogue stub : enregistre l'état de METIER_BASE_URL au moment
    // de l'import — la régression corrigée était « import avant listen ».
    const importCalls = [];
    const catalogHost = {
      RateEstimator: class {},
      formatEta: () => "—",
      ensureCatalogPresent: async (onProgress) => {
        onProgress({ phase: "done", percent: 100, detail: "stub présent" });
        return "present";
      },
      ensureCatalogImported: async (onProgress) => {
        importCalls.push({
          metierBaseUrl: (process.env.METIER_BASE_URL || "").trim(),
        });
        onProgress({ phase: "done", percent: 100, detail: "stub importé" });
        return "imported";
      },
    };

    handle = await startBrandKernelHarness({
      brandId: "harnessprobe",
      appRoot: tmp,
      dataDir: path.join(tmp, "data"),
      manifest,
      brandMigrations: [],
      registerModuleApi: () => {},
      skipIndex: true,
      catalogHost,
    });

    // 1) Import catalogue appelé APRÈS le listen, avec l'URL kernel réelle.
    assert.equal(importCalls.length, 1, "ensureCatalogImported appelé 1×");
    assert.equal(
      importCalls[0].metierBaseUrl,
      handle.baseUrl,
      "METIER_BASE_URL posé avant l'import (plus de skip pré-listen)",
    );

    // 2) API CF mockée : tunnel créé (config_src cloudflare) puis ingress
    //    PUT avec le port CRM réel — aucune ressource externe réelle.
    const creates = cf.calls.filter(
      (c) => c.method === "POST" && /\/cfd_tunnel$/.test(c.path),
    );
    assert.equal(creates.length, 1, "POST cfd_tunnel (création)");
    assert.equal(creates[0].body.config_src, "cloudflare");
    assert.equal(creates[0].body.name, "creezio-server-probe");
    const puts = cf.calls.filter(
      (c) => c.method === "PUT" && /\/configurations$/.test(c.path),
    );
    assert.ok(puts.length >= 1, "PUT configurations (ingress)");
    const ingress = puts.at(-1).body.config.ingress;
    const crmRule = ingress.find((r) => r.hostname === "probe.gate.test");
    assert.equal(
      crmRule?.service,
      `http://127.0.0.1:${handle.port}`,
      "ingress CRM → port réel, 127.0.0.1 (cloudflared in-process)",
    );
    // D2 défaut flat : hostnames de services n8n-{slug}.{zone}.
    assert.ok(
      ingress.some((r) => r.hostname === "n8n-probe.gate.test"),
      "ingress n8n flat",
    );
    // DNS : CNAME probe.gate.test → {tunnelId}.cfargotunnel.com (proxied).
    const cname = [...cf.dns.values()].find((r) => r.name === "probe.gate.test");
    assert.equal(cname?.type, "CNAME");
    assert.match(String(cname?.content), /^t-gate-\d+\.cfargotunnel\.com$/);
    assert.equal(cname?.proxied, true);

    // 3) cloudflared spawné IN-PROCESS avec le token CF (faux binaire).
    const cfArgs = fs.readFileSync(marker, "utf8").trim().split("\n");
    assert.deepEqual(
      cfArgs,
      ["tunnel", "--no-autoupdate", "run", "--token", "tok-t-gate-1"],
      "startCloudflared lance le binaire avec le token du tunnel créé",
    );

    // 4) Boot-status : étapes serveur visibles et vertes.
    const status = await (
      await fetch(`${handle.baseUrl}/api/v1/os/boot-status`)
    ).json();
    const step = (id) => status.steps.find((s) => s.id === id);
    assert.equal(step("catalog-import")?.status, "done", JSON.stringify(step("catalog-import")));
    assert.equal(step("tunnel")?.status, "done", JSON.stringify(step("tunnel")));
    assert.equal(step("plugins")?.status, "done", JSON.stringify(step("plugins")));
    assert.equal(step("fleet")?.status, "done", JSON.stringify(step("fleet")));
    assert.match(
      String(step("fleet")?.detail || ""),
      /sentinelle|désactivée/i,
      "fleet sans endpoint réel = no-op propre (pas d'envoi réseau)",
    );
    assert.match(
      String(step("plugins")?.detail || ""),
      /API http:\/\/127\.0\.0\.1:\d+/,
      "control plane plugins démarré",
    );

    // 5) MCP OAuth public = URL tunnel https (plus de loopback forcé).
    const mcpStatus = await (
      await fetch(`${handle.baseUrl}/api/v1/os/mcp-oauth/status`)
    ).json();
    assert.ok(
      String(mcpStatus.publicUrl || "").startsWith("https://probe.gate.test"),
      `MCP public attendu sur le tunnel: ${JSON.stringify(mcpStatus)}`,
    );
    assert.equal(process.env.APP_PUBLIC_URL, "https://probe.gate.test");
    assert.equal(process.env.MCP_PUBLIC_URL, "https://probe.gate.test");

    // 6) Mails entrants : secret opérateur persisté, domaine dérivé du
    //    tunnel CF ({slug}.mail.{zone}).
    assert.equal(process.env.EMAIL_INBOUND_SECRET, "inbound-secret-gate");
    assert.equal(process.env.EMAIL_DOMAIN, "probe.mail.gate.test");
  } finally {
    await handle?.close();
    cf.restore();
    restoreEnv(saved);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("HPP2 ordre harness + Dockerfile cloudflared + template factory", () => {
  const harness = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/start-brand-kernel-harness.ts"),
    "utf8",
  );
  const listenAt = harness.indexOf("listenBrandOsHttp({");
  const importAt = harness.indexOf("runHarnessCatalogImportPhase({");
  const warmAt = harness.indexOf("warmBrandNativeHosts(brandOs");
  const bridgeAt = harness.indexOf("runHarnessHermesBridgePhase({");
  assert.ok(listenAt > 0 && importAt > 0 && warmAt > 0 && bridgeAt > 0);
  assert.ok(
    listenAt < importAt,
    "import catalogue APRÈS le listen HTTP (METIER_BASE_URL posé)",
  );
  assert.ok(
    warmAt < bridgeAt,
    "bridge Hermes APRÈS le warm des hosts natifs",
  );
  assert.match(harness, /n8nPublicBaseUrl/, "warm n8n reçoit l'URL publique");
  assert.match(harness, /runHarnessTunnelPhase/, "phase tunnel câblée");
  assert.match(harness, /runHarnessFleetPhase/, "phase fleet câblée");
  assert.match(harness, /runHarnessPluginsPhase/, "phase plugins câblée");

  const dockerfile = fs.readFileSync(
    path.join(ROOT, "docker/server/Dockerfile"),
    "utf8",
  );
  assert.match(dockerfile, /AS cloudflared/, "stage cloudflared dans l'image");
  assert.match(
    dockerfile,
    /CREEZIO_CLOUDFLARED_BINARY=\/opt\/creezio\/bin\/cloudflared/,
    "binaire cloudflared exposé via env générique",
  );
  assert.match(
    dockerfile,
    /ARG CLOUDFLARED_VERSION=\d{4}\.\d+\.\d+/,
    "version cloudflared pinnée via ARG (plus de releases/latest)",
  );
  assert.doesNotMatch(
    dockerfile,
    /releases\/latest\/download/,
    "aucune URL de téléchargement latest",
  );

  // Kit-first : le template factory du harness embarque les mêmes décisions
  // (défauts catalogue + modules optionnels) pour TOUTE app générée.
  const template = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/generators/native-runtime.ts"),
    "utf8",
  );
  assert.match(template, /applyBrandCatalogEnvDefaults/);
  assert.match(template, /importOptional\("catalog-sync\.js"\)/);
  assert.match(template, /importOptional\("brand-mcp-tools\.js"\)/);
  assert.match(template, /importOptional\("brand-platform-bindings\.js"\)/);
  const bare = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/scaffold.ts"),
    "utf8",
  );
  assert.match(bare, /applyBrandCatalogEnvDefaults/);

  // cloudflaredBinary honore l'override générique kit (image Docker).
  const tunnel = fs.readFileSync(
    path.join(ROOT, "packages/host-runtime/src/tunnel/tunnel.ts"),
    "utf8",
  );
  assert.match(tunnel, /CREEZIO_CLOUDFLARED_BINARY/);
});

test("HPP3 applyBrandCatalogEnvDefaults : léger par défaut, opt-in prod", () => {
  const saved = {
    CREEZIO_CATALOG: process.env.CREEZIO_CATALOG,
    HPPX_CATALOG_DISABLE: process.env.HPPX_CATALOG_DISABLE,
    HPPX_CATALOG_ENABLE: process.env.HPPX_CATALOG_ENABLE,
    HPPX_CATALOG_LOCAL_PATH: process.env.HPPX_CATALOG_LOCAL_PATH,
  };
  try {
    for (const k of Object.keys(saved)) delete process.env[k];

    applyBrandCatalogEnvDefaults("HPPX");
    assert.equal(
      process.env.HPPX_CATALOG_DISABLE,
      "1",
      "tests/CI : catalogue désactivé par défaut",
    );

    delete process.env.HPPX_CATALOG_DISABLE;
    process.env.CREEZIO_CATALOG = "1";
    applyBrandCatalogEnvDefaults("HPPX");
    assert.equal(
      process.env.HPPX_CATALOG_DISABLE,
      undefined,
      "CREEZIO_CATALOG=1 (Docker prod) : catalogue activé",
    );

    delete process.env.CREEZIO_CATALOG;
    process.env.HPPX_CATALOG_LOCAL_PATH = "/tmp/x.db";
    applyBrandCatalogEnvDefaults("HPPX");
    assert.equal(
      process.env.HPPX_CATALOG_DISABLE,
      undefined,
      "seed local explicite : pas de désactivation",
    );

    delete process.env.HPPX_CATALOG_LOCAL_PATH;
    process.env.HPPX_CATALOG_ENABLE = "1";
    applyBrandCatalogEnvDefaults("HPPX");
    assert.equal(process.env.HPPX_CATALOG_DISABLE, undefined);

    delete process.env.HPPX_CATALOG_ENABLE;
    process.env.HPPX_CATALOG_DISABLE = "0";
    applyBrandCatalogEnvDefaults("HPPX");
    assert.equal(
      process.env.HPPX_CATALOG_DISABLE,
      "0",
      "DISABLE=0 explicite respecté",
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("HPP4 sonde publique tunnel : retry/backoff, succès réel, échec honnêt", async () => {
  // Stub HTTP : 502 ×2 puis 200 — la sonde doit retenter puis conclure OK.
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits += 1;
    res.statusCode = hits >= 3 ? 200 : 502;
    res.end("{}");
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const stubPort = srv.address().port;
  try {
    const ok = await probeTunnelPublicUrl(`http://127.0.0.1:${stubPort}`, {
      budgetMs: 15_000,
      requestTimeoutMs: 1_000,
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.attempts, 3, "2 × 502 puis 200 → 3 sondes");
  } finally {
    srv.closeAllConnections?.();
    await new Promise((resolve) => srv.close(resolve));
  }

  // Cible injoignable : échec explicite après budget — jamais de faux done.
  const ko = await probeTunnelPublicUrl("http://127.0.0.1:1", {
    budgetMs: 2_500,
    requestTimeoutMs: 300,
  });
  assert.equal(ko.ok, false, JSON.stringify(ko));
  assert.ok(ko.attempts >= 1 && ko.lastError, "échec tracé");

  // Câblage 0.10.0 : la phase tunnel est pilotée par le contrat CF
  // (CREEZIO_CF_API_TOKEN — auto-provisioning direct par l'instance),
  // cloudflared in-process, sonde publique en arrière-plan non fatale.
  // Plus AUCUNE trace du sidecar ni du provisioner VPS.
  const phases = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/harness-server-phases.ts"),
    "utf8",
  );
  assert.match(phases, /harnessTunnelProvisionRequested/, "détection contrat CF");
  assert.match(phases, /CREEZIO_CF_API_TOKEN/, "phase pilotée par cf.env");
  assert.match(phases, /probeTunnelPublicUrl/, "sonde publique câblée");
  assert.match(
    phases,
    /arrière-plan/,
    "sonde publique en arrière-plan (non fatale)",
  );
  assert.doesNotMatch(phases, /harnessTunnelSidecarMode/, "sidecar supprimé");
  assert.doesNotMatch(phases, /CREEZIO_TUNNEL_SIDECAR/, "env sidecar supprimé");
  assert.doesNotMatch(
    phases,
    /TUNNEL_PROVISION_URL/,
    "provisioner VPS supprimé",
  );
});
