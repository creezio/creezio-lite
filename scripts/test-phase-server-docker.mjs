/**
 * Gate — artefacts docker/server + CLI creezio server-docker.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerServer = path.join(root, "docker/server");

test("docker/server artefacts présents", () => {
  for (const f of [
    "Dockerfile",
    "docker-compose.yml",
    "brand.dockerignore",
    "creezio-open-url.sh",
    "README.md",
    "AGENTS.md",
  ]) {
    assert.ok(
      fs.existsSync(path.join(dockerServer, f)),
      `manquant: docker/server/${f}`,
    );
  }
  const opener = fs.readFileSync(
    path.join(dockerServer, "creezio-open-url.sh"),
    "utf8",
  );
  assert.match(opener, /firefox/);
  assert.match(opener, /gio/);
  assert.match(opener, /xdg-open/);
  const df = fs.readFileSync(path.join(dockerServer, "Dockerfile"), "utf8");
  assert.match(df, /brand-kernel-harness/);
  assert.match(df, /CREEZIO_HTTP_HOST/);
  // P1.c : vendor+scripts+bin dans @creezio/host-runtime ; l'image PURGE
  // electron + electron-updater (binaire fat). electron-shell JS reste
  // (splash/boot-progress encore importés par app-runtime).
  assert.match(df, /ELECTRON_SKIP_BINARY_DOWNLOAD=1/);
  assert.match(df, /rm -rf node_modules\/electron/);
  assert.match(df, /electron-updater/);
  assert.doesNotMatch(df, /node_modules\/@creezio\/electron-shell \\/);
  assert.doesNotMatch(df, /TODO \(suivi P1\.c\)/);
  // Chantier embeds : Meili Linux embarqué dans l'image (plus de sql-fallback).
  assert.match(df, /meilisearch-linux-amd64/);
  assert.match(df, /MEILI_BINARY=\/opt\/creezio\/bin\/meilisearch/);
  // Image modulaire par variant : base (défaut) + browser sidecar IA
  // (chromium + xvfb + fonts, env CREEZIO_BROWSER_SIDECAR).
  assert.match(df, /ARG SERVER_VARIANT=base/);
  assert.match(df, /AS runtime-base/);
  assert.match(df, /FROM runtime-base AS runtime-browser/);
  assert.match(df, /FROM runtime-\$\{SERVER_VARIANT\} AS runtime/);
  assert.match(df, /chromium xvfb/);
  assert.match(df, /fonts-liberation/);
  assert.match(df, /libnss3/);
  assert.match(df, /CREEZIO_BROWSER_SIDECAR=1/);
  assert.match(df, /CREEZIO_CHROMIUM_BIN=\/usr\/bin\/chromium/);
  assert.match(df, /CREEZIO_BROWSER_DATA_DIR=\/data\/browser/);
  // Mode npm : npm ci strict (lock garanti par ensure-server-lock) + secret
  // BuildKit pour le token GitHub Packages (jamais en ARG/ENV ni historique).
  assert.match(df, /npm ci --omit=dev/);
  assert.match(df, /--mount=type=secret,id=CREEZIO_NPM_TOKEN/);
  assert.match(df, /--workspace/);
  assert.doesNotMatch(df, /npm install --omit=dev|COPY vendor/);
  // Pas de domaine marque dans l'image générique.
  assert.doesNotMatch(df, /TF3_|TEMPOFLOW|CERTIVAN|FIDU/);
  const compose = fs.readFileSync(
    path.join(dockerServer, "docker-compose.yml"),
    "utf8",
  );
  assert.match(compose, /name:\s*creezio-servers/);
  assert.match(compose, /server-1/);
  assert.match(compose, /server-2/);
  assert.doesNotMatch(compose, /server-[a-z]\b/);
  assert.match(compose, /SERVER_1_PORT/);
  assert.match(compose, /SERVER_2_PORT/);
  // Sécurité : ports publiés sur loopback par défaut (opt-in SERVER_BIND).
  assert.match(compose, /\$\{SERVER_BIND:-127\.0\.0\.1\}:\$\{SERVER_1_PORT:-18791\}/);
  assert.match(compose, /\$\{SERVER_BIND:-127\.0\.0\.1\}:\$\{SERVER_2_PORT:-18792\}/);
  // Build 100% in-image (dockerignore v5) : sources server/ + server/ui
  // dans le contexte ; artefacts hôte (node_modules, .next, build) exclus —
  // l'image rebuild tout, zéro dépendance au node/npm de l'hôte.
  const di = fs.readFileSync(
    path.join(dockerServer, "brand.dockerignore"),
    "utf8",
  );
  assert.match(di, /creezio-dockerignore v5/);
  assert.doesNotMatch(di, /!vendor\//);
  assert.match(di, /^\*\*\/node_modules$/m, "node_modules hôte exclus du contexte");
  assert.match(di, /^\*\*\/\.next$/m, ".next hôte exclu du contexte");
  assert.match(di, /^server\/build$/m, "build hôte exclu du contexte");
  assert.doesNotMatch(di, /^\*\*\/ui$/m, "sources ui exclues — requises in-image");
  assert.doesNotMatch(di, /^\*\*\/src$/m, "sources src exclues — requises in-image");
  assert.doesNotMatch(
    di,
    /\.\.\/\.\.\/node_modules/,
    "artefacts standalone copiés depuis le contexte (v4) — v5 = COPY --from",
  );
  // Dockerfile : le stage brand-build produit build/electron + standalone.
  // ELECTRON_SKIP_BINARY_DOWNLOAD dans deps ET brand-build : electron
  // atterrit dans l arbre prod via le lock (dev=false) ; son postinstall
  // telecharge ~100 Mo sur CDN GitHub flaky (vecu tempoflow 2026-08-12).
  assert.match(df, /ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1[\s\S]*ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1/);
  assert.match(df, /NPM_CONFIG_FETCH_RETRIES=5/);
  assert.match(df, /FROM node:22-bookworm-slim AS brand-build/);
  assert.match(df, /npm run build:runtime --prefix/);
  assert.match(df, /npm run build:ui --prefix/);
  assert.match(df, /COPY --from=brand-build \/app\/\$\{SERVER_DIR\}\/build /);
  assert.match(
    df,
    /COPY --from=brand-build \/app\/\$\{SERVER_DIR\}\/ui\/\.next\/standalone /,
  );
});

test("CLI creezio server-docker help", () => {
  const r = spawnSync(
    process.execPath,
    [path.join(root, "packages/factory/bin/creezio.js"), "server-docker", "--help"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /server-docker/);
  assert.match(r.stdout, /build/);
  assert.match(r.stdout, /proof/);
  assert.match(r.stdout, /SERVER_1_PORT/);
  assert.match(r.stdout, /Server-\{N\}|\.desktop/);
});

test("CLI source : instances numériques + raccourcis bureau", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.match(src, /server-1/);
  assert.match(src, /server-2/);
  assert.match(src, /writeServerDesktopShortcuts/);
  assert.match(src, /ensureCreezioOpenUrl/);
  assert.match(src, /writeOpenCreezioServerN/);
  assert.match(src, /open-creezio-server-/);
  assert.match(src, /creezio-open-url/);
  assert.match(src, /markDesktopTrusted|metadata::trusted/);
  assert.match(src, /StartupNotify=false/);
  assert.match(src, /Desktop/);
  assert.match(src, /Bureau/);
  // Interdit les instances compose en lettres (server-a) — sans matcher
  // les identifiants légitimes type "server-admin".
  assert.doesNotMatch(src, /server-a\b|SERVER_A_PORT/);
  // Plus d'Exec .desktop = xdg-open seul (erreur « No such file »).
  assert.doesNotMatch(src, /Exec=\$?\{?xdg-open/);
  assert.doesNotMatch(src, /`xdg-open '/);
  const sh = fs.readFileSync(
    path.join(root, "docker/server/creezio-open-url.sh"),
    "utf8",
  );
  assert.match(sh, /\.local\/firefox\/firefox/);
  assert.match(sh, /open-server\.log/);
  assert.match(sh, /\/snap\/bin\/firefox/);
});

test("listenBrandOsHttp exporte resolveBrandOsHttpHost", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/listen-brand-os-http.ts"),
    "utf8",
  );
  assert.match(src, /export function resolveBrandOsHttpHost/);
  assert.match(src, /CREEZIO_HTTP_HOST/);
});

test("CLI registre d'instances : create/start/stop/rm/logs/ls/update/backup + admin", () => {
  const r = spawnSync(
    process.execPath,
    [path.join(root, "packages/factory/bin/creezio.js"), "server-docker", "--help"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  for (const sub of [
    "create",
    "start",
    "stop",
    "rm",
    "logs",
    "ls",
    "update",
    "backup",
    "admin",
    "registry-gc",
  ]) {
    assert.match(r.stdout, new RegExp(`\\b${sub}\\b`), `help sans ${sub}`);
  }
  assert.match(r.stdout, /--backup/);
  assert.match(r.stdout, /PAS de nouveau tar\.gz|pas de nouveau tar/);
  assert.match(r.stdout, /servers\.json/);
  assert.match(r.stdout, /127\.0\.0\.1/);
  assert.match(r.stdout, /boot-status/);
  assert.match(r.stdout, /fail-closed|hostname public|CREEZIO_TUNNEL_LOCAL=1/);
  assert.match(r.stdout, /CREEZIO_OWNER_EMAIL/);

  const reg = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-registry.ts"),
    "utf8",
  );
  assert.match(reg, /export function loadServerRegistry/);
  assert.match(reg, /export (async )?function allocateServerPort/);
  assert.match(reg, /export function buildDockerRunArgs/);
  assert.match(reg, /creezio-server-\$\{brandId\}:local/);
  assert.match(reg, /creezio\.server/);
  assert.match(reg, /18790/);
  // Variant browser : image suffixée, shm ≥ 1 Go, label admin.
  assert.match(reg, /-browser:local/);
  assert.match(reg, /--shm-size=1g/);
  assert.match(reg, /creezio\.variant/);
  const cli = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.match(cli, /--browser/);
  assert.match(cli, /SERVER_VARIANT/);
  assert.match(cli, /applyAllocatedHostPort/);
  assert.match(cli, /recordedHostPort/);
  assert.match(cli, /port hôte persisté/);
  assert.match(cli, /priv-io/);
  assert.match(cli, /readTextFileDirectOrSudo/);
  assert.match(cli, /formatStackFileEaccesError/);
  const wrapper = fs.readFileSync(
    path.join(dockerServer, "creezio-server-docker-sudo.sh"),
    "utf8",
  );
  assert.match(wrapper, /priv-io/);
  assert.match(wrapper, /docker-data/);
  assert.doesNotMatch(wrapper, /chmod 666|chmod a\+|chown /);
  const lib = fs.readFileSync(
    path.join(root, "packages/fleet/src/server-lib.ts"),
    "utf8",
  );
  assert.match(lib, /resolveInstanceHostPort/);
  assert.match(lib, /applyAllocatedHostPort/);
  assert.match(lib, /2e update/);
  const agentTun = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-agent-tunnel.ts"),
    "utf8",
  );
  assert.match(agentTun, /CREEZIO_SERVER_DOCKER_WRAPPER/);
  assert.match(agentTun, /priv-io/);
  assert.match(agentTun, /formatStackFileEaccesError/);
  assert.match(cli, /wantBackup = backupEnabled && !!args\.backup/);
  assert.match(cli, /backup: wantBackup/);
  assert.match(cli, /CREEZIO_SERVER_DOCKER_BACKUP/);
  assert.match(cli, /backup skippé \(CREEZIO_SERVER_DOCKER_BACKUP=0\)/);
  assert.doesNotMatch(cli, /noBackup|--no-backup/);
  // P2.b : SoT flotte portée en TS — packages/fleet (wrappers compat retirés).
  assert.match(lib, /backup = false/);
  assert.match(lib, /pas de nouveau backup \(défaut\)/);
  assert.match(lib, /CREEZIO_SERVER_DOCKER_BACKUP/);
  assert.match(lib, /backup skippé \(CREEZIO_SERVER_DOCKER_BACKUP=0\)/);
  assert.match(lib, /export function isServerDockerBackupEnabled/);
  // 0.10.3 : update ne droppe plus un sidecar / hostname public.
  assert.match(lib, /resolveStackUpdatePolicy/);
  assert.match(lib, /preserve-sidecar/);
  assert.match(cli, /allowDropSidecar: true/);
  assert.match(cli, /Jamais de nouvelle adresse à l'update/);
  // Backup via tar en conteneur éphémère (volume root-owned / backups/
  // root-owned : le tar hôte user serait incomplet ou impossible — vécu
  // tempoflow 2026-08-12). Socket docker = seul privilège requis.
  assert.match(lib, /conteneur éphémère/);
  assert.match(lib, /"run",\s*"--rm"/);
  assert.match(lib, /chown \$\{uid\}:\$\{gid\}/);
  assert.doesNotMatch(lib, /pruneBackups\(brandRoot, inst\.name\)/);
  const admin = fs.readFileSync(
    path.join(root, "packages/fleet/src/server-admin.ts"),
    "utf8",
  );
  assert.match(admin, /body\.backup === true/);
});

test("boot progress headless : reporter + early-listen + boot-status", () => {
  const bp = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/boot-progress.ts"),
    "utf8",
  );
  assert.match(bp, /createBootProgressReporter/);
  assert.match(bp, /initOpsJournal/);
  assert.match(bp, /boot-step/); // JSONL docker logs
  assert.match(bp, /SplashViewModel/); // même modèle que le splash desktop

  const early = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/listen-brand-boot-http.ts"),
    "utf8",
  );
  assert.match(early, /\/api\/v1\/os\/boot-status/);
  assert.match(early, /existingServer|listenBrandOsHttp|handoff/i);

  const listen = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/listen-brand-os-http.ts"),
    "utf8",
  );
  assert.match(listen, /\/api\/v1\/os\/boot-status/);
  assert.match(listen, /existingServer/);
  assert.match(listen, /uiProxyTarget/);
  // Ready assoupli en mode Docker (CREEZIO_SKIP_KIT_BINARIES) — vendors soft.
  assert.match(listen, /skipKitBinaries/);
  assert.match(listen, /MEILI_BINARY/);

  const harness = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/start-brand-kernel-harness.ts"),
    "utf8",
  );
  assert.match(harness, /createBootProgressReporter/);
  assert.match(harness, /listenBrandBootHttp/);
  assert.match(harness, /startBrandUiPlane/);
});

test("rm d'instance ne touche JAMAIS un DNS agent (ownership host-agent)", () => {
  const cli = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  const start = cli.indexOf("async function deprovisionInstanceTunnelCf");
  assert.ok(start > 0, "deprovisionInstanceTunnelCf présent");
  const end = cli.indexOf("\nasync function ", start + 1);
  const fn = cli.slice(start, end > start ? end : start + 2500);
  assert.match(fn, /deprovisionCfSlug\(/);
  assert.doesNotMatch(
    fn,
    /deprovisionCfAgentTunnel|agentTunnelDeprovisionDnsHosts/,
    "deprovision instance n'appelle pas le geste agent",
  );
  assert.doesNotMatch(
    fn,
    /agent:\s*true|agent:\s*\{/,
    "aucune option agent sur le déprovision d'instance",
  );
  assert.match(
    cli,
    /action === "rm"/,
    "geste agent rm explicite pour le tunnel/DNS agent",
  );
  assert.match(cli, /deprovisionCfAgentTunnel/);
  const help = spawnSync(
    process.execPath,
    [path.join(root, "packages/factory/bin/creezio.js"), "server-docker", "--help"],
    { encoding: "utf8" },
  );
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /agent down\|status\|rm|agent rm/);
  assert.match(
    help.stdout,
    /server-docker rm d'une instance ne les touche JAMAIS/,
  );
});

test("CREEZIO_SERVER_DOCKER_BACKUP : défaut on, 0/false/off skip", async () => {
  const dist = path.join(root, "packages/factory/dist/server-docker-cli.js");
  assert.ok(
    fs.existsSync(dist),
    "packages/factory/dist/server-docker-cli.js absent — npm run build -w @creezio/factory",
  );
  const {
    isServerDockerBackupEnabled,
    resolveServerDockerBackupEnabled,
    SERVER_DOCKER_BACKUP_ENV,
  } = await import(pathToFileURL(dist).href);
  assert.equal(SERVER_DOCKER_BACKUP_ENV, "CREEZIO_SERVER_DOCKER_BACKUP");
  assert.equal(isServerDockerBackupEnabled(undefined), true);
  assert.equal(isServerDockerBackupEnabled(""), true);
  assert.equal(isServerDockerBackupEnabled("1"), true);
  assert.equal(isServerDockerBackupEnabled("true"), true);
  assert.equal(isServerDockerBackupEnabled("0"), false);
  assert.equal(isServerDockerBackupEnabled("false"), false);
  assert.equal(isServerDockerBackupEnabled("OFF"), false);
  assert.equal(
    resolveServerDockerBackupEnabled({
      processValue: "0",
      fileValue: "1",
    }),
    false,
    "process.env gagne sur le .env marque",
  );
  assert.equal(
    resolveServerDockerBackupEnabled({
      processValue: "",
      fileValue: "0",
    }),
    false,
    ".env marque lu si process unset",
  );
  assert.equal(
    resolveServerDockerBackupEnabled({
      processValue: undefined,
      fileValue: undefined,
    }),
    true,
    "unset = on (prod-safe)",
  );
});

test("publish GHCR : label OCI image.source dans les build args", async () => {
  const dist = path.join(root, "packages/factory/dist/server-docker-cli.js");
  assert.ok(fs.existsSync(dist), "dist factory manquant — build:packages");
  const {
    OCI_IMAGE_SOURCE_LABEL,
    parseGithubHttpsSource,
    requireImageSourceForRegistry,
    ociImageSourceBuildArgs,
    collectDockerBuildArgs,
    resolveBrandGithubSourceUrl,
  } = await import(pathToFileURL(dist).href);

  assert.equal(OCI_IMAGE_SOURCE_LABEL, "org.opencontainers.image.source");
  assert.equal(
    parseGithubHttpsSource("https://github.com/creezio/acme.git"),
    "https://github.com/creezio/acme",
  );
  assert.equal(
    parseGithubHttpsSource("git@github.com:creezio/acme-admin.git"),
    "https://github.com/creezio/acme-admin",
  );
  assert.equal(
    parseGithubHttpsSource(
      "https://x-access-token:secret@github.com/creezio/acme.git",
    ),
    "https://github.com/creezio/acme",
  );
  assert.equal(parseGithubHttpsSource("https://gitlab.com/x/y.git"), null);

  assert.throws(
    () => requireImageSourceForRegistry("ghcr.io", null),
    /org\.opencontainers\.image\.source introuvable/,
  );
  assert.equal(
    requireImageSourceForRegistry("ghcr.io", "https://github.com/creezio/acme"),
    "https://github.com/creezio/acme",
  );
  assert.equal(
    requireImageSourceForRegistry("127.0.0.1:5000", null),
    undefined,
    "registre local : source optionnel",
  );

  const args = collectDockerBuildArgs({
    dockerfile: "/kit/docker/server/Dockerfile",
    serverVariant: "base",
    serverDirRel: "server",
    image: "ghcr.io/example/creezio-server-acme:1.0.0",
    extraTags: ["creezio-server-acme:local"],
    version: "1.0.0",
    imageSource: "https://github.com/creezio/acme",
    brandRoot: "/tmp/acme",
  });
  assert.ok(args.includes("--build-arg"));
  assert.ok(args.includes("IMAGE_SOURCE=https://github.com/creezio/acme"));
  assert.ok(args.includes("--label"));
  assert.ok(
    args.includes(`${OCI_IMAGE_SOURCE_LABEL}=https://github.com/creezio/acme`),
    args.join(" "),
  );
  assert.deepEqual(ociImageSourceBuildArgs(undefined), []);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-oci-src-"));
  try {
    const git = (gitArgs) => {
      const r = spawnSync("git", ["-C", tmp, ...gitArgs], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    };
    git(["init"]);
    git(["remote", "add", "origin", "git@github.com:creezio/acme.git"]);
    assert.equal(
      resolveBrandGithubSourceUrl(tmp),
      "https://github.com/creezio/acme",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const df = fs.readFileSync(path.join(dockerServer, "Dockerfile"), "utf8");
  assert.match(df, /ARG IMAGE_SOURCE/);
  assert.match(df, /LABEL org\.opencontainers\.image\.source=\$\{IMAGE_SOURCE\}/);
  const cli = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.match(cli, /requireImageSourceForRegistry/);
  assert.match(cli, /resolveBrandGithubSourceUrl/);
  assert.match(cli, /imageSource/);
});
