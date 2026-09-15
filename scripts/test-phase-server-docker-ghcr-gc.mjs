#!/usr/bin/env node
/**
 * Gate D5 — rétention GHCR (API GitHub Packages versions).
 * Fonctions pures + mock HTTP (pas de réseau, pas de token réel).
 * SoT : packages/factory/src/server-docker-ghcr-gc.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages/factory/dist/server-docker-ghcr-gc.js");
const CLI = path.join(ROOT, "packages/factory/src/server-docker-cli.ts");

assert.ok(
  fs.existsSync(DIST),
  "packages/factory/dist/server-docker-ghcr-gc.js absent — npm run build -w @creezio/factory",
);

const ghcr = await import(new URL(`file://${DIST}`).href);

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

function versionRow(id, digest, tags) {
  return {
    id,
    name: digest,
    metadata: { package_type: "container", container: { tags } },
  };
}

function createMemoryGhcr(initial) {
  const packages = structuredClone(initial);
  const deleted = [];
  const http = {
    async request(url, init) {
      const u = new URL(url);
      const method = (init?.method || "GET").toUpperCase();
      if (u.pathname === "/orgs/creezio/packages" && method === "GET") {
        return mockRes(
          200,
          Object.keys(packages).map((name) => ({ name, package_type: "container" })),
        );
      }
      const list = /^\/orgs\/creezio\/packages\/container\/([^/]+)\/versions$/.exec(
        u.pathname,
      );
      if (list && method === "GET") {
        const name = decodeURIComponent(list[1]);
        const rows = (packages[name] || []).map((v) =>
          versionRow(v.id, v.name, v.tags),
        );
        return mockRes(200, rows);
      }
      const del =
        /^\/orgs\/creezio\/packages\/container\/([^/]+)\/versions\/(\d+)$/.exec(
          u.pathname,
        );
      if (del && method === "DELETE") {
        const name = decodeURIComponent(del[1]);
        const id = Number(del[2]);
        const listV = packages[name] || [];
        const idx = listV.findIndex((v) => v.id === id);
        if (idx < 0) return mockRes(404, { message: "Not Found" });
        listV.splice(idx, 1);
        deleted.push({ packageName: name, id });
        return mockRes(204, {});
      }
      return mockRes(404, { message: "Not Found" });
    },
  };
  return { packages, deleted, http };
}

function mockDocker(opts = {}) {
  return {
    available: () => opts.available !== false,
    listInUseImages: () => opts.inUse || [],
    containerRunning: () => true,
    garbageCollect: () => ({ status: 0, stdout: "", stderr: "" }),
    listBrandRoots: () => [],
  };
}

test("CLI source : dispatch GHCR + plus de skip silencieux ghcr.io", () => {
  const src = fs.readFileSync(CLI, "utf8");
  assert.match(src, /isGhcrRegistry/);
  assert.match(src, /runGhcrGcCommand/);
  assert.match(src, /runGhcrPublishRetention/);
  assert.match(src, /privateRegistryBases/);
  assert.equal(ghcr.isGhcrRegistry("ghcr.io/creezio"), true);
  assert.equal(ghcr.isGhcrRegistry("127.0.0.1:5000"), false);
  assert.deepEqual(ghcr.parseGhcrRegistry("ghcr.io/creezio"), {
    owner: "creezio",
    packageName: undefined,
  });
  assert.deepEqual(ghcr.parseGhcrRegistry("ghcr.io/creezio/creezio-server-acme"), {
    owner: "creezio",
    packageName: "creezio-server-acme",
  });
});

test("selectGhcrTagsToPrune : 3 semver min + jamais in-use", () => {
  assert.equal(ghcr.GHCR_SEMVER_KEEP_MIN, 3);
  assert.equal(ghcr.resolveGhcrSemverKeep(2), 3);
  assert.deepEqual(
    ghcr.selectGhcrTagsToPrune(["0.1.0", "0.2.0", "0.3.0"], 2),
    [],
    "keep=2 → plancher semver=3 : rien à purger",
  );
  assert.deepEqual(
    ghcr.selectGhcrTagsToPrune(["0.1.0", "0.2.0", "0.3.0", "0.4.0"], 2),
    ["0.1.0"],
  );
  assert.deepEqual(
    ghcr.selectGhcrTagsToPrune(
      ["0.1.0", "0.2.0", "0.3.0", "0.4.0"],
      2,
      ["0.1.0"],
    ),
    [],
    "tag protégé (in-use / servers.json) jamais évincé",
  );
  const mixed = ghcr.selectGhcrTagsToPrune(
    [
      "0.1.0",
      "0.2.0",
      "0.3.0",
      "0.4.0",
      "auto.202601010000.aaa",
      "auto.202601020000.bbb",
      "auto.202601030000.ccc",
    ],
    2,
  );
  assert.deepEqual(mixed.sort(), ["0.1.0", "auto.202601010000.aaa"]);
});

test("planGhcrPackageGc : 3 semver + referenced + untagged conservés", () => {
  const plan = ghcr.planGhcrPackageGc({
    packageName: "creezio-server-acme",
    versions: [
      { id: 1, name: "sha256:1", tags: ["0.1.0"] },
      { id: 2, name: "sha256:2", tags: ["0.2.0"] },
      { id: 3, name: "sha256:3", tags: ["0.3.0"] },
      { id: 4, name: "sha256:4", tags: ["0.4.0"] },
      { id: 5, name: "sha256:att", tags: [] },
    ],
    keep: 2,
    inUseTags: new Set(["0.1.0"]),
    referencedTags: new Set(),
    inUseDigests: new Set(),
    referencedDigests: new Set(),
  });
  const keptIds = plan.keep.map((k) => k.id).sort((a, b) => a - b);
  assert.deepEqual(keptIds, [1, 2, 3, 4, 5]);
  assert.equal(plan.keep.find((k) => k.id === 1).reason, "in-use");
  assert.equal(plan.keep.find((k) => k.id === 5).reason, "untagged");
  assert.deepEqual(plan.delete, []);

  const prune = ghcr.planGhcrPackageGc({
    packageName: "creezio-server-acme",
    versions: [
      { id: 1, name: "sha256:1", tags: ["0.1.0"] },
      { id: 2, name: "sha256:2", tags: ["0.2.0"] },
      { id: 3, name: "sha256:3", tags: ["0.3.0"] },
      { id: 4, name: "sha256:4", tags: ["0.4.0"] },
      { id: 10, name: "sha256:old", tags: ["0.0.1"] },
    ],
    keep: 2,
    inUseTags: new Set(),
    referencedTags: new Set(["0.0.1"]),
    inUseDigests: new Set(),
    referencedDigests: new Set(),
  });
  assert.deepEqual(
    prune.delete.map((d) => d.tags[0]).sort(),
    ["0.1.0"],
  );
  assert.equal(prune.keep.find((k) => k.tags[0] === "0.0.1").reason, "referenced");
});

test("resolveGhcrToken fail-closed si auth absente", () => {
  assert.throws(
    () => ghcr.resolveGhcrToken({ PATH: "/usr/bin" }, []),
    /authentification manquante/,
  );
  assert.equal(ghcr.resolveGhcrToken({ GHCR_TOKEN: "ghp_test" }, []), "ghp_test");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-ghcr-tok-"));
  try {
    const file = path.join(dir, ".github-token");
    fs.writeFileSync(file, "ghs_from_file\n");
    assert.equal(ghcr.resolveGhcrToken({}, [file]), "ghs_from_file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runGhcrGc mock : dry-run puis apply, servers.json protégé", async () => {
  const mem = createMemoryGhcr({
    "creezio-server-acme": [
      { id: 1, name: "sha256:1", tags: ["0.1.0"] },
      { id: 2, name: "sha256:2", tags: ["0.2.0"] },
      { id: 3, name: "sha256:3", tags: ["0.3.0"] },
      { id: 4, name: "sha256:4", tags: ["0.4.0"] },
      { id: 5, name: "sha256:5", tags: ["0.5.0"] },
    ],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-ghcr-srv-"));
  const lines = [];
  try {
    const servers = path.join(dir, "servers.json");
    fs.writeFileSync(
      servers,
      JSON.stringify({
        image: "ghcr.io/creezio/creezio-server-acme:0.1.0",
        instances: [
          { name: "prod", image: "ghcr.io/creezio/creezio-server-acme:0.2.0" },
        ],
      }),
    );
    const dry = await ghcr.runGhcrGc({
      registry: "ghcr.io/creezio",
      keep: 2,
      dryRun: true,
      packageName: "creezio-server-acme",
      serversFiles: [servers],
      token: "ghp_test",
      ghHttp: mem.http,
      docker: mockDocker({ available: false }),
      log: (l) => lines.push(l),
    });
    assert.equal(dry.dryRun, true);
    assert.equal(mem.deleted.length, 0);
    assert.equal(dry.deleted.length, 0);
    assert.ok(lines.some((l) => l.includes("[dry-run]")));

    const applied = await ghcr.runGhcrGc({
      registry: "ghcr.io/creezio",
      keep: 2,
      dryRun: false,
      packageName: "creezio-server-acme",
      serversFiles: [servers],
      token: "ghp_test",
      ghHttp: mem.http,
      docker: mockDocker({ available: false }),
      log: () => {},
    });
    // 5 semver, keep min 3 (0.3/0.4/0.5) + referenced 0.1 + 0.2 → rien à purger
    assert.deepEqual(applied.deleted, []);
    assert.equal(mem.deleted.length, 0);

    mem.packages["creezio-server-acme"].push({
      id: 9,
      name: "sha256:9",
      tags: ["0.0.9"],
    });
    const pruned = await ghcr.runGhcrGc({
      registry: "ghcr.io/creezio",
      keep: 2,
      dryRun: false,
      packageName: "creezio-server-acme",
      serversFiles: [servers],
      token: "ghp_test",
      ghHttp: mem.http,
      docker: mockDocker({ available: false }),
      log: () => {},
    });
    assert.deepEqual(
      pruned.deleted.map((d) => d.tags[0]),
      ["0.0.9"],
    );
    assert.deepEqual(mem.deleted, [{ packageName: "creezio-server-acme", id: 9 }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runGhcrGc fail-closed sans token même avec http mockable", async () => {
  await assert.rejects(
    () =>
      ghcr.runGhcrGc({
        registry: "ghcr.io/creezio",
        keep: 2,
        dryRun: true,
        env: { PATH: "/usr/bin" },
        tokenFiles: [],
        docker: mockDocker({ available: false }),
      }),
    /authentification manquante/,
  );
});
