#!/usr/bin/env node
/**
 * E2E navigateur générique (marque from-prd / sandbox) — sans hôte Windows.
 *
 * 1) brand-kernel-harness (API)
 * 2) Next UI plane (startBrandUiPlane)
 * 3) Parcours API + smoke HTTP pages
 *
 * Config (optionnelle) via package.json#creezio.e2e :
 *   { "entities": ["fournisseurs","produits"], "pages": [["/","Brand"],…] }
 * Sinon lit creezio.entities + pages par défaut.
 *
 * Usage (depuis racine marque) :
 *   node vendor/creezio/desktop-tooling/scripts/e2e-browser-parcours.mjs
 *   … --keep
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { portHolderLabel } from "./port-guard.mjs";
import {
  assertModuleRowHydratedById,
  pollModuleListUntilVisible,
} from "./meili-list-poll.mjs";

const root = path.resolve(process.env.CREEZIO_APP_ROOT || process.cwd());
const keep = process.argv.includes("--keep");
const creezioRoot =
  process.env.CREEZIO_KIT_ROOT ||
  process.env.CREEZIO_ROOT || // legacy — préférer CREEZIO_KIT_ROOT (Q8)
  (fs.existsSync("/opt/docker/creezio")
    ? "/opt/docker/creezio"
    : path.resolve(root, "../creezio"));

// Résolution hoist-safe des packages @creezio : import nu (résolu depuis CE
// script publié → node_modules effectif, quel que soit le hoisting workspaces),
// repli path-based pour les layouts legacy (vendor/, server/node_modules).
async function importCreezio(pkgName) {
  try {
    return await import(pkgName);
  } catch {
    return await import(
      pathToFileURL(path.join(root, "node_modules", pkgName, "dist/index.js"))
        .href,
    );
  }
}

const tmpBase = process.env.TMPDIR || path.join(root, ".tmp");
fs.mkdirSync(tmpBase, { recursive: true });

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const brandId = pkg.creezio?.brandId || pkg.name?.replace(/^@creezio\/app-/, "") || "brand";
const productName =
  pkg.creezio?.productName ||
  (() => {
    try {
      return JSON.parse(
        fs.readFileSync(
          path.join(root, "src/electron/app-manifest.json"),
          "utf8",
        ),
      ).client.productName;
    } catch {
      return brandId;
    }
  })();

const e2eCfg = pkg.creezio?.e2e || {};
const entities = e2eCfg.entities || pkg.creezio?.entities || [];
const uiPages =
  e2eCfg.pages ||
  [
    ["/", productName],
    ...entities.slice(0, 6).map((e) => [
      `/${e}`,
      e.charAt(0).toUpperCase() + e.slice(1).replace(/_/g, " "),
    ]),
  ];

const dataDir =
  process.env.METIER_DATA_DIR ||
  fs.mkdtempSync(path.join(tmpBase, `${brandId}-e2e-browser-`));

const proofPath =
  process.env.E2E_PROOF_PATH ||
  path.join(root, "docs", "PREUVE-E2E-BROWSER.md");

const toolEnv = {
  ...process.env,
  TMPDIR: tmpBase,
  PATH: [
    path.join(root, "node_modules", ".bin"),
    path.join(creezioRoot, "node_modules", ".bin"),
    process.env.PATH || "",
  ].join(path.delimiter),
  NODE_PATH: [
    path.join(root, "node_modules"),
    path.join(creezioRoot, "node_modules"),
  ].join(path.delimiter),
  CREEZIO_ROOT: creezioRoot,
};

function log(step, detail = "") {
  console.log(`[e2e] ${step}${detail ? ` — ${detail}` : ""}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.on("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => {
      s.close(() => resolve(true));
    });
  });
}

async function findFreePort() {
  // Prefer kit helper if available
  try {
    const mod = await importCreezio("@creezio/platform-core");
    if (typeof mod.findFreePort === "function") return mod.findFreePort();
  } catch {
    /* */
  }
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => (p ? resolve(p) : reject(new Error("no port"))));
    });
  });
}

async function resolveApiPort() {
  const raw = (process.env.METIER_PORT || "").trim();
  if (raw && raw !== "0") {
    const p = Number(raw);
    if (!(await portFree(p))) {
      // Q2 — échec clair plutôt que des 401 trompeurs contre un serveur étranger
      throw new Error(
        `METIER_PORT=${p} occupé${portHolderLabel(p)} — npm run stop ou METIER_PORT=0 (port auto)`,
      );
    }
    return p;
  }
  if (await portFree(18791)) return 18791;
  log("port", "18791 occupé — port libre");
  return findFreePort();
}

async function resolveUiPort() {
  const raw = (process.env.UI_PORT || "").trim();
  if (!raw || raw === "0") return findFreePort();
  const p = Number(raw);
  if (!(await portFree(p))) {
    throw new Error(
      `UI_PORT=${p} occupé${portHolderLabel(p)} — npm run stop ou UI_PORT=0 (port auto)`,
    );
  }
  return p;
}

async function main() {
  const { startBrandUiPlane } = await importCreezio("@creezio/app-runtime");

  const apiPort = await resolveApiPort();
  const uiPort = await resolveUiPort();
  const apiBase = `http://127.0.0.1:${apiPort}`;

  const build = spawnSync("npm", ["run", "build:electron"], {
    cwd: root,
    encoding: "utf8",
    shell: true,
    env: toolEnv,
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const standalone = path.join(root, "ui/.next/standalone/server.js");
  const skipUiBuild = process.env.E2E_SKIP_UI_BUILD === "1";
  const needUiRebuild =
    !skipUiBuild &&
    (!fs.existsSync(standalone) ||
      (apiPort !== 18791 &&
        !String(process.env.NEXT_PUBLIC_METIER_BASE_URL || "").includes(
          String(apiPort),
        )));

  if (needUiRebuild) {
    log("build:ui", `NEXT_PUBLIC → ${apiBase}`);
    const uiBuild = spawnSync("npm", ["run", "build:ui"], {
      cwd: root,
      encoding: "utf8",
      shell: true,
      env: { ...toolEnv, NEXT_PUBLIC_METIER_BASE_URL: apiBase },
    });
    assert.equal(uiBuild.status, 0, uiBuild.stderr || uiBuild.stdout);
  }
  assert.ok(fs.existsSync(standalone), "ui/.next/standalone/server.js requis");

  const harness = spawn(
    process.execPath,
    [path.join(root, "scripts/brand-kernel-harness.mjs")],
    {
      cwd: root,
      env: {
        ...toolEnv,
        METIER_DATA_DIR: dataDir,
        METIER_PORT: String(apiPort),
        // Indexation Meili ON par défaut : l'assertion « créé puis listé »
        // (polling borné plus bas) exige que l'indexeur tourne — avec
        // MEILI_SKIP_INDEX=1 la liste d'une entité indexée resterait
        // engine:"indexing" indéfiniment (contrat, pas un bug). L'opt-out
        // reste possible pour une entité primaire volontairement hors index.
        MEILI_SKIP_INDEX: process.env.MEILI_SKIP_INDEX || "0",
        CREEZIO_NATIVE_WARM: process.env.CREEZIO_NATIVE_WARM || "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let harnessErr = "";
  harness.stderr?.on("data", (b) => {
    harnessErr += String(b);
  });

  async function waitHealth(url, tries = 120) {
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url);
        if (res.ok) return;
      } catch {
        /* */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`health timeout ${url}\n${harnessErr.slice(-2000)}`);
  }

  async function json(method, urlPath, body) {
    const res = await fetch(`${apiBase}${urlPath}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    assert.ok(
      res.ok,
      `${method} ${urlPath} → ${res.status} ${JSON.stringify(data)}`,
    );
    return data;
  }

  async function pageOk(uiBase, route, mustInclude = []) {
    const res = await fetch(`${uiBase}${route}`, { redirect: "follow" });
    const html = await res.text();
    assert.ok(res.ok, `GET ${route} → ${res.status}`);
    for (const needle of mustInclude) {
      assert.ok(
        html.includes(needle),
        `page ${route} sans « ${needle} » (${html.slice(0, 160)}…)`,
      );
    }
    return { status: res.status, bytes: html.length };
  }

  const steps = [];
  let uiPlane = null;
  try {
    await waitHealth(`${apiBase}/api/v1/core/health`);
    steps.push({ step: "api.health", ok: true, detail: apiBase });

    uiPlane = await startBrandUiPlane({
      appRoot: root,
      metierBaseUrl: apiBase,
      preferredPort: uiPort,
    });
    assert.equal(uiPlane.kind, "next", "Next UI plane requis");
    steps.push({ step: "ui.plane", ok: true, detail: uiPlane.baseUrl });

    const stamp = Date.now().toString(36);
    const created = {};
    // CRUD générique sur la 1re entité listable (souvent fournisseurs)
    const primary = entities[0];
    if (primary) {
      const body =
        primary.includes("fournisseur") || primary.includes("supplier")
          ? { nom: `E2E ${stamp}` }
          : { nom: `E2E ${stamp}`, title: `E2E ${stamp}` };
      const row = await json("POST", `/api/v1/modules/${primary}`, body);
      const id = row.id || row.item?.id;
      assert.ok(id, `${primary} id`);
      created[primary] = id;
      steps.push({ step: `api.${primary}.create`, ok: true, detail: id });
      // Read-after-write déterministe : hydratation par PK (`?ids=`),
      // chemin SQL légitime du contrat kit (jamais Meili).
      await assertModuleRowHydratedById(
        json,
        `/api/v1/modules/${primary}`,
        id,
        primary,
      );
      // Cohérence éventuelle (contrat kit : la liste d'une entité indexée
      // passe par Meili) — `engine:"indexing"` + 0 item pendant l'indexation
      // initiale, le client réessaie. Polling borné = comportement client
      // nominal ; échec explicite immédiat si engine:"meili" sans le doc.
      const list = await pollModuleListUntilVisible(
        json,
        `/api/v1/modules/${primary}`,
        (items) => items.some((x) => x.id === id),
        { label: primary },
      );
      steps.push({
        step: `api.${primary}.listed`,
        ok: true,
        detail: `engine=${list.engine || "sql"}`,
      });
    } else {
      steps.push({
        step: "api.entities",
        ok: true,
        detail: "aucune entité creezio.entities — skip CRUD",
      });
    }

    for (const [route, needle] of uiPages) {
      const r = await pageOk(uiPlane.baseUrl, route, [needle]);
      steps.push({
        step: `ui.page${route === "/" ? "/home" : route}`,
        ok: true,
        detail: `${r.status} ${r.bytes}o`,
      });
    }

    const pass = steps.filter((s) => s.ok).length;
    const report = {
      at: new Date().toISOString(),
      brandId,
      apiBase,
      uiBase: uiPlane.baseUrl,
      dataDir,
      keep,
      pass,
      fail: 0,
      steps,
      created,
    };

    const md = `# Preuve E2E navigateur — ${productName}

> Généré par \`npm run e2e:browser\` — ${report.at}

| Couche | URL |
|--------|-----|
| API | \`${apiBase}\` |
| UI | \`${uiPlane.baseUrl}\` |
| dataDir | \`${dataDir}\` |

| Step | OK | Détail |
|------|----|--------|
${steps.map((s) => `| \`${s.step}\` | ✅ | ${s.detail || ""} |`).join("\n")}

**MISSION=SUCCESS** pass=${pass}

\`\`\`bash
npm run e2e:browser
npm run e2e:browser -- --keep
\`\`\`
`;
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, md);
    fs.writeFileSync(
      path.join(tmpBase, "e2e-browser-last.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify(
        { ok: true, pass, uiBase: uiPlane.baseUrl, apiBase, proofPath },
        null,
        2,
      ),
    );
    console.log("MISSION=SUCCESS");
    if (keep) {
      log("keep", `UI ${uiPlane.baseUrl} · API ${apiBase}`);
      await new Promise(() => {});
    }
  } catch (err) {
    console.error("MISSION=FAIL", err);
    process.exitCode = 1;
  } finally {
    if (!keep) {
      try {
        await uiPlane?.close?.();
      } catch {
        /* */
      }
      try {
        harness.kill("SIGTERM");
      } catch {
        /* */
      }
    }
  }
}

main().catch((err) => {
  console.error("MISSION=FAIL", err);
  process.exit(1);
});
