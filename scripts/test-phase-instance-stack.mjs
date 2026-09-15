#!/usr/bin/env node
/**
 * Gate M2 (0.10.0) — stack compose autonome par instance, modèle UNIQUE :
 * app seule, cloudflared IN-PROCESS (fin du sidecar et du provisioner VPS).
 *
 * Vérifie le contrat du renderer instance-stack.mjs :
 *   - port INTERNE fixe 18791, port hôte loopback auto (127.0.0.1::18791)
 *     ou fixe (hostPort > 0) — jamais de port public ;
 *   - AUCUN service cloudflared dans le compose (auto-provisioning CF au
 *     boot par l'instance elle-même) ;
 *   - contrat Cloudflare via env_file cf.env (chmod 600) — jamais de
 *     CREEZIO_CF_* en clair dans `environment:` du compose.yml ;
 *   - secrets applicatifs (TOKEN/SECRET/PASSWORD/API_KEY…) isolés dans
 *     secrets.env (chmod 600) — règle d'audit généralisée ;
 *   - container_name stable (fleet tooling) + labels creezio.server ;
 *   - lecture du store kernel /data (format {plain}).
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

const stack = await import(pathToFileURL(STACK).href);

const BASE_INST = {
  name: "resto-test",
  containerName: "tempoflow3-server-resto-test",
  port: 0,
  bind: "127.0.0.1",
  dataDir: path.join("docker-data", "servers", "resto-test"),
  createdAt: new Date().toISOString(),
  env: { CREEZIO_NATIVE_WARM: "1" },
  stack: true,
};

const CF = {
  CREEZIO_CF_API_TOKEN: "cf-token-secret-123",
  CREEZIO_CF_ACCOUNT_ID: "acc-1",
  CREEZIO_CF_ZONE_ID: "zone-1",
  CREEZIO_CF_ZONE_NAME: "tempoflow.fr",
  CREEZIO_TUNNEL_SLUG: "resto-test",
};

test("M2 stack : ports internes fixes + port hôte loopback auto", () => {
  const yml = stack.renderInstanceCompose({
    brandRoot: "/srv/brand",
    brandId: "tempoflow3",
    image: "creezio-server-tempoflow3:local",
    inst: BASE_INST,
    withCf: true,
  });
  // App interne toujours 18791 ; publication loopback à attribution auto.
  assert.match(yml, /PORT: "18791"/);
  assert.match(yml, /METIER_PORT: "18791"/);
  assert.match(yml, /"127\.0\.0\.1::18791"/);
  assert.doesNotMatch(yml, /0\.0\.0\.0:\d+:18791/);
  // Nom de conteneur stable → fleet tooling (labels, inspect) intact.
  assert.match(yml, /container_name: tempoflow3-server-resto-test/);
  assert.match(yml, /creezio\.server=1/);
  assert.match(yml, /creezio\.stack=compose/);
  // Modèle unique : AUCUN service sidecar cloudflared — l'app
  // auto-provisionne et spawn cloudflared in-process (hors compose).
  assert.doesNotMatch(yml, /^  cloudflared:/m);
  assert.doesNotMatch(yml, /cloudflared\/cloudflared/);
  // Contrat CF via env_file cf.env — jamais en clair dans le YAML.
  assert.match(yml, /env_file:\n      - \.\/cf\.env/);
  assert.doesNotMatch(yml, /CREEZIO_CF_API_TOKEN:/);
  assert.doesNotMatch(yml, /cf-token-secret-123/);
  // Plus aucune trace de l'ancien modèle sidecar/provisioner.
  assert.doesNotMatch(yml, /CREEZIO_TUNNEL_SIDECAR/);
  assert.doesNotMatch(yml, /CREEZIO_TUNNEL_SERVICE_HOST/);
  assert.doesNotMatch(yml, /TUNNEL_TOKEN/);
  assert.doesNotMatch(yml, /tunnel\.env/);
  // Agent hôte joignable depuis le conteneur (extra_hosts host-gateway).
  assert.match(yml, /host\.docker\.internal:host-gateway/);
  // Healthcheck interne au réseau du stack.
  assert.match(yml, /api\/v1\/core\/health/);
});

test("hostPort persisté : 2e writeInstanceStack → même 127.0.0.1:N:18791", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-hp-reuse-"));
  const inst = { ...BASE_INST, hostPort: 0, port: 0 };
  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:v1",
    inst,
    cf: CF,
  });
  const firstYml = fs.readFileSync(stack.composeFilePath(brandRoot, inst), "utf8");
  assert.match(firstYml, /"127\.0\.0\.1::18791"/, "1er create : attribution auto");

  assert.equal(stack.recordedHostPort({ hostPort: 0, port: 32774 }), 32774);
  assert.equal(stack.recordedHostPort({ hostPort: 32774, port: 1 }), 32774);
  assert.equal(stack.recordedHostPort({ hostPort: 0, port: 0 }), 0);

  assert.equal(
    stack.resolveReusableHostPort({ recorded: 32774, busy: false }),
    32774,
    "enregistré + libre → réutilise",
  );
  assert.equal(
    stack.resolveReusableHostPort({
      recorded: 32774,
      ownContainerPort: 32774,
      busy: true,
    }),
    32774,
    "tenu par notre conteneur → réutilise",
  );
  assert.equal(
    stack.resolveReusableHostPort({ recorded: 32774, busy: true }),
    0,
    "occupé par un autre process → nouveau port",
  );
  assert.equal(
    stack.resolveReusableHostPort({ recorded: 0, busy: false }),
    0,
    "aucun enregistré → auto",
  );

  // Instances 0.24–0.25 : seul `port` est rempli — resolve + apply
  // pin le loopback avant write (pas de 127.0.0.1::18791 à l'update).
  const legacy = { ...BASE_INST, name: "legacy-hp", hostPort: 0, port: 32774 };
  const reused = stack.resolveReusableHostPort({
    recorded: stack.recordedHostPort(legacy),
    busy: false,
  });
  stack.applyAllocatedHostPort(legacy, reused);
  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:legacy",
    inst: legacy,
  });
  assert.match(
    fs.readFileSync(stack.composeFilePath(brandRoot, legacy), "utf8"),
    /"127\.0\.0\.1:32774:18791"/,
    "port enregistré sans hostPort → pin compose",
  );

  stack.applyAllocatedHostPort(inst, 32774);
  assert.equal(inst.hostPort, 32774);
  assert.equal(inst.port, 32774);

  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:v2",
    inst,
  });
  const second = fs.readFileSync(stack.composeFilePath(brandRoot, inst), "utf8");
  assert.match(second, /"127\.0\.0\.1:32774:18791"/);
  assert.match(second, /image: img:v2/);

  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:v3",
    inst,
  });
  const third = fs.readFileSync(stack.composeFilePath(brandRoot, inst), "utf8");
  assert.match(third, /"127\.0\.0\.1:32774:18791"/, "2e update → même hostPort");
  assert.match(third, /image: img:v3/);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("stack files 600 : lecture/écriture via I/O privilégié, fail-closed actionnable", async () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-priv-io-"));
  const inst = { ...BASE_INST };
  const files = new Map();
  let sudoCats = 0;
  const io = {
    exists: (p) => files.has(p) || fs.existsSync(p),
    readFile: (p) => {
      if (files.has(p)) return files.get(p);
      sudoCats += 1;
      return fs.readFileSync(p, "utf8");
    },
    writeFile: (p, body) => {
      files.set(p, body);
      fs.writeFileSync(p, body, { mode: 0o600 });
    },
    rmFile: (p) => {
      files.delete(p);
      if (fs.existsSync(p)) fs.rmSync(p);
    },
  };
  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:priv",
    inst,
    cf: CF,
    io,
  });
  const cf = stack.cfEnvPath(brandRoot, inst);
  assert.ok(files.has(cf), "cf.env écrit via I/O injecté (chemin privilégié)");
  assert.match(files.get(cf), /CREEZIO_CF_API_TOKEN=cf-token-secret-123/);

  const { formatStackFileEaccesError, CREEZIO_SERVER_DOCKER_WRAPPER } =
    await import(
      pathToFileURL(path.join(ROOT, "packages/fleet/dist/priv-io.js")).href
    );
  const msg = formatStackFileEaccesError(cf);
  assert.match(msg, /root:root 600/);
  assert.match(msg, /Ne PAS chmod\/chown/);
  assert.match(msg, new RegExp(CREEZIO_SERVER_DOCKER_WRAPPER.replace(/\//g, "\\/")));
  assert.match(msg, /priv-io/);
  assert.match(msg, /update\|migrate-stack\|ensure-owner/);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("M2 stack : hostPort fixe (cas tempoflowadmin — lp tunnel)", () => {
  const yml = stack.renderInstanceCompose({
    brandRoot: "/srv/brand",
    brandId: "tempoflowadmin",
    image: "creezio-server-tempoflowadmin:local",
    inst: { ...BASE_INST, name: "main", containerName: "tempoflowadmin-server-main", hostPort: 18801 },
    withCf: false,
  });
  assert.match(yml, /"127\.0\.0\.1:18801:18791"/);
  assert.doesNotMatch(yml, /^  cloudflared:/m);
  assert.doesNotMatch(yml, /^    env_file:/m);
});

test("M2 stack : sans contrat CF → pas d'env_file", () => {
  const yml = stack.renderInstanceCompose({
    brandRoot: "/srv/brand",
    brandId: "tempoflow3",
    image: "img:local",
    inst: BASE_INST,
    withCf: false,
  });
  assert.doesNotMatch(yml, /^  cloudflared:/m);
  assert.doesNotMatch(yml, /cf\.env/);
  assert.doesNotMatch(yml, /CREEZIO_TUNNEL_SIDECAR/);
});

test("M2 stack : secrets applicatifs → secrets.env 600, jamais dans environment:", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-stack-"));
  const inst = {
    ...BASE_INST,
    env: {
      CREEZIO_NATIVE_WARM: "1",
      N8N_BASIC_AUTH_PASSWORD: "n8n-pass-secret",
      OPENAI_API_KEY: "sk-secret-xyz",
      EMAIL_INBOUND_SECRET: "inbound-secret",
    },
  };
  const { composeFile } = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:local",
    inst,
    cf: CF,
  });
  const yml = fs.readFileSync(composeFile, "utf8");
  // Clés non secrètes : restent dans environment:.
  assert.match(yml, /CREEZIO_NATIVE_WARM: "1"/);
  // Clés secrètes : env_file secrets.env, jamais en clair dans le YAML.
  assert.match(yml, /- \.\/secrets\.env/);
  assert.doesNotMatch(yml, /n8n-pass-secret/);
  assert.doesNotMatch(yml, /sk-secret-xyz/);
  assert.doesNotMatch(yml, /inbound-secret/);
  assert.doesNotMatch(yml, /N8N_BASIC_AUTH_PASSWORD:/);
  assert.doesNotMatch(yml, /OPENAI_API_KEY:/);
  const secretsFile = stack.secretsEnvPath(brandRoot, inst);
  const stat = fs.statSync(secretsFile);
  assert.equal(stat.mode & 0o777, 0o600, "secrets.env doit être 0600");
  const body = fs.readFileSync(secretsFile, "utf8");
  assert.match(body, /N8N_BASIC_AUTH_PASSWORD=n8n-pass-secret/);
  assert.match(body, /OPENAI_API_KEY=sk-secret-xyz/);
  assert.match(body, /EMAIL_INBOUND_SECRET=inbound-secret/);
  assert.doesNotMatch(body, /CREEZIO_NATIVE_WARM/);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("M2 stack : writeInstanceStack écrit cf.env 0600, token hors compose", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-stack-"));
  const inst = { ...BASE_INST };
  const { composeFile, withCf } = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:local",
    inst,
    cf: CF,
  });
  assert.ok(withCf);
  const envFile = stack.cfEnvPath(brandRoot, inst);
  assert.ok(
    envFile.endsWith(path.join("stacks", "resto-test", "cf.env")),
    "cf.env dans le répertoire du stack",
  );
  const stat = fs.statSync(envFile);
  assert.equal(stat.mode & 0o777, 0o600, "cf.env doit être 0600");
  const envBody = fs.readFileSync(envFile, "utf8");
  assert.match(envBody, /CREEZIO_CF_API_TOKEN=cf-token-secret-123/);
  assert.match(envBody, /CREEZIO_CF_ACCOUNT_ID=acc-1/);
  assert.match(envBody, /CREEZIO_CF_ZONE_ID=zone-1/);
  assert.match(envBody, /CREEZIO_TUNNEL_SLUG=resto-test/);
  const yml = fs.readFileSync(composeFile, "utf8");
  assert.ok(!yml.includes("cf-token-secret-123"), "token CF dans compose.yml !");
  // Re-render SANS cf (update) : cf.env existant conservé → env_file gardé.
  const again = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:v2",
    inst,
  });
  assert.ok(again.withCf, "cf.env conservé à l'update");
  const yml2 = fs.readFileSync(composeFile, "utf8");
  assert.match(yml2, /image: img:v2/);
  assert.match(yml2, /- \.\/cf\.env/);
  // cf: null → tunnel désactivé : cf.env supprimé, env_file retiré.
  const off = stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:v3",
    inst,
    cf: null,
  });
  assert.equal(off.withCf, false);
  assert.ok(!fs.existsSync(envFile), "cf.env supprimé");
  assert.doesNotMatch(fs.readFileSync(composeFile, "utf8"), /cf\.env/);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("M2 stack : CREEZIO_OWNER_* / E2E_* → secrets.env, jamais droppés à l'update", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-owner-sec-"));
  const inst = {
    ...BASE_INST,
    env: { CREEZIO_NATIVE_WARM: "1" },
  };
  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:local",
    inst,
    cf: CF,
  });
  stack.persistOwnerSecrets({
    brandRoot,
    inst,
    owner: {
      email: "owner@resto-test.tempoflow.local",
      password: "owner-pass-secret",
      e2eEmail: "e2e@resto-test.tempoflow.local",
      e2ePassword: "e2e-pass-secret",
    },
  });
  const secretsFile = stack.secretsEnvPath(brandRoot, inst);
  const stat = fs.statSync(secretsFile);
  assert.equal(stat.mode & 0o777, 0o600);
  const first = fs.readFileSync(secretsFile, "utf8");
  assert.match(first, /CREEZIO_OWNER_EMAIL=owner@resto-test\.tempoflow\.local/);
  assert.match(first, /CREEZIO_OWNER_PASSWORD=owner-pass-secret/);
  assert.match(first, /CREEZIO_E2E_EMAIL=e2e@resto-test\.tempoflow\.local/);
  const yml = fs.readFileSync(stack.composeFilePath(brandRoot, inst), "utf8");
  assert.doesNotMatch(yml, /owner-pass-secret/);
  assert.doesNotMatch(yml, /CREEZIO_OWNER_EMAIL:/);
  // update rewrite sans owner dans inst.env : les clés restent.
  stack.writeInstanceStack({
    brandRoot,
    brandId: "tempoflow3",
    image: "img:v2",
    inst,
  });
  const again = fs.readFileSync(secretsFile, "utf8");
  assert.match(again, /CREEZIO_OWNER_EMAIL=owner@resto-test\.tempoflow\.local/);
  assert.match(again, /CREEZIO_OWNER_PASSWORD=owner-pass-secret/);
  assert.match(again, /CREEZIO_E2E_PASSWORD=e2e-pass-secret/);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test("M2 stack : splitInstanceEnv classe les clés secrètes", () => {
  const { plain, secret } = stack.splitInstanceEnv({
    BRAND_ID: "x",
    CREEZIO_CF_API_TOKEN: "t",
    MCP_JWT_SECRET: "s",
    N8N_BASIC_AUTH_PASSWORD: "p",
    OPENAI_API_KEY: "k",
    GOOGLE_CREDENTIALS: "c",
    CREEZIO_OWNER_EMAIL: "owner@acme.example",
    CREEZIO_E2E_EMAIL: "e2e@acme.example",
    CREEZIO_NATIVE_WARM: "1",
  });
  assert.deepEqual(Object.keys(secret).sort(), [
    "CREEZIO_CF_API_TOKEN",
    "CREEZIO_E2E_EMAIL",
    "CREEZIO_OWNER_EMAIL",
    "GOOGLE_CREDENTIALS",
    "MCP_JWT_SECRET",
    "N8N_BASIC_AUTH_PASSWORD",
    "OPENAI_API_KEY",
  ]);
  assert.deepEqual(Object.keys(plain).sort(), ["BRAND_ID", "CREEZIO_NATIVE_WARM"]);
});

test("M2 store kernel : readKernelTunnelConfig parse le format {plain}", () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-kc-"));
  const dataDir = path.join(brandRoot, "docker-data", "servers", "resto-test");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "tempoflow3-config.json"),
    JSON.stringify({
      tunnelMeta: {
        slug: "resto-test",
        hostname: "resto-test.tempoflow.fr",
        publicUrl: "https://resto-test.tempoflow.fr",
        tunnelId: "tid-1",
        localPort: 18791,
      },
      tunnelToken: JSON.stringify({ plain: "tok-plain-abc" }),
    }),
  );
  const kc = stack.readKernelTunnelConfig(brandRoot, BASE_INST, "tempoflow3");
  assert.equal(kc.tunnelToken, "tok-plain-abc");
  assert.equal(kc.hostname, "resto-test.tempoflow.fr");
  assert.equal(kc.slug, "resto-test");
  // Token "local" (surface loopback) = pas de tunnel réel → null.
  fs.writeFileSync(
    path.join(dataDir, "tempoflow3-config.json"),
    JSON.stringify({ tunnelMeta: { hostname: "x" }, tunnelToken: JSON.stringify({ plain: "local" }) }),
  );
  assert.equal(stack.readKernelTunnelConfig(brandRoot, BASE_INST, "tempoflow3"), null);
  fs.rmSync(brandRoot, { recursive: true, force: true });
});
