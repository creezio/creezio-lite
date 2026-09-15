#!/usr/bin/env node
/**
 * Gate — `creezio server-docker registry-gc` (dette T11).
 *
 * Toujours : fonctions pures + mock HTTP (pas de Docker requis).
 * Optionnel : registry:2 éphémère si le daemon Docker est dispo.
 * Skip live explicite (raison affichée), jamais silencieux.
 *
 * SoT : packages/factory/src/server-docker-registry-gc.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages/factory/dist/server-docker-registry-gc.js");
const CLI = path.join(ROOT, "packages/factory/src/server-docker-cli.ts");
const BIN = path.join(ROOT, "packages/factory/bin/creezio.js");

assert.ok(
  fs.existsSync(DIST),
  "packages/factory/dist/server-docker-registry-gc.js absent — npm run build -w @creezio/factory",
);

const gc = await import(new URL(`file://${DIST}`).href);

function mockRes(status, body = {}, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = Object.keys(headers).find(
          (k) => k.toLowerCase() === name.toLowerCase(),
        );
        return key ? headers[key] : null;
      },
    },
    json: async () => (typeof body === "string" ? JSON.parse(body || "{}") : body),
    text: async () => text,
  };
}

function createMemoryRegistry(initial, opts = {}) {
  const repos = structuredClone(initial);
  const deleted = [];
  const http = {
    down: false,
    deleteStatus: 202,
    /** null = pas d'app admin ; {status, body} = réponse GET releases. */
    adminReleases: opts.adminReleases ?? null,
    async request(url, init) {
      if (http.down) {
        throw new Error("registre injoignable (http://127.0.0.1:9/v2/) — ECONNREFUSED");
      }
      const u = new URL(url);
      const method = (init?.method || "GET").toUpperCase();
      if (u.pathname === "/api/v1/modules/fleet-releases/releases") {
        if (!http.adminReleases) return mockRes(503, { ok: false });
        return mockRes(http.adminReleases.status ?? 200, http.adminReleases.body);
      }
      if (u.pathname === "/v2/" && method === "GET") return mockRes(200, {});
      if (u.pathname === "/v2/_catalog") {
        return mockRes(200, { repositories: Object.keys(repos) });
      }
      const tags = /^\/v2\/(.+)\/tags\/list$/.exec(u.pathname);
      if (tags) {
        const repo = tags[1];
        const list = Object.keys(repos[repo] || {});
        return mockRes(200, { name: repo, tags: list });
      }
      const man = /^\/v2\/(.+)\/manifests\/(.+)$/.exec(u.pathname);
      if (man) {
        const [, repo, ref] = man;
        const table = repos[repo] || {};
        if (method === "HEAD" || method === "GET") {
          const digest = table[ref] || (ref.startsWith("sha256:") ? ref : "");
          if (!digest || (ref.startsWith("sha256:") && !Object.values(table).includes(ref))) {
            if (!table[ref] && !Object.values(table).includes(ref)) {
              return mockRes(404, { errors: [{ code: "MANIFEST_UNKNOWN" }] });
            }
          }
          const resolved = table[ref] || ref;
          return mockRes(200, {}, { "Docker-Content-Digest": resolved });
        }
        if (method === "DELETE") {
          if (http.deleteStatus >= 400) {
            return mockRes(http.deleteStatus, { errors: [{ code: "DENIED" }] });
          }
          for (const [tag, digest] of Object.entries(table)) {
            if (digest === ref || tag === ref) delete table[tag];
          }
          deleted.push({ repo, ref });
          return mockRes(http.deleteStatus, {});
        }
      }
      return mockRes(404, {});
    },
  };
  return { repos, deleted, http };
}

function createMockDocker(opts = {}) {
  const state = {
    available: opts.available !== false,
    inUse: opts.inUse || [],
    running: opts.running !== false,
    gcStatus: opts.gcStatus ?? 0,
    gcCalls: 0,
  };
  return {
    state,
    available: () => state.available,
    listInUseImages: () => state.inUse,
    containerRunning: () => state.running,
    garbageCollect() {
      state.gcCalls += 1;
      return {
        status: state.gcStatus,
        stdout: state.gcStatus === 0 ? "blob eligible for deletion\n" : "",
        stderr: state.gcStatus === 0 ? "" : "gc failed",
      };
    },
  };
}

test("CLI help + dispatch registry-gc (source)", () => {
  const src = fs.readFileSync(CLI, "utf8");
  assert.match(src, /registry-gc/);
  assert.match(src, /runRegistryGcCommand/);
  assert.match(src, /--apply/);
  assert.match(src, /CREEZIO_REGISTRY_GC_KEEP/);
  const help = spawnSync(process.execPath, [BIN, "server-docker", "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /registry-gc/);
  assert.match(help.stdout, /--apply/);
  assert.match(help.stdout, /DRY-RUN PAR DÉFAUT/);
  assert.match(help.stdout, /garbage-collect/);
  assert.match(help.stdout, /servers\.json/);
});

test("parseImageRef + collectInUseKeys", () => {
  const a = gc.parseImageRef("127.0.0.1:5000/creezio-server-probe:0.2.1");
  assert.deepEqual(a, {
    host: "127.0.0.1:5000",
    repo: "creezio-server-probe",
    tag: "0.2.1",
    digest: undefined,
  });
  const b = gc.parseImageRef(
    "localhost:5000/library/alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(b.repo, "library/alpine");
  assert.equal(b.digest.startsWith("sha256:"), true);
  assert.equal(gc.parseImageRef("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").digest.startsWith("sha256:"), true);
  const keys = gc.collectInUseKeys([
    { ref: "127.0.0.1:5000/creezio-server-probe:0.1.0" },
    {
      ref: "127.0.0.1:5000/creezio-server-probe@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  ]);
  assert.ok(keys.tags.has("creezio-server-probe:0.1.0"));
  assert.ok(
    keys.digests.has(
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ),
  );
});

test("compareVersionTags + selectTagsToPrune + planRepoGc", () => {
  assert.ok(gc.compareVersionTags("0.3.9", "0.3.10") < 0);
  // 3 semver + keep=2 → plancher semver=3 : rien à purger.
  assert.deepEqual(gc.selectTagsToPrune(["0.1.0", "0.3.0", "0.2.0"], 2), []);
  assert.deepEqual(gc.selectTagsToPrune(["0.1.0"], 2), []);
  assert.deepEqual(
    gc.selectTagsToPrune(["0.1.0", "0.2.0", "0.3.0", "0.4.0"], 2),
    ["0.1.0"],
  );
  assert.equal(gc.REGISTRY_GC_KEEP_DEFAULT, 2);
  assert.equal(gc.REGISTRY_SEMVER_KEEP_MIN, 3);
  assert.equal(gc.resolveSemverKeep(2), 3);
  assert.equal(gc.resolveSemverKeep(5), 5);
  assert.equal(gc.resolveRegistryGcKeep({}), 2);
  assert.equal(gc.resolveRegistryGcKeep({ keepTags: 5 }), 5);
  assert.equal(
    gc.resolveRegistryGcKeep({}, { CREEZIO_REGISTRY_GC_KEEP: "3" }),
    3,
  );

  const plan = gc.planRepoGc({
    repo: "creezio-server-probe",
    tags: [
      { tag: "0.1.0", digest: "sha256:1" },
      { tag: "0.2.0", digest: "sha256:2" },
      { tag: "0.3.0", digest: "sha256:3" },
      { tag: "0.4.0", digest: "sha256:4" },
      { tag: "0.5.0", digest: "sha256:5" },
    ],
    keep: 2,
    inUseTags: new Set(["creezio-server-probe:0.1.0"]),
    inUseDigests: new Set(),
  });
  const kept = plan.keep.map((k) => `${k.tag}:${k.reason}`).sort();
  // semver keep=3 (0.3/0.4/0.5) + in-use 0.1.0 ; 0.2.0 hors fenêtre.
  assert.deepEqual(kept, [
    "0.1.0:in-use",
    "0.3.0:recent",
    "0.4.0:recent",
    "0.5.0:recent",
  ]);
  assert.deepEqual(
    plan.delete.map((d) => d.tag),
    ["0.2.0"],
  );

  const shared = gc.planRepoGc({
    repo: "creezio-server-probe",
    tags: [
      { tag: "0.1.0", digest: "sha256:same" },
      { tag: "0.2.0", digest: "sha256:2" },
      { tag: "0.3.0", digest: "sha256:3" },
      { tag: "0.4.0", digest: "sha256:4" },
      { tag: "0.5.0", digest: "sha256:5" },
      { tag: "latest", digest: "sha256:same" },
    ],
    keep: 1,
    inUseTags: new Set(),
    inUseDigests: new Set(),
  });
  assert.ok(shared.keep.some((k) => k.tag === "latest"));
  assert.ok(shared.skipShared.some((s) => s.tag === "0.1.0"));
  assert.deepEqual(
    shared.delete.map((d) => d.tag).sort(),
    ["0.2.0"],
  );

  assert.throws(
    () =>
      gc.planRepoGc({
        repo: "x",
        tags: [],
        keep: 0,
        inUseTags: new Set(),
        inUseDigests: new Set(),
      }),
    /--keep invalide/,
  );
});

test("rétention par famille : auto.* et tags manuels indépendants", () => {
  const plan = gc.planRepoGc({
    repo: "creezio-server-probe",
    tags: [
      { tag: "0.1.0", digest: "sha256:m1" },
      { tag: "0.2.0", digest: "sha256:m2" },
      { tag: "0.3.0", digest: "sha256:m3" },
      { tag: "auto.202601010000.aaa", digest: "sha256:a1" },
      { tag: "auto.202601020000.bbb", digest: "sha256:a2" },
      { tag: "auto.202601030000.ccc", digest: "sha256:a3" },
    ],
    keep: 2,
    inUseTags: new Set(),
    inUseDigests: new Set(),
  });
  const kept = plan.keep.map((k) => k.tag).sort();
  // semver keep=3 : les 3 manuels restent ; auto keep=2 : plus vieux auto purgé.
  assert.deepEqual(kept, [
    "0.1.0",
    "0.2.0",
    "0.3.0",
    "auto.202601020000.bbb",
    "auto.202601030000.ccc",
  ]);
  assert.deepEqual(
    plan.delete.map((d) => d.tag).sort(),
    ["auto.202601010000.aaa"],
    "une rafale auto.* n'évince jamais la fenêtre des tags manuels (et vice versa)",
  );
});

test("publish/GC keep=2 + 4 semver + auto.* → ≥ 3 semver, jamais le tag in-use", () => {
  const tags = [
    { tag: "0.21.0", digest: "sha256:s21" },
    { tag: "0.22.0", digest: "sha256:s22" },
    { tag: "0.23.0", digest: "sha256:s23" },
    { tag: "0.24.0", digest: "sha256:s24" },
    { tag: "auto.202608010000.aaa", digest: "sha256:a1" },
    { tag: "auto.202608020000.bbb", digest: "sha256:a2" },
    { tag: "auto.202608030000.ccc", digest: "sha256:a3" },
    { tag: "auto.202608040000.ddd", digest: "sha256:a4" },
  ];
  const plan = gc.planRepoGc({
    repo: "creezio-server-probe",
    tags,
    keep: 2,
    inUseTags: new Set(["creezio-server-probe:0.21.0"]),
    inUseDigests: new Set(),
  });
  const keptSemver = plan.keep
    .map((k) => k.tag)
    .filter((t) => gc.registryTagFamily(t) === "semver");
  assert.ok(
    keptSemver.length >= 3,
    `au moins 3 semver restants (reçu ${keptSemver.join(",")})`,
  );
  assert.ok(
    plan.keep.some((k) => k.tag === "0.21.0" && k.reason === "in-use"),
    "tag in-use jamais évincé",
  );
  assert.ok(
    !plan.delete.some((d) => d.tag === "0.21.0"),
    "DELETE ne contient pas le tag in-use",
  );
  assert.ok(
    plan.delete.every((d) => gc.registryTagFamily(d.tag) === "auto"),
    "seuls des auto.* hors fenêtre sont purgés — aucun semver évincé par la rafale",
  );

  // Chemin publish : selectTagsToPrune + protect (servers.json / just-pushed).
  const names = tags.map((t) => t.tag);
  const pruned = gc.selectTagsToPrune(names, 2, ["0.21.0"]);
  const remaining = names.filter((t) => !pruned.includes(t));
  const remainingSemver = remaining.filter(
    (t) => gc.registryTagFamily(t) === "semver",
  );
  assert.ok(remainingSemver.length >= 3, "publish : ≥ 3 semver restants");
  assert.ok(!pruned.includes("0.21.0"), "publish : tag protégé jamais évincé");
  assert.ok(
    pruned.every((t) => gc.registryTagFamily(t) === "auto"),
    "publish : une rafale auto.* n'évince aucun semver",
  );
});

test("tags référencés (servers.json / release fleet) : reason=referenced, jamais supprimés", () => {
  const plan = gc.planRepoGc({
    repo: "creezio-server-probe",
    tags: [
      { tag: "0.1.0", digest: "sha256:1" },
      { tag: "0.2.0", digest: "sha256:2" },
      { tag: "0.3.0", digest: "sha256:3" },
      { tag: "0.4.0", digest: "sha256:4" },
      { tag: "0.5.0", digest: "sha256:5" },
      { tag: "0.6.0", digest: "sha256:6" },
    ],
    keep: 1,
    inUseTags: new Set(),
    inUseDigests: new Set(),
    referencedTags: new Set(["creezio-server-probe:0.1.0"]),
    referencedDigests: new Set(["sha256:2"]),
  });
  const byTag = Object.fromEntries(plan.keep.map((k) => [k.tag, k.reason]));
  assert.equal(byTag["0.1.0"], "referenced");
  assert.equal(byTag["0.2.0"], "referenced");
  assert.equal(byTag["0.6.0"], "recent");
  assert.deepEqual(
    plan.delete.map((d) => d.tag),
    ["0.3.0"],
  );
});

test("serversFileImageRefs : refs, absent → null, JSON invalide → fail-closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gc-servers-"));
  try {
    const file = path.join(dir, "servers.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        brandId: "probe",
        image: "127.0.0.1:5000/creezio-server-probe:0.1.0",
        instances: [
          { name: "a", image: "127.0.0.1:5000/creezio-server-probe:0.2.0" },
          { name: "b" },
        ],
      }),
    );
    assert.deepEqual(gc.serversFileImageRefs(file), [
      "127.0.0.1:5000/creezio-server-probe:0.1.0",
      "127.0.0.1:5000/creezio-server-probe:0.2.0",
    ]);
    assert.equal(gc.serversFileImageRefs(path.join(dir, "absent.json")), null);
    const broken = path.join(dir, "broken.json");
    fs.writeFileSync(broken, "{pas du json");
    assert.throws(() => gc.serversFileImageRefs(broken), /servers\.json illisible.*fail-closed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("collectReleaseKeys + fetchFleetReleaseRefs (mock admin)", async () => {
  const keys = gc.collectReleaseKeys([
    {
      brandId: "probe",
      tag: "0.9.0",
      image: "registry.example.com/creezio-server-probe:0.9.0",
      digest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      variant: "base",
      status: "rolling",
    },
    { brandId: "probe", tag: "0.8.0", variant: "browser" },
  ]);
  assert.ok(keys.tags.has("creezio-server-probe:0.9.0"));
  assert.ok(keys.tags.has("creezio-server-probe-browser:0.8.0"));
  assert.ok(
    keys.digests.has(
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    ),
  );

  const mem = createMemoryRegistry(
    {},
    {
      adminReleases: {
        status: 200,
        body: {
          ok: true,
          releases: [
            {
              brand_id: "probe",
              tag: "0.9.0",
              image: "registry.example.com/creezio-server-probe:0.9.0",
              digest: null,
              variant: "base",
              status: "draft",
            },
          ],
        },
      },
    },
  );
  const releases = await gc.fetchFleetReleaseRefs(mem.http, "http://admin.local/");
  assert.equal(releases.length, 1);
  assert.equal(releases[0].brandId, "probe");
  assert.equal(releases[0].tag, "0.9.0");

  const ko = createMemoryRegistry({}, { adminReleases: { status: 500, body: {} } });
  await assert.rejects(
    () => gc.fetchFleetReleaseRefs(ko.http, "http://admin.local"),
    /releases fleet illisibles.*fail-closed/,
  );
  const invalid = createMemoryRegistry(
    {},
    { adminReleases: { status: 200, body: { nope: 1 } } },
  );
  await assert.rejects(
    () => gc.fetchFleetReleaseRefs(invalid.http, "http://admin.local"),
    /réponse invalide.*fail-closed/,
  );
});

test("mock HTTP : dry-run ne mute pas + garde le tag en usage", async () => {
  const mem = createMemoryRegistry({
    "creezio-server-probe": {
      "0.1.0": "sha256:aaa",
      "0.2.0": "sha256:bbb",
      "0.3.0": "sha256:ccc",
      "0.4.0": "sha256:ddd",
    },
  });
  const docker = createMockDocker({
    inUse: [{ ref: "127.0.0.1:5000/creezio-server-probe:0.1.0" }],
  });
  const logs = [];
  const dry = await gc.runRegistryGc({
    registry: "127.0.0.1:5000",
    keep: 2,
    dryRun: true,
    container: "creezio-registry",
    http: mem.http,
    docker,
    log: (l) => logs.push(l),
  });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.gcRan, false);
  assert.equal(docker.state.gcCalls, 0);
  assert.equal(mem.deleted.length, 0);
  assert.ok(dry.kept.some((k) => k.tag === "0.1.0" && k.reason === "in-use"));
  assert.ok(logs.some((l) => /\[dry-run\]/.test(l)));
  assert.equal(
    Object.keys(mem.repos["creezio-server-probe"]).length,
    4,
    "dry-run ne supprime aucun tag",
  );
});

test("mock HTTP : DELETE hors rétention + GC, jamais le tag en usage", async () => {
  const mem = createMemoryRegistry({
    "creezio-server-probe": {
      "0.1.0": "sha256:aaa",
      "0.2.0": "sha256:bbb",
      "0.3.0": "sha256:ccc",
      "0.4.0": "sha256:ddd",
      "0.5.0": "sha256:eee",
    },
  });
  const docker = createMockDocker({
    inUse: [{ ref: "127.0.0.1:5000/creezio-server-probe:0.1.0" }],
  });
  const out = await gc.runRegistryGc({
    registry: "127.0.0.1:5000",
    keep: 2,
    dryRun: false,
    container: "creezio-registry",
    http: mem.http,
    docker,
    log: () => {},
  });
  assert.equal(out.gcRan, true);
  assert.equal(docker.state.gcCalls, 1);
  assert.deepEqual(
    out.deleted.map((d) => d.tag).sort(),
    ["0.2.0"],
  );
  assert.ok(!out.deleted.some((d) => d.tag === "0.1.0"));
  assert.deepEqual(
    Object.keys(mem.repos["creezio-server-probe"]).sort(),
    ["0.1.0", "0.3.0", "0.4.0", "0.5.0"],
  );
});

test("protection servers.json + releases fleet dans runRegistryGc", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gc-protect-"));
  try {
    const serversFile = path.join(dir, "docker-data", "servers.json");
    fs.mkdirSync(path.dirname(serversFile), { recursive: true });
    fs.writeFileSync(
      serversFile,
      JSON.stringify({
        version: 1,
        brandId: "probe",
        image: "creezio-server-probe:local",
        instances: [
          // Instance ARRÊTÉE (pas dans docker ps) : son tag reste protégé.
          { name: "stopped", image: "127.0.0.1:5000/creezio-server-probe:0.1.0" },
        ],
      }),
    );
    const mem = createMemoryRegistry(
      {
        "creezio-server-probe": {
          "0.1.0": "sha256:aaa",
          "0.2.0": "sha256:bbb",
          "0.3.0": "sha256:ccc",
          "0.4.0": "sha256:ddd",
          "0.5.0": "sha256:eee",
          "0.6.0": "sha256:fff",
          "0.7.0": "sha256:ggg",
        },
      },
      {
        adminReleases: {
          status: 200,
          body: {
            ok: true,
            releases: [
              {
                brand_id: "probe",
                tag: "0.2.0",
                image: "registry.example.com/creezio-server-probe:0.2.0",
                status: "rolling",
                variant: "base",
              },
            ],
          },
        },
      },
    );
    const out = await gc.runRegistryGc({
      registry: "127.0.0.1:5000",
      keep: 1,
      dryRun: false,
      container: "creezio-registry",
      serversFiles: [serversFile, path.join(dir, "absent", "servers.json")],
      adminApp: "http://admin.local",
      http: mem.http,
      docker: createMockDocker(),
      log: () => {},
    });
    const reasons = Object.fromEntries(out.kept.map((k) => [k.tag, k.reason]));
    assert.equal(reasons["0.1.0"], "referenced", "tag servers.json (instance arrêtée)");
    assert.equal(reasons["0.2.0"], "referenced", "tag release fleet");
    assert.equal(reasons["0.7.0"], "recent");
    assert.deepEqual(
      out.deleted.map((d) => d.tag).sort(),
      ["0.3.0", "0.4.0"],
    );
    assert.deepEqual(
      Object.keys(mem.repos["creezio-server-probe"]).sort(),
      ["0.1.0", "0.2.0", "0.5.0", "0.6.0", "0.7.0"],
    );

    // Admin posée mais injoignable → refus fail-closed AVANT toute mutation.
    const memKo = createMemoryRegistry({
      "creezio-server-probe": { "0.1.0": "sha256:aaa", "0.2.0": "sha256:bbb" },
    });
    await assert.rejects(
      () =>
        gc.runRegistryGc({
          registry: "127.0.0.1:5000",
          keep: 1,
          dryRun: false,
          container: "creezio-registry",
          adminApp: "http://admin.local",
          http: memKo.http,
          docker: createMockDocker(),
          log: () => {},
        }),
      /releases fleet illisibles.*fail-closed/,
    );
    assert.equal(memKo.deleted.length, 0, "aucune mutation quand l'admin est injoignable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runRegistryGcCommand : dry-run PAR DÉFAUT, --apply exécute, conflit --apply/--dry-run", async () => {
  const initial = {
    "creezio-server-probe": {
      "0.1.0": "sha256:aaa",
      "0.2.0": "sha256:bbb",
      "0.3.0": "sha256:ccc",
      "0.4.0": "sha256:ddd",
    },
  };
  const env = { CREEZIO_REGISTRY: "127.0.0.1:5000", CREEZIO_FLEET_ADMIN_URL: "" };

  const mem = createMemoryRegistry(initial);
  const dockerDry = createMockDocker();
  const dry = await gc.runRegistryGcCommand(
    { keepTags: 2 },
    env,
    { http: mem.http, docker: dockerDry, log: () => {} },
  );
  assert.equal(dry.dryRun, true, "sans --apply : dry-run");
  assert.equal(dry.gcRan, false);
  assert.equal(dockerDry.state.gcCalls, 0);
  assert.equal(mem.deleted.length, 0, "défaut = zéro mutation");

  const mem2 = createMemoryRegistry(initial);
  const dockerApply = createMockDocker();
  const applied = await gc.runRegistryGcCommand(
    { keepTags: 2, apply: true },
    env,
    { http: mem2.http, docker: dockerApply, log: () => {} },
  );
  assert.equal(applied.dryRun, false);
  assert.equal(applied.gcRan, true);
  assert.equal(dockerApply.state.gcCalls, 1);
  assert.deepEqual(
    applied.deleted.map((d) => d.tag).sort(),
    ["0.1.0"],
    "keep=2 → semver keep=3 : seul le plus vieux des 4 semver est purgé",
  );

  await assert.rejects(
    () =>
      gc.runRegistryGcCommand({ apply: true, dryRun: true }, env, {
        http: createMemoryRegistry(initial).http,
        docker: createMockDocker(),
        log: () => {},
      }),
    /--apply et --dry-run sont exclusifs/,
  );
});

test("fail-closed : docker absent / registre down / DELETE KO / GC KO", async () => {
  const base = {
    registry: "127.0.0.1:5000",
    keep: 2,
    dryRun: false,
    container: "creezio-registry",
    log: () => {},
  };

  await assert.rejects(
    () =>
      gc.runRegistryGc({
        ...base,
        http: createMemoryRegistry({ x: { "0.1.0": "sha256:1" } }).http,
        docker: createMockDocker({ available: false }),
      }),
    /docker introuvable/,
  );

  const down = createMemoryRegistry({ x: { "0.1.0": "sha256:1" } });
  down.http.down = true;
  await assert.rejects(
    () =>
      gc.runRegistryGc({
        ...base,
        http: down.http,
        docker: createMockDocker(),
      }),
    /registre injoignable/,
  );

  const denied = createMemoryRegistry({
    "creezio-server-probe": {
      "0.1.0": "sha256:aaa",
      "0.2.0": "sha256:bbb",
      "0.3.0": "sha256:ccc",
      "0.4.0": "sha256:ddd",
    },
  });
  denied.http.deleteStatus = 405;
  const dockerDenied = createMockDocker();
  await assert.rejects(
    () =>
      gc.runRegistryGc({
        ...base,
        http: denied.http,
        docker: dockerDenied,
      }),
    /DELETE manifeste KO|REGISTRY_STORAGE_DELETE_ENABLED/,
  );
  assert.equal(dockerDenied.state.gcCalls, 0, "pas de GC après DELETE KO");

  const gcKo = createMemoryRegistry({
    "creezio-server-probe": {
      "0.1.0": "sha256:aaa",
      "0.2.0": "sha256:bbb",
      "0.3.0": "sha256:ccc",
      "0.4.0": "sha256:ddd",
    },
  });
  await assert.rejects(
    () =>
      gc.runRegistryGc({
        ...base,
        http: gcKo.http,
        docker: createMockDocker({ gcStatus: 1 }),
      }),
    /garbage-collect KO/,
  );

  const stopped = createMemoryRegistry({
    "creezio-server-probe": {
      "0.1.0": "sha256:aaa",
      "0.2.0": "sha256:bbb",
      "0.3.0": "sha256:ccc",
      "0.4.0": "sha256:ddd",
    },
  });
  await assert.rejects(
    () =>
      gc.runRegistryGc({
        ...base,
        http: stopped.http,
        docker: createMockDocker({ running: false }),
      }),
    /absent ou arrêté/,
  );
});

function dockerLiveSkipReason() {
  const ver = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (ver.status !== 0) {
    return "docker CLI indisponible — mock HTTP uniquement";
  }
  const info = spawnSync("docker", ["info"], {
    encoding: "utf8",
    timeout: 8000,
  });
  if (info.status !== 0) {
    return "daemon Docker injoignable — mock HTTP uniquement";
  }
  return null;
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitHttpOk(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve(res.statusCode);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout ${url} HTTP ${res.statusCode}`));
          return;
        }
        setTimeout(tryOnce, 200);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout ${url} (connexion)`));
          return;
        }
        setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

const liveSkip = dockerLiveSkipReason();
if (liveSkip) {
  console.log(`skip live registry:2 : ${liveSkip}`);
}

test(
  "live registry:2 éphémère : keep + dry-run + delete",
  { skip: liveSkip || false, timeout: 120_000 },
  async () => {
    const port = await freePort();
    assert.ok(port !== 18791 && port !== 18792, "port éphémère (pas 18791/18792)");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-registry-gc-"));
    const name = `creezio-gc-gate-${process.pid}-${port}`;
    const usedName = `${name}-used`;
    const repo = "creezio-gc-probe";
    const registry = `127.0.0.1:${port}`;
    let started = false;
    try {
      const run = spawnSync(
        "docker",
        [
          "run",
          "-d",
          "--name",
          name,
          "-p",
          `127.0.0.1:${port}:5000`,
          "-e",
          "REGISTRY_STORAGE_DELETE_ENABLED=true",
          "-v",
          `${dataDir}:/var/lib/registry`,
          "registry:2",
        ],
        { encoding: "utf8" },
      );
      if (run.status !== 0) {
        const why = (run.stderr || run.stdout || "").trim();
        console.log(
          `skip live registry:2 : impossible de démarrer registry:2 (${why || "docker run KO"})`,
        );
        return;
      }
      started = true;
      await waitHttpOk(`http://${registry}/v2/`, 30_000);

      // Chaque version doit avoir son PROPRE digest (comme un vrai publish) :
      // retagger la même image donnerait un digest partagé par les 4 tags,
      // que le GC refuse — à juste titre — de supprimer (skipShared).
      const srcImage = "registry:2";
      for (const tag of ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]) {
        const ref = `${registry}/${repo}:${tag}`;
        const build = spawnSync("docker", ["build", "-q", "-t", ref, "-"], {
          input: `FROM ${srcImage}\nLABEL creezio.gc.probe="${tag}"\n`,
          encoding: "utf8",
        });
        assert.equal(build.status, 0, build.stderr || build.stdout);
        const push = spawnSync("docker", ["push", ref], { encoding: "utf8" });
        assert.equal(push.status, 0, push.stderr || push.stdout);
      }

      const usedRef = `${registry}/${repo}:0.1.0`;
      const used = spawnSync(
        "docker",
        ["run", "-d", "--name", usedName, "--entrypoint", "sleep", usedRef, "120"],
        { encoding: "utf8" },
      );
      const usedOk = used.status === 0;

      const dry = await gc.runRegistryGc({
        registry,
        keep: 2,
        dryRun: true,
        container: name,
        repo,
        log: () => {},
      });
      assert.equal(dry.dryRun, true);
      assert.equal(dry.gcRan, false);
      const listedDry = await fetch(`http://${registry}/v2/${repo}/tags/list`);
      const dryTags = ((await listedDry.json()).tags || []).sort();
      assert.deepEqual(dryTags, ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]);

      const out = await gc.runRegistryGc({
        registry,
        keep: 2,
        dryRun: false,
        container: name,
        repo,
        log: () => {},
      });
      assert.equal(out.gcRan, true);
      const listed = await fetch(`http://${registry}/v2/${repo}/tags/list`);
      const left = ((await listed.json()).tags || []).sort();
      assert.ok(left.includes("0.3.0"));
      assert.ok(left.includes("0.4.0"));
      assert.ok(left.includes("0.5.0"));
      assert.ok(!left.includes("0.2.0"), "0.2.0 doit être purgé");
      if (usedOk) {
        assert.ok(
          left.includes("0.1.0"),
          "tag en usage (conteneur) jamais supprimé",
        );
        assert.ok(!out.deleted.some((d) => d.tag === "0.1.0"));
      } else {
        console.log(
          "skip live in-use : image registry:2 sans entrypoint sleep — couvert par le mock HTTP",
        );
      }
    } finally {
      spawnSync("docker", ["rm", "-f", usedName], { encoding: "utf8" });
      for (const tag of ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]) {
        spawnSync("docker", ["rmi", "-f", `${registry}/${repo}:${tag}`], {
          encoding: "utf8",
        });
      }
      if (started) {
        spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
      }
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* tmp */
      }
    }
  },
);
