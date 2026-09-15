#!/usr/bin/env node
/**
 * Gate — exposition du registre Docker en pull authentifié (F4).
 *
 * Prouve, avec un VRAI serveur admin (spawn server-admin.mjs) devant un mock
 * de registre Docker v2 :
 *  1. client CF (platform-core) : slug `registry` réservé par défaut,
 *     réservable UNIQUEMENT en kind=registry (zone-level : un seul ingress,
 *     pas d'embeds/wildcard) ;
 *  2. proxy /v2/* : pull anonyme → 401 (WWW-Authenticate Basic) ; pull
 *     authentifié Basic hostId:agentToken (credential flotte existant,
 *     fleet-hosts.json) → proxifié au registre amont (handshake /v2/,
 *     manifest, HEAD) ; Basic admin accepté ; mauvais token → 401 ;
 *  3. push via l'ingress → 405 quel que soit le credential (POST/PUT/PATCH/
 *     DELETE) — le registre amont ne voit JAMAIS la requête ;
 *  4. publish : `--public-host` (env CREEZIO_REGISTRY_PUBLIC_HOST) tague la
 *     référence publique registry.{zone}/… (anti-régression source).
 *
 * NOTE tunnel réel : la réservation registry.{zone} exige l'API Cloudflare —
 * hors gate. Preuve manuelle documentée dans docker/server/README.md.
 */
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLLECTOR = path.join(
  ROOT,
  "packages/observability/fleet-collector",
);

const { slugCheckLocal, isZoneLevelKind, buildTunnelIngressRules } =
  await import(
    path.join(COLLECTOR, "../../platform-core/dist/tunnel-cf.js")
  );
// SoT @creezio/fleet (wrappers fleet-collector retirés en 0.19) — dist requis.
const FLEET_DIST = path.join(ROOT, "packages/fleet/dist");
const {
  isPullMethod,
  isRegistryPath,
  registryPullAuthDecision,
} = await import(path.join(FLEET_DIST, "registry-pull-proxy.js"));

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

test("tunnel CF : slug registry réservé sauf kind=registry (zone-level)", () => {
  assert.equal(slugCheckLocal("registry").available, false, "réservé par défaut");
  assert.equal(
    slugCheckLocal("registry", { kind: "server" }).available,
    false,
    "jamais pour un serveur client",
  );
  assert.equal(
    slugCheckLocal("registry", { kind: "registry" }).available,
    true,
    "réservable en kind=registry",
  );
  assert.equal(
    slugCheckLocal("autre-slug", { kind: "registry" }).available,
    false,
    "kind=registry limité au slug registry",
  );
  assert.equal(isZoneLevelKind("registry"), true);
  assert.equal(isZoneLevelKind("brand-web"), true);
  assert.equal(isZoneLevelKind("server"), false);
  // Zone-level : un seul ingress HTTP + fallback 404 (pas d'embeds).
  const rules = buildTunnelIngressRules(
    "registry.example.test",
    { crmPort: 18800, n8nPort: 1, hermesPort: 2 },
    { embeds: false },
  );
  assert.equal(rules.length, 2);
  assert.equal(rules[0].hostname, "registry.example.test");
  assert.equal(rules[0].service, "http://127.0.0.1:18800");
  assert.deepEqual(rules[1], { service: "http_status:404" });
});

test("proxy /v2 : décisions d'auth pures", () => {
  const hosts = [{ hostId: "vps-resto", agentToken: "tok-resto" }];
  const b = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  const ctx = { adminUser: "admin", adminPass: "pass", loadHosts: () => hosts };
  assert.equal(registryPullAuthDecision(undefined, ctx).ok, false);
  assert.equal(registryPullAuthDecision(b("vps-resto", "mauvais"), ctx).ok, false);
  assert.equal(registryPullAuthDecision(b("inconnu", "tok-resto"), ctx).ok, false);
  assert.deepEqual(registryPullAuthDecision(b("vps-resto", "tok-resto"), ctx), {
    ok: true,
    user: "vps-resto",
  });
  assert.deepEqual(registryPullAuthDecision(b("admin", "pass"), ctx), {
    ok: true,
    user: "admin",
  });
  assert.equal(isPullMethod("GET"), true);
  assert.equal(isPullMethod("HEAD"), true);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isPullMethod(m), false, `${m} n'est pas un pull`);
  }
  assert.equal(isRegistryPath("/v2/"), true);
  assert.equal(isRegistryPath("/v2/repo/manifests/1.0"), true);
  assert.equal(isRegistryPath("/admin/api/servers"), false);
});

test("proxy /v2 E2E : pull authentifié OK, anonyme 401, push 405", async () => {
  // Mock registre Docker v2 — journalise chaque requête reçue.
  const upstreamCalls = [];
  const upstream = http.createServer((req, res) => {
    upstreamCalls.push(`${req.method} ${req.url}`);
    if (req.url === "/v2/") {
      res.writeHead(200, {
        "content-type": "application/json",
        "docker-distribution-api-version": "registry/2.0",
      });
      res.end("{}");
      return;
    }
    if (req.url === "/v2/creezio-server-testbrand/manifests/0.4.0") {
      res.writeHead(200, {
        "content-type": "application/vnd.docker.distribution.manifest.v2+json",
        "docker-content-digest": "sha256:feedface",
      });
      res.end(req.method === "HEAD" ? "" : '{"schemaVersion":2}');
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"errors":[{"code":"NAME_UNKNOWN"}]}');
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const upstreamPort = upstream.address().port;

  // Fixture admin root : hôte enrôlé avec son agentToken (credential flotte).
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-registry-proxy-"));
  const BRAND_ROOT = path.join(TMP, "testbrand");
  fs.mkdirSync(path.join(BRAND_ROOT, "docker-data"), { recursive: true });
  fs.writeFileSync(
    path.join(BRAND_ROOT, "package.json"),
    JSON.stringify({ name: "@creezio/app-testbrand" }),
  );
  fs.writeFileSync(
    path.join(BRAND_ROOT, "docker-data", "servers.json"),
    JSON.stringify({ version: 1, brandId: "testbrand", image: "x", instances: [] }),
  );
  fs.writeFileSync(
    path.join(BRAND_ROOT, "docker-data", "fleet-hosts.json"),
    JSON.stringify({
      version: 1,
      hosts: [
        {
          hostId: "vps-resto",
          label: "resto",
          agentUrl: "https://agent.resto.example",
          agentToken: "tok-resto-secret",
          enrolledAt: "2026-08-01T00:00:00Z",
        },
      ],
      enrollTokens: [],
    }),
  );

  const ADMIN_PORT = await ephemeralPort();
  const child = spawn(
    process.execPath,
    [path.join(FLEET_DIST, "bin/server-admin-main.js")],
    {
      env: {
        ...process.env,
        CREEZIO_ADMIN_PORT: String(ADMIN_PORT),
        CREEZIO_ADMIN_HOST: "127.0.0.1",
        CREEZIO_ADMIN_USER: "admin",
        CREEZIO_ADMIN_PASS: "gate-admin-pass",
        CREEZIO_ADMIN_BRAND_ROOTS: BRAND_ROOT,
        CREEZIO_REGISTRY: `127.0.0.1:${upstreamPort}`,
        CREEZIO_DOCKER_SOCK: path.join(TMP, "nonexistent-docker.sock"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const call = (method, urlPath, headers = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { hostname: "127.0.0.1", port: ADMIN_PORT, path: urlPath, method, headers },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              raw: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    });

  try {
    // Readiness.
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        await call("GET", "/admin/api/health", {
          Authorization: "Basic " + Buffer.from("admin:gate-admin-pass").toString("base64"),
        });
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("admin pas prêt en 10s");
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    const HOST_BASIC =
      "Basic " + Buffer.from("vps-resto:tok-resto-secret").toString("base64");

    // Pull anonyme → 401 + WWW-Authenticate (handshake docker login).
    const anon = await call("GET", "/v2/");
    assert.equal(anon.status, 401);
    assert.match(
      String(anon.headers["www-authenticate"] || ""),
      /^Basic /,
      "WWW-Authenticate Basic (docker login)",
    );
    assert.equal(upstreamCalls.length, 0, "amont jamais touché sans auth");

    // Mauvais token → 401.
    const bad = await call("GET", "/v2/", {
      Authorization: "Basic " + Buffer.from("vps-resto:mauvais").toString("base64"),
    });
    assert.equal(bad.status, 401);

    // Pull authentifié credential flotte → proxifié (handshake + manifest).
    const shake = await call("GET", "/v2/", { Authorization: HOST_BASIC });
    assert.equal(shake.status, 200, shake.raw);
    const manifest = await call(
      "GET",
      "/v2/creezio-server-testbrand/manifests/0.4.0",
      { Authorization: HOST_BASIC },
    );
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers["docker-content-digest"], "sha256:feedface");
    assert.equal(manifest.raw, '{"schemaVersion":2}', "corps proxifié tel quel");
    const head = await call(
      "HEAD",
      "/v2/creezio-server-testbrand/manifests/0.4.0",
      { Authorization: HOST_BASIC },
    );
    assert.equal(head.status, 200, "HEAD (docker pull) autorisé");

    // Basic admin accepté aussi (debug opérateur).
    const adminPull = await call("GET", "/v2/", {
      Authorization: "Basic " + Buffer.from("admin:gate-admin-pass").toString("base64"),
    });
    assert.equal(adminPull.status, 200);

    // Push via l'ingress → 405, même avec un credential valide, et le
    // registre amont ne voit JAMAIS la requête.
    const before = upstreamCalls.length;
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await call(
        m,
        "/v2/creezio-server-testbrand/blobs/uploads/",
        { Authorization: HOST_BASIC },
      );
      assert.equal(r.status, 405, `${m} refusé (pull-only)`);
    }
    assert.equal(upstreamCalls.length, before, "aucun push transmis à l'amont");
  } finally {
    child.kill("SIGTERM");
    upstream.close();
  }
});

test("publish : --public-host tague la référence publique (anti-régression)", () => {
  const cli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.ok(cli.includes('"--public-host"'), "option CLI --public-host");
  assert.ok(
    cli.includes("CREEZIO_REGISTRY_PUBLIC_HOST"),
    "env CREEZIO_REGISTRY_PUBLIC_HOST",
  );
  assert.ok(
    /docker",\s*\["tag",\s*image,\s*publicImage\]/.test(cli),
    "docker tag <image> <publicImage> après push",
  );
});
