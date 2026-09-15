#!/usr/bin/env node
/**
 * Gate OS — embeds Hermes/n8n + catalogue env (port TF2 hermes-embed / n8n-embed / embed-env).
 * Tests purs platform-core — pas de spawn Electron.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HERMES_DEFAULT_API_PORT,
  N8N_LOCKED_KEYS,
  OS_SANDBOX_LOCKED_KEYS,
  buildHermesHomeEnvFile,
  buildN8nSpawnEnv,
  hermesBinaryCandidates,
  mergeEmbedUserEnv,
  resolveHermesBinary,
  sanitizeHermesEmbedConfig,
  shouldSpawnEmbeddedHermes,
} from "../packages/platform-core/dist/index.js";
import { kitOsVendorDir } from "../packages/platform-core/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("embeds.hermes — sanitize + spawn gate", () => {
  const cfg = sanitizeHermesEmbedConfig(null);
  assert.equal(cfg.mode, "embedded");
  assert.equal(
    shouldSpawnEmbeddedHermes({
      connectionMode: "local",
      hermes: cfg,
    }),
    true,
  );
  assert.equal(
    shouldSpawnEmbeddedHermes({
      connectionMode: "remote",
      hermes: cfg,
    }),
    false,
  );
  assert.ok(HERMES_DEFAULT_API_PORT > 0);
  assert.ok(hermesBinaryCandidates("linux").includes("hermes"));
  assert.ok(hermesBinaryCandidates("win32").includes("hermes.exe"));
});

test("embeds.hermes — resolveBinary sans match → null", () => {
  const bin = resolveHermesBinary({
    platform: process.platform,
    searchDirs: [path.join(ROOT, "scripts")],
    allowEnvOverride: false,
    existsSync: () => false,
  });
  assert.equal(bin, null);
});

test("embeds.hermes — buildHermesHomeEnvFile + bridge CRM", () => {
  const env = buildHermesHomeEnvFile({
    apiKey: "hermes-local-key",
    apiPort: HERMES_DEFAULT_API_PORT,
    bridgeEnv: {
      TEMPOFLOW3_API_KEY: "tf3_live_test",
      TEMPOFLOW3_API_URL: "http://127.0.0.1:18790",
    },
  });
  assert.match(env, /API_SERVER_KEY/);
  assert.match(env, /hermes-local-key/);
  assert.match(env, /TEMPOFLOW3_API_KEY/);
  assert.match(env, /tf3_live_test/);
});

test("embeds.n8n — buildN8nSpawnEnv + locked keys", () => {
  assert.ok(N8N_LOCKED_KEYS.includes("N8N_USER_FOLDER"));
  assert.ok(N8N_LOCKED_KEYS.includes("HOME"));
  assert.ok(OS_SANDBOX_LOCKED_KEYS.includes("PATH"));
  assert.ok(OS_SANDBOX_LOCKED_KEYS.includes("XDG_CACHE_HOME"));
  const env = buildN8nSpawnEnv({
    userFolder: "/tmp/creezio-n8n-home-test",
    port: 5678,
    publicBaseUrl: "http://127.0.0.1:5678",
    encryptionKey: "test-key-32-chars-padding!!!!!!",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(env.N8N_PORT, "5678");
  assert.equal(env.N8N_USER_FOLDER, "/tmp/creezio-n8n-home-test");
  assert.equal(env.N8N_ENCRYPTION_KEY, "test-key-32-chars-padding!!!!!!");
});

test("embeds.env — mergeEmbedUserEnv respecte locked system", () => {
  const merged = mergeEmbedUserEnv({
    service: "n8n",
    systemEnv: { N8N_PORT: "5678", CUSTOM_A: "1" },
    userOverlay: { N8N_PORT: "9999", CUSTOM_A: "2", CUSTOM_B: "3" },
  });
  assert.equal(merged.N8N_PORT, "5678");
  assert.equal(merged.CUSTOM_B, "3");
});

test("embeds.vendors — runtime-manifest hermes + n8n", () => {
  for (const name of ["n8n", "hermes-agent"]) {
    const manifest = path.join(kitOsVendorDir(name), "runtime-manifest.json");
    assert.ok(fs.existsSync(manifest), manifest);
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    assert.ok(m.decision || m.version || m.sha256 || m.webui);
  }
});

test("embeds.skills — skills génériques kit présents (creezio-n8n/plugins)", async () => {
  const { kitHermesSkillsDir } = await import(
    "../packages/host-runtime/dist/index.js"
  );
  for (const name of ["creezio-n8n", "creezio-plugins"]) {
    const skill = path.join(kitHermesSkillsDir(), name, "SKILL.md");
    assert.ok(fs.existsSync(skill), skill);
    const body = fs.readFileSync(skill, "utf8");
    assert.match(body, new RegExp(`name: ${name}`));
    // Frontière : aucun métier marque dans les skills kit.
    assert.ok(!/produits\?limit|releves|fournisseurs/.test(body), name);
  }
});

test("embeds.skills — seedHermesSkillsFromDirs kit + marque idempotent", async () => {
  const { kitHermesSkillsDir, seedHermesSkillsFromDirs } = await import(
    "../packages/host-runtime/dist/index.js"
  );
  const tmp = fs.mkdtempSync(path.join(ROOT, ".tmp-skills-seed-"));
  try {
    const brandDir = path.join(tmp, "brand-skills");
    fs.mkdirSync(path.join(brandDir, "demo-brand-crm"), { recursive: true });
    fs.writeFileSync(
      path.join(brandDir, "demo-brand-crm", "SKILL.md"),
      "---\nname: demo-brand-crm\n---\n",
    );
    // Skill sans SKILL.md → skip explicite.
    fs.mkdirSync(path.join(brandDir, "broken"), { recursive: true });
    const home = path.join(tmp, "hermes-home");
    const seeded = seedHermesSkillsFromDirs({
      hermesHome: home,
      dirs: [kitHermesSkillsDir(), brandDir],
    });
    assert.ok(seeded.includes("creezio-n8n"));
    assert.ok(seeded.includes("creezio-plugins"));
    assert.ok(seeded.includes("demo-brand-crm"));
    assert.ok(!seeded.includes("broken"));
    // Skill tiers préservé + re-seed idempotent.
    fs.mkdirSync(path.join(home, "skills", "user-custom"), { recursive: true });
    fs.writeFileSync(path.join(home, "skills", "user-custom", "SKILL.md"), "x");
    seedHermesSkillsFromDirs({
      hermesHome: home,
      dirs: [kitHermesSkillsDir(), brandDir],
    });
    assert.ok(
      fs.existsSync(path.join(home, "skills", "user-custom", "SKILL.md")),
    );
    assert.ok(
      fs.existsSync(path.join(home, "skills", "creezio-plugins", "SKILL.md")),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("embeds.n8n — owner: pas de faux positif sur instance vierge", async () => {
  const { n8nLoginSucceeded, n8nNeedsOwnerSetup } = await import(
    "../packages/host-runtime/dist/index.js"
  );
  // n8n vierge : /rest/login répond 200 (shell user) SANS cookie de session
  // → JAMAIS un login (vécu : « owner: login OK » sur instance demo vierge,
  // owner jamais provisionné, page /setup blanche).
  assert.equal(n8nLoginSucceeded(200, undefined), false);
  assert.equal(n8nLoginSucceeded(200, []), false);
  assert.equal(n8nLoginSucceeded(200, ["other=1; Path=/"]), false);
  // Login réel : 2xx + cookie n8n-auth.
  assert.equal(
    n8nLoginSucceeded(200, ["n8n-auth=abc.def; Path=/; HttpOnly"]),
    true,
  );
  assert.equal(n8nLoginSucceeded(401, ["n8n-auth=abc; Path=/"]), false);
  // /rest/settings → showSetupOnFirstLoad = signal d'instance vierge.
  assert.equal(
    n8nNeedsOwnerSetup({
      data: { userManagement: { showSetupOnFirstLoad: true } },
    }),
    true,
  );
  assert.equal(
    n8nNeedsOwnerSetup({
      data: { userManagement: { showSetupOnFirstLoad: false } },
    }),
    false,
  );
  assert.equal(n8nNeedsOwnerSetup({ data: {} }), null);
  assert.equal(n8nNeedsOwnerSetup(null), null);
});

test("embeds.hermes — install layout verrouillé sandbox (jamais /usr/local)", async () => {
  const { hermesFhsFallbackDirs, hermesInstallLayoutEnv } = await import(
    "../packages/host-runtime/dist/index.js"
  );
  // Posix : HERMES_INSTALL_DIR force le layout sandbox — l'install.sh amont
  // récent bascule sinon en FHS /usr/local quand il tourne root Linux
  // (containers server-docker) et le launcher ne retrouve jamais le CLI
  // (« CLI toujours introuvable après install », vécu instance demo).
  const posix = hermesInstallLayoutEnv("/data/hermes-runtime/os-profile", "linux");
  assert.equal(posix.HERMES_HOME, "/data/hermes-runtime/os-profile/.hermes");
  assert.equal(
    posix.HERMES_INSTALL_DIR,
    "/data/hermes-runtime/os-profile/.hermes/hermes-agent",
  );
  assert.ok(!posix.HERMES_INSTALL_DIR.startsWith("/usr/local"));
  // Windows : layout LOCALAPPDATA inchangé, pas d'install dir forcé.
  const win = hermesInstallLayoutEnv("C:\\profile", "win32");
  assert.ok(win.HERMES_HOME.includes("hermes"));
  assert.equal(win.HERMES_INSTALL_DIR, undefined);
  // Fallback FHS : uniquement root Linux (containers) — jamais desktop.
  assert.deepEqual(hermesFhsFallbackDirs("linux", 0), [
    "/usr/local/bin",
    "/usr/local/lib/hermes-agent",
  ]);
  assert.deepEqual(hermesFhsFallbackDirs("linux", 1000), []);
  assert.deepEqual(hermesFhsFallbackDirs("darwin", 0), []);
  assert.deepEqual(hermesFhsFallbackDirs("win32", null), []);
});

test("embeds.hermes — serverWebuiPassword (superadmin flotte)", async () => {
  const { serverWebuiPassword } = await import(
    "../packages/host-runtime/dist/index.js"
  );
  const prevPw = process.env.HERMES_WEBUI_PASSWORD;
  const prevSa = process.env.CREEZIO_SUPERADMIN_PASSWORD;
  try {
    delete process.env.HERMES_WEBUI_PASSWORD;
    delete process.env.CREEZIO_SUPERADMIN_PASSWORD;
    assert.equal(serverWebuiPassword(), null);
    process.env.CREEZIO_SUPERADMIN_PASSWORD = "short"; // < 12 → refusé
    assert.equal(serverWebuiPassword(), null);
    process.env.CREEZIO_SUPERADMIN_PASSWORD = "SuperAdmin-Flotte-123456";
    assert.equal(serverWebuiPassword(), "SuperAdmin-Flotte-123456");
    process.env.HERMES_WEBUI_PASSWORD = "explicit-override";
    assert.equal(serverWebuiPassword(), "explicit-override");
  } finally {
    if (prevPw === undefined) delete process.env.HERMES_WEBUI_PASSWORD;
    else process.env.HERMES_WEBUI_PASSWORD = prevPw;
    if (prevSa === undefined) delete process.env.CREEZIO_SUPERADMIN_PASSWORD;
    else process.env.CREEZIO_SUPERADMIN_PASSWORD = prevSa;
  }
});
