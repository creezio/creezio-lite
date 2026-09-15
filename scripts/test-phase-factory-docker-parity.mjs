#!/usr/bin/env node
/**
 * Gate héritage factory → Docker (env, opt-in CREEZIO_FACTORY_DOCKER=1).
 *
 * Preuve « l'architecture serveur est automatiquement la même pour toutes
 * les apps » : génère une app NEUVE via la factory (`creezio new-app
 * --from-prd`), la démarre en Docker via `creezio server-docker create`,
 * et vérifie SANS AUCUNE retouche manuelle la parité avec TF3 :
 *   - harness généré = template kit (défauts catalogue, modules optionnels) ;
 *   - image : cloudflared présent (/opt/creezio/bin) + env générique ;
 *   - boot-status : étapes harness (catalog, next, plugins, fleet) vertes ;
 *   - fleet = no-op sentinelle (aucun collector contacté).
 * L'app jetable et son image Docker sont purgées en fin de gate.
 *
 * Prérequis lourds : docker + npm install app générée + build UI Next
 * (~10 min) → `CREEZIO_FACTORY_DOCKER=1 npm run test:env -- --timeout 1800`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");
const PRD = path.join(ROOT, "docs/experiences/tempoflow3/PRD-PRODUIT.md");

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return r;
}

function dockerAvailable() {
  return sh("docker", ["--version"]).status === 0;
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

test("FDP factory → Docker : app neuve = même architecture serveur que TF3", async () => {
  if (!dockerAvailable()) {
    console.log("skip: docker indisponible");
    return;
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-fdp-"));
  const instance = "parityprobe";
  let containerName = null;
  let brandId = null;
  try {
    // 1) Génération factory — AUCUNE retouche manuelle ensuite.
    //    --id jetable : le PRD fixture produirait brandId=tempoflow3, et
    //    l'image `creezio-server-tempoflow3:local` appartient au vrai TF3.
    const gen = sh(
      process.execPath,
      [
        CLI,
        "new-app",
        "--from-prd",
        PRD,
        "--id",
        "parityprobe",
        "--out",
        outDir,
        "--force",
        "--no-push",
      ],
      { cwd: ROOT },
    );
    assert.equal(gen.status, 0, gen.stderr + "\n" + gen.stdout);
    const server = path.join(outDir, "server");

    // 2) Harness généré = template kit (mêmes décisions que TF3).
    const harness = fs.readFileSync(
      path.join(server, "scripts/brand-kernel-harness.mjs"),
      "utf8",
    );
    assert.match(harness, /applyBrandCatalogEnvDefaults\("[A-Z0-9_]+"\)/);
    assert.match(harness, /importOptional\("catalog-sync\.js"\)/);
    assert.match(harness, /importOptional\("brand-mcp-tools\.js"\)/);
    assert.match(harness, /importOptional\("brand-platform-bindings\.js"\)/);
    assert.match(harness, /startBrandKernelHarness/);

    // 3) Boot Docker via le CLI kit — ZÉRO étape manuelle : `create` fait
    //    lui-même locks → npm install → build runtime/UI → image → run.
    //    (Mode npm : deps @creezio/* publiées, CREEZIO_NPM_TOKEN requis —
    //    secret BuildKit passé au build par le CLI.)
    const port = await freePort();
    const create = sh(
      process.execPath,
      [
        CLI,
        "server-docker",
        "create",
        instance,
        "--brand-root",
        outDir,
        "--port",
        String(port),
        "--env",
        "CREEZIO_PLUGINS=1",
      ],
      {
        cwd: outDir,
        env: {
          ...process.env,
          CREEZIO_KIT_ROOT: ROOT,
          ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
        },
      },
    );
    assert.equal(create.status, 0, create.stderr.slice(-6000) + "\n" + create.stdout.slice(-3000));

    const registry = JSON.parse(
      fs.readFileSync(path.join(outDir, "docker-data/servers.json"), "utf8"),
    );
    brandId = registry.brandId || null;
    assert.equal(
      brandId,
      "parityprobe",
      "brandId jetable — ne doit JAMAIS collisionner avec une marque réelle",
    );
    const inst = registry.instances.find((i) => i.name === instance);
    assert.ok(inst, "instance enregistrée");
    containerName = inst.containerName;

    // 5) Boot-status : mêmes étapes harness que TF3. Le health répond avant
    //    la fin des phases post-listen (plugins, fleet) → poll jusqu'à 100 %.
    let status = null;
    const deadline = Date.now() + 120_000;
    for (;;) {
      status = await (
        await fetch(`http://127.0.0.1:${port}/api/v1/os/boot-status`)
      ).json();
      if (Math.round(status.overallPercent) === 100) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const step = (id) => status.steps.find((s) => s.id === id);
    assert.equal(step("next")?.status, "done", JSON.stringify(step("next")));
    assert.ok(
      ["done", "skip"].includes(step("catalog")?.status),
      `catalog: ${JSON.stringify(step("catalog"))}`,
    );
    assert.equal(
      step("plugins")?.status,
      "done",
      `plugins (CREEZIO_PLUGINS=1): ${JSON.stringify(step("plugins"))}`,
    );
    assert.equal(step("fleet")?.status, "done", JSON.stringify(step("fleet")));
    assert.match(
      String(step("fleet")?.detail || ""),
      /sentinelle|désactivée/i,
      "fleet no-op sans endpoint réel",
    );
    // Pas de provision tunnel demandée → étape tunnel skip (no-op propre).
    assert.equal(
      step("tunnel")?.status,
      "skip",
      `tunnel skip sans provision env: ${JSON.stringify(step("tunnel"))}`,
    );
    assert.equal(Math.round(status.overallPercent), 100);

    // 6) cloudflared embarqué dans l'image + env générique kit.
    const cf = sh("docker", [
      "exec",
      containerName,
      "/opt/creezio/bin/cloudflared",
      "--version",
    ]);
    assert.equal(cf.status, 0, cf.stderr);
    assert.match(cf.stdout + cf.stderr, /cloudflared version/i);
    const envOut = sh("docker", [
      "exec",
      containerName,
      "sh",
      "-c",
      "echo $CREEZIO_CLOUDFLARED_BINARY",
    ]);
    assert.equal(envOut.stdout.trim(), "/opt/creezio/bin/cloudflared");

    // 7) Santé kernel (même contrat HTTP que TF3).
    const health = await (
      await fetch(`http://127.0.0.1:${port}/api/v1/core/health`)
    ).json();
    assert.equal(health.ok, true, JSON.stringify(health));
  } finally {
    // Purge : container + registre + données + image + app jetable.
    sh(
      process.execPath,
      [
        CLI,
        "server-docker",
        "rm",
        instance,
        "--brand-root",
        outDir,
        "--purge-data",
      ],
      { cwd: outDir, env: { ...process.env, CREEZIO_KIT_ROOT: ROOT } },
    );
    if (containerName) sh("docker", ["rm", "-f", containerName]);
    // Le container écrit /data en root : rm des données via docker AVANT
    // le rmSync hôte (sinon EACCES), puis suppression de l'image jetable.
    if (brandId === "parityprobe") {
      sh("docker", [
        "run",
        "--rm",
        "--entrypoint",
        "sh",
        "-v",
        `${outDir}:/purge`,
        `creezio-server-${brandId}:local`,
        "-c",
        "rm -rf /purge/docker-data",
      ]);
      // Retry : le container --rm de purge peut ne pas être encore récolté
      // par le daemon (rmi échoue « image is being used »).
      for (let i = 0; i < 5; i++) {
        const rmi = sh("docker", [
          "rmi",
          "-f",
          `creezio-server-${brandId}:local`,
        ]);
        if (rmi.status === 0) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`purge incomplète de ${outDir}: ${err?.message || err}`);
    }
  }
});
