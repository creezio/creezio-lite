#!/usr/bin/env node
/**
 * Gate 0.10.3 — update d'un stack ne peut plus retirer cloudflared ni
 * changer le hostname public (incident Tempoflow restos : update 0.10.2
 * a régénéré un compose app-seule + `up --remove-orphans` → 530/1033).
 *
 *   1. compose AVEC sidecar + tunnel.env → write/update = sidecar + mêmes
 *      env / hostname, seule l'image app change ;
 *   2. compose SANS sidecar + hostname public persisté → fail-closed ;
 *   3. CREEZIO_TUNNEL_LOCAL=1 sans sidecar → rewrite local inchangé ;
 *   4. cf.env in-process (natif 0.10) → rewrite OK, pas de sidecar créé ;
 *   5. migrate (allowDropSidecar) seul peut retirer le sidecar ;
 *   6. updateServer refuse AVANT recreate (source + politique).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// SoT @creezio/fleet (wrappers fleet-collector retirés en 0.19) — dist requis.
const STACK = path.join(ROOT, "packages/fleet/dist/instance-stack.js");
const SERVER_LIB = path.join(ROOT, "packages/fleet/src/server-lib.ts");
const INSTANCE_STACK_SRC = path.join(
  ROOT,
  "packages/fleet/src/instance-stack.ts",
);

const stack = await import(pathToFileURL(STACK).href);

const INST = {
  name: "resto-marseille",
  containerName: "tempoflow3-server-resto-marseille",
  port: 0,
  bind: "127.0.0.1",
  dataDir: path.join("docker-data", "servers", "resto-marseille"),
  createdAt: "2026-08-01T00:00:00.000Z",
  env: { CREEZIO_NATIVE_WARM: "1" },
  stack: true,
};

const HOSTNAME = "resto-marseille.tempoflow.fr";
const TUNNEL_ID = "tid-live-marseille-keep";
const TUNNEL_TOKEN = "tok-live-do-not-rotate";

function sidecarCompose(appImage) {
  return [
    `# Stack historique app + sidecar (pré-0.10).`,
    `name: tempoflow3-server-resto-marseille`,
    `services:`,
    `  app:`,
    `    image: ${appImage}`,
    `    container_name: tempoflow3-server-resto-marseille`,
    `    restart: unless-stopped`,
    `    env_file:`,
    `      - ./tunnel.env`,
    `    environment:`,
    `      CREEZIO_TUNNEL_SIDECAR: "1"`,
    `      CREEZIO_TUNNEL_SERVICE_HOST: "app"`,
    `  cloudflared:`,
    `    image: cloudflare/cloudflared:2026.7.3`,
    `    container_name: tempoflow3-server-resto-marseille-tunnel`,
    `    restart: unless-stopped`,
    `    command: tunnel --no-autoupdate run`,
    `    env_file:`,
    `      - ./tunnel.env`,
    ``,
  ].join("\n");
}

function writeSidecarFixture(brandRoot, { compose = true } = {}) {
  const dir = stack.stackDir(brandRoot, INST);
  fs.mkdirSync(dir, { recursive: true });
  if (compose) {
    fs.writeFileSync(stack.composeFilePath(brandRoot, INST), sidecarCompose("img:v1"));
  }
  fs.writeFileSync(
    stack.tunnelEnvPath(brandRoot, INST),
    [
      `TUNNEL_TOKEN=${TUNNEL_TOKEN}`,
      `CREEZIO_TUNNEL_TOKEN=${TUNNEL_TOKEN}`,
      `CREEZIO_TUNNEL_HOSTNAME=${HOSTNAME}`,
      `CREEZIO_TUNNEL_ID=${TUNNEL_ID}`,
      ``,
    ].join("\n"),
    { mode: 0o600 },
  );
  return dir;
}

test("update : compose avec sidecar → sidecar + mêmes env, image app seule", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upd-side-"));
  writeSidecarFixture(brandRoot);
  const policy = stack.resolveStackUpdatePolicy({
    brandRoot,
    brandId: "tempoflow3",
    inst: INST,
  });
  assert.equal(policy.action, "preserve-sidecar");
  assert.deepEqual(policy.sidecarServices, ["cloudflared"]);

  const written = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:v2",
    inst: INST,
  });
  assert.equal(written.preservedSidecar, true);
  const yml = fs.readFileSync(written.composeFile, "utf8");
  assert.match(yml, /^  cloudflared:/m);
  assert.match(yml, /cloudflare\/cloudflared:2026\.7\.3/);
  assert.match(yml, /image: img:v2/);
  assert.doesNotMatch(yml, /image: img:v1/);
  assert.match(yml, /env_file:\n      - \.\/tunnel\.env/);
  assert.match(yml, /CREEZIO_TUNNEL_SIDECAR: "1"/);
  assert.match(yml, /container_name: tempoflow3-server-resto-marseille-tunnel/);
  const env = fs.readFileSync(stack.tunnelEnvPath(brandRoot, INST), "utf8");
  assert.match(env, new RegExp(`CREEZIO_TUNNEL_HOSTNAME=${HOSTNAME}`));
  assert.match(env, new RegExp(`CREEZIO_TUNNEL_ID=${TUNNEL_ID}`));
  assert.match(env, new RegExp(`TUNNEL_TOKEN=${TUNNEL_TOKEN}`));
  assert.ok(!yml.includes(TUNNEL_TOKEN), "token ne doit pas fuiter dans le compose");
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("update : compose sans sidecar + hostname persisté → fail-closed", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upd-fail-"));
  writeSidecarFixture(brandRoot, { compose: false });
  fs.writeFileSync(
    stack.composeFilePath(brandRoot, INST),
    [
      `name: tempoflow3-server-resto-marseille`,
      `services:`,
      `  app:`,
      `    image: img:broken-app-only`,
      `    container_name: tempoflow3-server-resto-marseille`,
      ``,
    ].join("\n"),
  );
  const policy = stack.resolveStackUpdatePolicy({
    brandRoot,
    brandId: "tempoflow3",
    inst: INST,
  });
  assert.equal(policy.action, "refuse");
  assert.match(policy.error, /update refusé/);
  assert.match(policy.error, /resto-marseille\.tempoflow\.fr/);
  assert.match(policy.error, /Rien n'a été modifié/);

  const before = fs.readFileSync(stack.composeFilePath(brandRoot, INST), "utf8");
  assert.throws(
    () =>
      stack.writeInstanceStack({
        brandRoot,
        brandId: "tempoflow3",
        image: "img:v-must-not-write",
        inst: INST,
      }),
    (err) => {
      assert.equal(err.code, "STACK_UPDATE_REFUSED");
      assert.match(err.message, /resto-marseille\.tempoflow\.fr/);
      return true;
    },
  );
  const after = fs.readFileSync(stack.composeFilePath(brandRoot, INST), "utf8");
  assert.equal(after, before, "compose inchangé après refus");
  assert.doesNotMatch(after, /img:v-must-not-write/);
  assert.match(
    fs.readFileSync(stack.tunnelEnvPath(brandRoot, INST), "utf8"),
    new RegExp(`CREEZIO_TUNNEL_HOSTNAME=${HOSTNAME}`),
  );
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("update : hostname kernel persisté sans sidecar ni cf.env → fail-closed", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upd-kc-"));
  const dataDir = path.join(brandRoot, INST.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(stack.stackDir(brandRoot, INST), { recursive: true });
  fs.writeFileSync(
    stack.composeFilePath(brandRoot, INST),
    `services:\n  app:\n    image: img:old\n`,
  );
  fs.writeFileSync(
    path.join(dataDir, "tempoflow3-config.json"),
    JSON.stringify({
      tunnelMeta: {
        slug: "resto-marseille",
        hostname: HOSTNAME,
        tunnelId: TUNNEL_ID,
      },
      tunnelToken: JSON.stringify({ plain: TUNNEL_TOKEN }),
    }),
  );
  const policy = stack.resolveStackUpdatePolicy({
    brandRoot,
    brandId: "tempoflow3",
    inst: INST,
  });
  assert.equal(policy.action, "refuse");
  assert.equal(policy.hostname, HOSTNAME);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("update : CREEZIO_TUNNEL_LOCAL=1 sans sidecar → rewrite local", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upd-loc-"));
  const inst = { ...INST, env: { CREEZIO_TUNNEL_LOCAL: "1" } };
  const written = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:local-1",
    inst,
  });
  assert.equal(written.preservedSidecar, false);
  const yml = fs.readFileSync(written.composeFile, "utf8");
  assert.doesNotMatch(yml, /^  cloudflared:/m);
  assert.match(yml, /image: img:local-1/);
  const again = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:local-2",
    inst,
  });
  assert.equal(again.preservedSidecar, false);
  assert.match(fs.readFileSync(again.composeFile, "utf8"), /image: img:local-2/);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("update : stack in-process (cf.env) → rewrite OK, pas de sidecar inventé", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upd-cf-"));
  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:inproc-1",
    inst: INST,
    cf: {
      CREEZIO_CF_API_TOKEN: "cf-token",
      CREEZIO_CF_ACCOUNT_ID: "acc",
      CREEZIO_CF_ZONE_ID: "zone",
      CREEZIO_CF_ZONE_NAME: "tempoflow.fr",
      CREEZIO_TUNNEL_SLUG: "resto-marseille",
      CREEZIO_DOMAIN: HOSTNAME,
    },
  });
  const policy = stack.resolveStackUpdatePolicy({
    brandRoot,
    brandId: "tempoflow3",
    inst: INST,
  });
  assert.equal(policy.action, "rewrite");
  const again = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:inproc-2",
    inst: INST,
  });
  assert.equal(again.preservedSidecar, false);
  const yml = fs.readFileSync(again.composeFile, "utf8");
  assert.match(yml, /image: img:inproc-2/);
  assert.doesNotMatch(yml, /^  cloudflared:/m);
  assert.match(yml, /- \.\/cf\.env/);
  const cf = fs.readFileSync(stack.cfEnvPath(brandRoot, INST), "utf8");
  assert.match(cf, new RegExp(`CREEZIO_DOMAIN=${HOSTNAME}`));
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("migrate attach : in-process SANS cf.env → écrit cf.env + env_file, pas de sidecar", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upd-attach-"));
  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflowadmin",
    image: "img:admin-1",
    inst: { ...INST, name: "main", containerName: "tempoflowadmin-server-main" },
  });
  assert.equal(fs.existsSync(stack.cfEnvPath(brandRoot, { ...INST, name: "main" })), false);
  const attached = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflowadmin",
    image: "img:admin-1",
    inst: { ...INST, name: "main", containerName: "tempoflowadmin-server-main" },
    cf: {
      CREEZIO_CF_API_TOKEN: "cf-token",
      CREEZIO_CF_ACCOUNT_ID: "acc",
      CREEZIO_CF_ZONE_ID: "zone",
      CREEZIO_CF_ZONE_NAME: "tempoflow.fr",
      CREEZIO_TUNNEL_SLUG: "tempoflowadmin-lp",
      CREEZIO_DOMAIN: "lp.tempoflow.fr",
    },
    allowDropSidecar: true,
  });
  assert.equal(attached.preservedSidecar, false);
  const yml = fs.readFileSync(attached.composeFile, "utf8");
  assert.doesNotMatch(yml, /^  cloudflared:/m);
  assert.match(yml, /- \.\/cf\.env/);
  const cf = fs.readFileSync(
    stack.cfEnvPath(brandRoot, { ...INST, name: "main" }),
    "utf8",
  );
  assert.match(cf, /CREEZIO_DOMAIN=lp\.tempoflow\.fr/);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("migrate-stack : allowDropSidecar retire le sidecar (chemin explicite)", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upd-mig-"));
  writeSidecarFixture(brandRoot);
  const written = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:migrated",
    inst: INST,
    cf: {
      CREEZIO_CF_API_TOKEN: "cf-token",
      CREEZIO_CF_ACCOUNT_ID: "acc",
      CREEZIO_CF_ZONE_ID: "zone",
      CREEZIO_DOMAIN: HOSTNAME,
      CREEZIO_TUNNEL_SLUG: "resto-marseille",
    },
    allowDropSidecar: true,
  });
  assert.equal(written.preservedSidecar, false);
  const yml = fs.readFileSync(written.composeFile, "utf8");
  assert.doesNotMatch(yml, /^  cloudflared:/m);
  assert.match(yml, /image: img:migrated/);
  assert.match(yml, /- \.\/cf\.env/);
  const cf = fs.readFileSync(stack.cfEnvPath(brandRoot, INST), "utf8");
  assert.match(cf, new RegExp(`CREEZIO_DOMAIN=${HOSTNAME}`));
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("patchComposeAppImage ne touche pas l'image cloudflared", () => {
  const yml = sidecarCompose("old:1");
  const patched = stack.patchComposeAppImage(yml, "new:2");
  assert.match(patched, /  app:\n    image: new:2/);
  assert.match(patched, /cloudflare\/cloudflared:2026\.7\.3/);
  assert.doesNotMatch(patched, /image: old:1/);
});

test("updateServer : refuse fail-closed avant recreate (source)", () => {
  const src = fs.readFileSync(SERVER_LIB, "utf8");
  assert.match(src, /resolveStackUpdatePolicy/);
  // P2.b : le code d'erreur vit dans instance-stack.ts (erreur typée),
  // server-lib le détecte via le type guard — même contrat fail-closed.
  assert.match(src, /isStackUpdateRefused\(e\)/);
  const stackSrc = fs.readFileSync(INSTANCE_STACK_SRC, "utf8");
  assert.match(stackSrc, /STACK_UPDATE_REFUSED/);
  assert.match(src, /preserve-sidecar/);
  assert.match(src, /removeOrphans: stackPolicy\?\.action !== "preserve-sidecar"/);
  assert.match(src, /sidecar \$\{stackPolicy\.sidecarServices\.join/);
  assert.match(src, /resolveInstanceHostPort/);
  assert.match(src, /applyAllocatedHostPort/);
  assert.match(src, /2e update/);
});

test("listCloudflaredServiceNames couvre cloudflared*", () => {
  const yml = [
    `services:`,
    `  app:`,
    `    image: x`,
    `  cloudflared:`,
    `    image: y`,
    `  cloudflared-extra:`,
    `    image: z`,
    ``,
  ].join("\n");
  assert.deepEqual(stack.listCloudflaredServiceNames(yml), [
    "cloudflared",
    "cloudflared-extra",
  ]);
  assert.equal(stack.composeHasCloudflaredSidecar("services:\n  app:\n    image: x\n"), false);
});
