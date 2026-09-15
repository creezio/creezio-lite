/**
 * CLI `creezio server-docker` — serveurs marque headless (Docker).
 *
 * Deux modes :
 *   - registre : create/start/stop/rm/logs/ls (docker run piloté par
 *     docker-data/servers.json — multi-marques, ports auto, bind 127.0.0.1)
 *   - compose  : build/up/down/ps/proof (legacy server-1/server-2)
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  allocateServerPort,
  buildDockerRunArgs,
  instanceDataDirAbs,
  loadServerRegistry,
  saveServerRegistry,
  serverContainerName,
  serverImageName,
  validInstanceName,
  type ServerRegistryInstance,
} from "./server-docker-registry.js";
import {
  ensureBrandPackageLocks,
  isPackageLockInSync,
} from "./package-lock.js";
import {
  CREATE_TUNNEL_ENV_KEYS,
  applyAdminPublicTunnelDefaults,
  extraHostnamesKey,
  formatDerivedSlugLog,
  isAdminBrandId,
  loadReservedSlugs,
  pickEnvValues,
  resolveCreateTunnelPolicy,
  resolveMigrateStackPlan,
  type CreateTunnelPolicy,
} from "./server-docker-tunnel.js";
import {
  CREATE_OWNER_ENV_KEYS,
  E2E_OWNER_ENV_KEYS,
  applyFirstRunOwner,
  assertInteractiveDemoScenarios,
  defaultE2eEmail,
  fetchSetupStatus,
  formatOwnerLoginLog,
  generateOwnerPassword,
  resolveCreateOwnerPolicy,
  resolveEnsureOwnerCreds,
  applyAccessOverridesViaContainer,
  seedKitUserViaContainer,
  verifyOwnerLogin,
  type CreateOwnerPolicy,
} from "./server-docker-owner.js";
import { assertUfwFleetRule } from "./server-docker-ufw.js";
import {
  AGENT_TUNNEL_CONTAINER,
  agentTunnelEnvPath,
  applyDedicatedAgentUrlToHostState,
  canonicalDedicatedAgentUrl,
  discoverFleetHostsJsonPaths,
  needsDedicatedAgentTunnelMigration,
  parseAgentPublicUrl,
  persistDedicatedAgentUrlInFleetHostsFile,
  formatFleetHostsEaccesError,
  formatStackFileEaccesError,
  isFsPermissionError,
  readTextFileDirectOrSudo,
  buildAgentTunnelRunArgs,
  renderAgentTunnelEnvFile,
  resolveAgentTunnelImage,
} from "./server-docker-agent-tunnel.js";
import {
  isGhcrRegistry,
  runGhcrGcCommand,
  runGhcrPublishRetention,
} from "./server-docker-ghcr-gc.js";
import {
  parseImageRef,
  REGISTRY_GC_DEFAULT_HOST,
  runRegistryGcCommand,
  selectTagsToPrune,
  serversFileImageRefs,
} from "./server-docker-registry-gc.js";

export { compareVersionTags, selectTagsToPrune } from "./server-docker-registry-gc.js";

/**
 * VPS (pas tunnel-local) : n8n ET Hermes sont requis (kit Creezio).
 * `CREEZIO_NATIVE_WARM=0` / `CREEZIO_NATIVE_WARM_N8N=0` /
 * `CREEZIO_NATIVE_WARM_HERMES=0` sont ignorés (no-op) avec un warn.
 * Le skip reste possible uniquement en `CREEZIO_TUNNEL_LOCAL=1` (dev).
 */
export function applyVpsNativeWarmDefaults(
  env: Record<string, string>,
): Record<string, string> {
  const out = { ...env };
  const ignored: string[] = [];
  if (out.CREEZIO_NATIVE_WARM === "0") ignored.push("CREEZIO_NATIVE_WARM=0");
  if (out.CREEZIO_NATIVE_WARM_N8N === "0") {
    ignored.push("CREEZIO_NATIVE_WARM_N8N=0");
  }
  if (out.CREEZIO_NATIVE_WARM_HERMES === "0") {
    ignored.push("CREEZIO_NATIVE_WARM_HERMES=0");
  }
  if (ignored.length) {
    console.warn(`ignoré, n8n/hermes requis : ${ignored.join(", ")}`);
  }
  out.CREEZIO_NATIVE_WARM = "1";
  out.CREEZIO_NATIVE_WARM_HERMES = "1";
  // Forcer =1 (pas seulement retirer =0) : l'image Docker peut avoir
  // CREEZIO_NATIVE_WARM_N8N=0 en ENV — un compose sans la clé hériterait du skip.
  out.CREEZIO_NATIVE_WARM_N8N = "1";
  return out;
}

/** Kill-switch backups `server-docker` (update --backup, backup one-shot, migrate-stack). */
export const SERVER_DOCKER_BACKUP_ENV = "CREEZIO_SERVER_DOCKER_BACKUP";

const BACKUP_SKIPPED_WARN = "backup skippé (CREEZIO_SERVER_DOCKER_BACKUP=0)";

/**
 * Défaut **on** (prod-safe). `0` / `false` / `off` = skip.
 * L'env gagne sur `--backup` (phase dev sans données client).
 */
export function isServerDockerBackupEnabled(
  raw: string | undefined | null = process.env.CREEZIO_SERVER_DOCKER_BACKUP,
): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/**
 * process.env gagne sur le `.env` marque. Unset des deux côtés = on.
 */
export function resolveServerDockerBackupEnabled(opts?: {
  processValue?: string | undefined;
  fileValue?: string | undefined;
}): boolean {
  const processValue =
    opts && "processValue" in opts
      ? opts.processValue
      : process.env.CREEZIO_SERVER_DOCKER_BACKUP;
  const fileValue = opts?.fileValue;
  const raw =
    String(processValue ?? "").trim() || String(fileValue ?? "").trim();
  return isServerDockerBackupEnabled(raw);
}

function warnBackupSkipped(): void {
  console.warn(BACKUP_SKIPPED_WARN);
}

function brandServerDockerBackupEnabled(brandRoot: string): boolean {
  const file = readEnvFileValues(path.join(brandRoot, ".env"));
  return resolveServerDockerBackupEnabled({
    processValue: process.env.CREEZIO_SERVER_DOCKER_BACKUP,
    fileValue: file.CREEZIO_SERVER_DOCKER_BACKUP,
  });
}

export type ServerDockerArgs = {
  sub: string;
  brandRoot?: string;
  project?: string;
  kitRoot?: string;
  help?: boolean;
  noBuild?: boolean;
  /** create : port explicite (sinon auto 18790+n). */
  port?: number;
  /** create : bind hôte (défaut 127.0.0.1 ; --expose = 0.0.0.0). */
  bind?: string;
  /** create : env additionnels K=V. */
  env: Record<string, string>;
  /** create : warm n8n/Hermes dans le container. */
  warm?: boolean;
  /**
   * create : profil de défauts env. `prod` = serveur flotte (warm natif +
   * catalogue + forward des env tunnel/fleet/crash présents sur l'hôte).
   * Les défauts test/CI restent inchangés sans profil.
   */
  profile?: "prod";
  /** create : variant browser (Chromium sidecar IA, shm 1 Go). */
  browser?: boolean;
  /** rm : supprimer aussi le volume data. */
  purgeData?: boolean;
  /** logs : nombre de lignes (défaut 200). */
  tail?: number;
  /** logs : suivre. */
  follow?: boolean;
  /**
   * update / backup : forcer un tar.gz frais de `/data` (opt-in — défaut
   * update = pas de nouveau backup ; archives existantes conservées).
   */
  backup?: boolean;
  /** update : image complète (registry/repo:tag). */
  image?: string;
  /** publish / update : tag de version (ex. 0.2.0). */
  tag?: string;
  /** publish : registre (défaut env CREEZIO_REGISTRY, ex. 127.0.0.1:5000). */
  registry?: string;
  /** publish : build seulement, pas de push. */
  noPush?: boolean;
  /** publish : nombre de tags conservés après rétention (défaut 5). */
  keepTags?: number;
  /** publish : désactiver la rétention post-push (images/tags/cache). */
  noRetention?: boolean;
  /**
   * publish : hôte public du registre (ex. registry.{zone}) — tague en plus
   * l'image avec la référence publique pull-only (F4). Défaut env
   * CREEZIO_REGISTRY_PUBLIC_HOST.
   */
  publicHost?: string;
  /**
   * publish : déclarer la release dans l'app admin après le push (F5) —
   * POST /api/v1/modules/fleet-releases/releases (status draft).
   */
  release?: boolean;
  /** publish --release / enroll : canal de release (défaut stable). */
  channel?: string;
  /**
   * URL de l'APP admin de marque (module fleet-releases) — publish --release
   * et enroll (state agent). Défaut env CREEZIO_FLEET_ADMIN_URL.
   */
  adminApp?: string;
  /** enroll : URL de l'admin flotte (https://admin.{zone}). */
  admin?: string;
  /** enroll : token d'enrôlement généré côté admin. */
  token?: string;
  /** enroll : slug tunnel du serveur (ingress agent.{slug}). */
  slug?: string;
  /** enroll / agent : label lisible (hôte, token). */
  label?: string;
  /** registry-gc : container `registry:2` (défaut creezio-registry). */
  container?: string;
  /** registry-gc : limiter à un repository. */
  repo?: string;
  /** registry-gc : exécuter les mutations (défaut : dry-run). */
  apply?: boolean;
  /** registry-gc : dry-run explicite (déjà le défaut — exclusif avec --apply). */
  dryRun?: boolean;
  /** enroll : URL agent explicite (sinon ingress agent posée via API CF). */
  agentUrl?: string;
  /** agent up : hôtes d'écoute (défaut 127.0.0.1,172.17.0.1). */
  bindHosts?: string;
  /** admin up : racine admin indépendante du brand-root (repo admin dédié). */
  adminRoot?: string;
  /**
   * create : stack compose autonome app+cloudflared (M2) — DÉFAUT.
   * --no-stack = legacy `docker run` (port hôte fixe registre).
   */
  stack?: boolean;
  noStack?: boolean;
  /** create/migrate-stack : port hôte loopback FIXE (défaut 0 = auto). */
  hostPort?: number;
  /** access : e-mail du compte cible. */
  user?: string;
  /** access : permissions à accorder (liste séparée par virgules). */
  grant?: string;
  /** access : permissions à refuser (liste séparée par virgules). */
  revoke?: string;
  /** access : effacer tous les overrides du compte avant grant/revoke. */
  reset?: boolean;
  /** access : rôle access-control à poser (`none` = rôle plateforme). */
  role?: string;
  rest: string[];
};

/** Instances Compose par défaut (chiffres — pas de lettres). */
export type ServerInstance = {
  id: string;
  n: number;
  portEnv: string;
  defaultPort: number;
};

export const DEFAULT_SERVER_INSTANCES: ServerInstance[] = [
  { id: "server-1", n: 1, portEnv: "SERVER_1_PORT", defaultPort: 18791 },
  { id: "server-2", n: 2, portEnv: "SERVER_2_PORT", defaultPort: 18792 },
];

function kitRootDefault(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

export function parseServerDockerArgs(argv: string[]): ServerDockerArgs {
  const rest = [...argv];
  const out: ServerDockerArgs = {
    sub: rest.shift() || "",
    rest: [],
    env: {},
    project: "creezio-servers",
  };
  while (rest.length) {
    const a = rest.shift()!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--no-build") out.noBuild = true;
    else if (a === "--expose") out.bind = "0.0.0.0";
    else if (a === "--warm") out.warm = true;
    else if (a === "--browser") out.browser = true;
    else if (a.startsWith("--profile=")) {
      out.profile = a.slice(10) as ServerDockerArgs["profile"];
    } else if (a === "--profile") {
      out.profile = (rest.shift() || "") as ServerDockerArgs["profile"];
    }
    else if (a === "--stack") out.stack = true;
    else if (a === "--no-stack") out.noStack = true;
    else if (a.startsWith("--host-port=")) out.hostPort = Number(a.slice(12));
    else if (a === "--host-port") out.hostPort = Number(rest.shift());
    else if (a === "--purge-data") out.purgeData = true;
    else if (a === "--backup") out.backup = true;
    else if (a === "--follow" || a === "-f") out.follow = true;
    else if (a === "--no-push") out.noPush = true;
    else if (a === "--no-retention") out.noRetention = true;
    else if (a.startsWith("--image=")) out.image = a.slice(8);
    else if (a === "--image") out.image = rest.shift();
    else if (a.startsWith("--keep-tags=")) out.keepTags = Number(a.slice(12));
    else if (a === "--keep-tags") out.keepTags = Number(rest.shift());
    else if (a.startsWith("--keep=")) out.keepTags = Number(a.slice(7));
    else if (a === "--keep") out.keepTags = Number(rest.shift());
    else if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--container=")) out.container = a.slice(12);
    else if (a === "--container") out.container = rest.shift();
    else if (a.startsWith("--repo=")) out.repo = a.slice(7);
    else if (a === "--repo") out.repo = rest.shift();
    else if (a.startsWith("--tag=")) out.tag = a.slice(6);
    else if (a === "--tag") out.tag = rest.shift();
    else if (a.startsWith("--registry=")) out.registry = a.slice(11);
    else if (a === "--registry") out.registry = rest.shift();
    else if (a.startsWith("--public-host=")) out.publicHost = a.slice(14);
    else if (a === "--public-host") out.publicHost = rest.shift();
    else if (a === "--release") out.release = true;
    else if (a.startsWith("--channel=")) out.channel = a.slice(10);
    else if (a === "--channel") out.channel = rest.shift();
    else if (a.startsWith("--admin-app=")) out.adminApp = a.slice(12);
    else if (a === "--admin-app") out.adminApp = rest.shift();
    else if (a.startsWith("--admin=")) out.admin = a.slice(8);
    else if (a === "--admin") out.admin = rest.shift();
    else if (a.startsWith("--token=")) out.token = a.slice(8);
    else if (a === "--token") out.token = rest.shift();
    else if (a.startsWith("--slug=")) out.slug = a.slice(7);
    else if (a === "--slug") out.slug = rest.shift();
    else if (a.startsWith("--label=")) out.label = a.slice(8);
    else if (a === "--label") out.label = rest.shift();
    else if (a.startsWith("--agent-url=")) out.agentUrl = a.slice(12);
    else if (a === "--agent-url") out.agentUrl = rest.shift();
    else if (a.startsWith("--bind-hosts=")) out.bindHosts = a.slice(13);
    else if (a === "--bind-hosts") out.bindHosts = rest.shift();
    else if (a.startsWith("--admin-root=")) out.adminRoot = a.slice(13);
    else if (a === "--admin-root") out.adminRoot = rest.shift();
    else if (a.startsWith("--port=")) out.port = Number(a.slice(7));
    else if (a === "--port") out.port = Number(rest.shift());
    else if (a.startsWith("--bind=")) out.bind = a.slice(7);
    else if (a === "--bind") out.bind = rest.shift();
    else if (a.startsWith("--tail=")) out.tail = Number(a.slice(7));
    else if (a === "--tail") out.tail = Number(rest.shift());
    else if (a.startsWith("--user=")) out.user = a.slice(7);
    else if (a === "--user") out.user = rest.shift();
    else if (a.startsWith("--grant=")) out.grant = a.slice(8);
    else if (a === "--grant") out.grant = rest.shift();
    else if (a.startsWith("--revoke=")) out.revoke = a.slice(9);
    else if (a === "--revoke") out.revoke = rest.shift();
    else if (a === "--reset") out.reset = true;
    else if (a.startsWith("--role=")) out.role = a.slice(7);
    else if (a === "--role") out.role = rest.shift();
    else if (a.startsWith("--env=")) {
      const kv = a.slice(6);
      const i = kv.indexOf("=");
      if (i > 0) out.env[kv.slice(0, i)] = kv.slice(i + 1);
    } else if (a === "--env") {
      const kv = rest.shift() || "";
      const i = kv.indexOf("=");
      if (i > 0) out.env[kv.slice(0, i)] = kv.slice(i + 1);
    } else if (a.startsWith("--brand-root="))
      out.brandRoot = a.slice("--brand-root=".length);
    else if (a === "--brand-root") out.brandRoot = rest.shift();
    else if (a.startsWith("--project="))
      out.project = a.slice("--project=".length);
    else if (a === "--project") out.project = rest.shift();
    else if (a.startsWith("--kit-root="))
      out.kitRoot = a.slice("--kit-root=".length);
    else if (a === "--kit-root") out.kitRoot = rest.shift();
    else out.rest.push(a);
  }
  return out;
}

export function printServerDockerHelp(): void {
  console.log(`creezio server-docker — serveurs marque headless (Docker)

Instances nommées (registre docker-data/servers.json — recommandé) :
  creezio server-docker create <nom> --brand-root <app> [--port N] [--expose] [--warm] [--browser] [--profile prod] [--env K=V]…
    --browser : image variant browser (Chromium+Xvfb, sidecar navigateur IA,
                profils /data/browser, shm 1 Go)
    --profile prod : serveur flotte — CREEZIO_NATIVE_WARM=1 + n8n + Hermes + CREEZIO_CATALOG=1
                + fail-closed tunnel (CREEZIO_CF_API_TOKEN/_ACCOUNT_ID/_ZONE_ID
                → cf.env 600, auto-provision au boot) + fail-closed owner
                (CREEZIO_OWNER_EMAIL/_PASSWORD) + forward env hôte
                CREEZIO_FLEET_ENDPOINT, CREEZIO_CRASH_ENDPOINT, CREEZIO_PLUGINS,
                EMAIL_INBOUND_SECRET, EMAIL_DOMAIN, MAIL_*/SMTP_*/RESEND_*,
                OPENAI_API_KEY, ANTHROPIC_API_KEY,
                CREEZIO_FLEET_ADMIN_URL/_REGISTER_SECRET/_HOST_ID,
                CREEZIO_FLEET_BACKEND_URL/_BACKEND_BASIC
    create VPS : CREEZIO_CF_API_TOKEN/_ACCOUNT_ID/_ZONE_ID + CREEZIO_OWNER_EMAIL/
                _PASSWORD requis (sinon échec — jamais de succès sans hostname
                public ni compte owner utilisable). Slug réservé (demo…)
                → CREEZIO_TUNNEL_SLUG=<brand>-<slug> (log + cf.env).
                Dev local : CREEZIO_TUNNEL_LOCAL=1 (owner optionnel)
  creezio server-docker start  <nom> --brand-root <app>
  creezio server-docker stop   <nom> --brand-root <app>
  creezio server-docker rm     <nom> --brand-root <app> [--purge-data]
  creezio server-docker logs   <nom> --brand-root <app> [--tail 200] [--follow]
  creezio server-docker ls     --brand-root <app>
  creezio server-docker update <nom> --brand-root <app> --image <ref>|--tag <v>
    [--backup] [--registry 127.0.0.1:5000]
    (recreate même volume /data ; défaut = PAS de nouveau tar.gz.
     --backup : snapshot frais avant recreate — prod critique seulement.
     CREEZIO_SERVER_DOCKER_BACKUP=0 (aussi false/off) : ignore --backup
     et skip backup one-shot / migrate-stack (dev ; défaut on).
     Archives déjà dans docker-data/backups/ sont conservées.
     Sidecar cloudflared historique : CONSERVÉ (même tunnel, même adresse
     publique). Adresse publique persistée sans sidecar → REFUS (rien
     n'est touché). Jamais de nouvelle adresse à l'update.
     Dev local CREEZIO_TUNNEL_LOCAL=1 : inchangé.)
  creezio server-docker backup <nom> --brand-root <app>
    (one-shot : tar.gz de référence de /data → docker-data/backups/ —
     à faire une fois ; les updates suivants ne le remplacent pas.)
  creezio server-docker ensure-owner <nom> --brand-root <app>
    (rattrapage / seed : first-run si setup incomplet, sinon vérifie le
     login ; persiste CREEZIO_OWNER_* + CREEZIO_E2E_* optionnels dans
     secrets.env 600 — jamais dans le registre ni les logs. Recrée
     uniquement le service app pour injecter l'env, sidecar intact.
     Fail-closed create VPS inchangé : owner toujours requis au create.)
  creezio server-docker access <nom> --brand-root <app> --user <email>
    [--grant nav.billing,nav.clients] [--revoke nav.fleet] [--reset]
    [--role <id>|none]
    (permissions PAR MODULE d'un compte — bootstrap sans UI du système
     « Rôles & accès » (@creezio/access-control) : overrides par compte
     écrits dans core.db (audit actor server-docker-cli), effet ≤ 30 s.
     Sans --grant/--revoke/--reset/--role : affiche l'état du compte.
     Owner = bypass kit, non concerné. UI équivalente : OS → Admin →
     Rôles & accès, onglet Comptes.)

Stack compose autonome (modèle standard — cloudflared in-process) :
  create génère par défaut un stack compose par instance : app seule (port
  interne fixe 18791, cloudflared in-process), cf.env + secrets.env chmod
  600 (jamais de secret dans le compose), port hôte loopback persisté
  dans servers.json (premier up : auto 127.0.0.1::18791, puis réutilisé
  à chaque update — plus de 32774→32776→…). Zéro port public.
    --no-stack : legacy docker run (port hôte fixe du registre)
    --host-port N : port hôte loopback FIXE au lieu de l'attribution auto
  Fichiers stack root:root 600 (cf.env, secrets.env) : le CLI lit/écrit
  via sudo -n / /usr/local/sbin/creezio-server-docker priv-io (fail-closed
  si sudo impossible — jamais un chmod one-shot).
  creezio server-docker migrate-stack <nom> --brand-root <app> [--host-port N]
    (bascule une instance sidecar ou legacy en stack in-process : backup
     /data obligatoire → cf.env écrit (CREEZIO_CF_* requis — env hôte ou
     .env marque) → compose up : le kernel RÉUTILISE le tunnel / hostname
     existants. Repo admin : aligne CREEZIO_DOMAIN=admin.{zone} +
     EXTRA_HOSTNAMES=lp.{zone} (sync-cf si déjà in-process). Health →
     rollback si KO. Token tunnel lu du store kernel /data — jamais
     affiché. Seul chemin autorisé à retirer un sidecar cloudflared.
     Pas de NPM / sidecar / 2e stratégie publique.)
  creezio server-docker rm <nom> : déprovisionne aussi le tunnel Cloudflare
    (DNS + tunnel via API CF directe, best-effort) si CREEZIO_CF_* posés.

Admin web multi-serveurs / multi-VPS (backend @creezio/fleet) :
  creezio server-docker admin up|down|status --brand-root <app> [--port 18800]
  creezio server-docker admin up --admin-root <repo-admin> [--brand-root <app>]
    (repo admin dédié : config server-admin.json + fleet-hosts.json à la racine)
  creezio server-docker admin add-brand <brandRoot> --brand-root <app>
    (ajoute une marque au server-admin.json + recreate le container admin)

Registry d'images versionnées (update de flotte) :
  creezio server-docker publish --brand-root <app> --tag <version>
    [--registry 127.0.0.1:5000] [--browser] [--no-push]
    [--keep-tags 5] [--no-retention] [--public-host registry.<zone>]
    [--release [--admin-app <url>] [--channel stable]]
    (build image versionnée <registry>/creezio-server-<brand>:<tag>
     + label/env version — /api/v1/core/version affiche <version> ;
     + org.opencontainers.image.source dérivé du remote git origin
     du brand-root — fail-closed si registre ghcr.io et remote introuvable)
    --public-host (ou env CREEZIO_REGISTRY_PUBLIC_HOST) : tague en plus la
    référence publique pull-only registry.<zone>/… (F4) — le push reste
    loopback-only, les VPS distants pullent via l'ingress authentifié.
    --release (F5) : déclare la release (status draft) dans l'app admin
    (--admin-app ou env CREEZIO_FLEET_ADMIN_URL) — les agents en pull
    l'appliquent quand elle passe rolling (pilotage /flotte).
    Rétention après push réussi : PAR FAMILLE — N derniers auto.* (défaut 2,
    env CREEZIO_PUBLISH_KEEP_TAGS) ET au moins les 3 derniers semver
    (indépendants : une rafale auto.* n'évince jamais un semver). Jamais le
    tag référencé par docker-data/servers.json / instances. Daemon local ET
    registre privé + docker builder prune --max-used-space
    (env CREEZIO_PUBLISH_KEEP_STORAGE, défaut 5GB). Cible ghcr.io : API
    GitHub Packages (versions) — au moins 3 semver + jamais un tag in-use /
    servers.json ; auth manquante = fail-closed (GHCR_TOKEN / GITHUB_TOKEN /
    .github-token). Blobs local : registry-gc / timer hôte.
  creezio server-docker registry-gc [--registry 127.0.0.1:5000|ghcr.io/<owner>]
    [--keep 2] [--container creezio-registry] [--repo <name>]
    [--brand-root <app>] [--admin-app <url>] [--apply]
    (GC fail-closed. Registre local registry:2 : API v2 + garbage-collect.
     Cible ghcr.io/<owner> : API GitHub Packages versions — même politique
     (3 semver min, jamais in-use / servers.json / releases), auth
     obligatoire. Garde les N plus récents PAR FAMILLE — auto.* d'un côté,
     semver de l'autre (plancher 3) ; défaut 2, env CREEZIO_REGISTRY_GC_KEEP
     — ET tout tag PROTÉGÉ : conteneur en cours (docker ps),
     docker-data/servers.json (--brand-root + labels creezio.brand-root,
     instances arrêtées incluses), releases fleet (--admin-app /
     CREEZIO_FLEET_ADMIN_URL, admin injoignable = refus).
     DRY-RUN PAR DÉFAUT : plan seulement — --apply exécute. Jamais de
     suppression d'un tag en usage ou référencé.)

Agent hôte flotte (VPS restaurant — exposé via agent.{slug}.{zone}) :
  creezio server-docker agent up --brand-root <app> [--port 18810]
    [--bind-hosts 127.0.0.1,172.17.0.1] [--slug <slug>]
    (relance le connecteur du tunnel dédié si agent-tunnel.env existe ;
     si l'hôte est déjà enrôlé sans tunnel dédié, migre automatiquement)
  creezio server-docker agent down|status|rm --brand-root <app>
    (rm = déprovisionne le tunnel dédié + DNS agent.* / agent-* ;
     server-docker rm d'une instance ne les touche JAMAIS)
  creezio server-docker agent token new [--label admin] --brand-root <app>
  creezio server-docker agent token revoke <id> --brand-root <app>
  creezio server-docker enroll --brand-root <app> --admin <url-admin>
    --token <enrollToken> [--slug <slug>] [--label <label>] [--agent-url <url>]
    [--admin-app <url app admin>]  (F5 : updates en pull — pose
    adminAppUrl + fleetKey dans le state agent ; recréer via agent up)
    (T7 : provisionne un tunnel Cloudflare DÉDIÉ agent — nom CF
     creezio-agent-<slug>, container creezio-agent-tunnel network host,
     token dans docker-data/agent-tunnel.env 600 — puis bascule le CNAME
     agent.{slug}/agent-{slug}. Respawn surveillé par le host-agent.
     + enregistre l'hôte auprès de l'admin — token agent hashé, révocable)

Compose legacy (server-1 / server-2) :
  creezio server-docker build  --brand-root <app> [--kit-root <kit>]
  creezio server-docker up     --brand-root <app> [--project creezio-servers] [--no-build]
  creezio server-docker down   --brand-root <app> [--project creezio-servers]
  creezio server-docker ps     [--project creezio-servers]
  creezio server-docker proof  --brand-root <app>   # up + curl health server-1/2 + .desktop

Sécurité : ports publiés sur 127.0.0.1 par défaut — --expose ou SERVER_BIND=0.0.0.0 pour ouvrir.
Image par marque : creezio-server-<brandId>:local (multi-marques sans collision).

Env:
  BRAND_ROOT, CREEZIO_KIT_ROOT, BRAND_ID, SERVER_BIND, SERVER_1_PORT, SERVER_2_PORT
  DATA_DIR (volumes SQLite isolés : …/server-1, …/server-2)
  SERVER_DESKTOP_PRODUCT  (override nom raccourcis, défaut brandName BrandSpec)

Après up/create : GET /api/v1/os/boot-status = progression du boot (splash JSON).
Après up : raccourcis ~/Desktop et ~/Bureau → {Product}-Server-{N}.desktop
  Exec = ~/bin/open-creezio-server <url> (wrapper firefox/chromium/xdg-open/gio)

Doc: docker/server/README.md
`);
}

function ensureDocker(): void {
  const d = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (d.status !== 0) {
    throw new Error(
      "docker introuvable — installer Docker Engine + plugin compose",
    );
  }
  const c = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (c.status !== 0) {
    throw new Error("docker compose introuvable — installer le plugin Compose v2");
  }
}

/**
 * Contexte de build stagé pour les images server-admin / host-agent (P2.b).
 *
 * Le backend flotte vit compilé dans `packages/fleet/dist`
 * (`@creezio/fleet`) ; `fleet-collector/` ne garde que le collector
 * télémétrie (les wrappers de compat ont été retirés en 0.19). Les
 * Dockerfiles (CMD `node_modules/@creezio/fleet/dist/bin/*-main.js`)
 * attendent donc un contexte = fleet-collector/ + le package fleet posé
 * sous `node_modules/@creezio/fleet` (package.json + dist + public).
 * Fail-closed si le dist fleet est absent/incomplet (dist stale interdit).
 */
function stageFleetImageContext(kit: string): string {
  const collector = path.join(kit, "packages/observability/fleet-collector");
  const fleetPkg = path.join(kit, "packages/fleet");
  const fleetDist = path.join(fleetPkg, "dist");
  for (const required of [
    path.join(fleetDist, "bin", "server-admin-main.js"),
    path.join(fleetDist, "bin", "host-agent-main.js"),
    path.join(fleetPkg, "public", "admin.html"),
  ]) {
    if (!fs.existsSync(required)) {
      throw new Error(
        `@creezio/fleet dist incomplet (${required} absent) — lancer \`npm run build:packages\` dans le kit avant server-docker admin|agent up`,
      );
    }
  }
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-fleet-ctx-"));
  fs.cpSync(collector, staged, { recursive: true });
  const dest = path.join(staged, "node_modules", "@creezio", "fleet");
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(
    path.join(fleetPkg, "package.json"),
    path.join(dest, "package.json"),
  );
  fs.cpSync(fleetDist, path.join(dest, "dist"), { recursive: true });
  fs.cpSync(path.join(fleetPkg, "public"), path.join(dest, "public"), {
    recursive: true,
  });
  return staged;
}

/**
 * Module stack compose — SoT `@creezio/fleet/instance-stack`
 * (packages/fleet/src/instance-stack.ts), consommée directement depuis le
 * dist du clone kit (les wrappers fleet-collector ont été retirés en 0.19).
 * Import dynamique : le module vit dans le clone kit du VPS (pas de dist
 * factory).
 */
async function importInstanceStack(kit: string) {
  const p = path.join(kit, "packages/fleet/dist/instance-stack.js");
  if (!fs.existsSync(p)) {
    throw new Error(
      `instance-stack introuvable: ${p} — lancer \`npm run build:packages\` dans le kit`,
    );
  }
  return (await import(pathToFileURL(p).href)) as {
    STACK_APP_PORT: number;
    CF_ENV_KEYS: string[];
    stackDir: (brandRoot: string, inst: ServerRegistryInstance) => string;
    composeFilePath: (brandRoot: string, inst: ServerRegistryInstance) => string;
    cfEnvPath: (brandRoot: string, inst: ServerRegistryInstance) => string;
    secretsEnvPath: (brandRoot: string, inst: ServerRegistryInstance) => string;
    parseDotEnvFile: (file: string) => Record<string, string>;
    persistOwnerSecrets: (opts: {
      brandRoot: string;
      inst: ServerRegistryInstance;
      owner?: {
        email?: string;
        password?: string;
        e2eEmail?: string;
        e2ePassword?: string;
      };
    }) => string | null;
    stackRecreateApp: (
      brandRoot: string,
      inst: ServerRegistryInstance,
      opts?: { quiet?: boolean },
    ) => void;
    writeInstanceStack: (opts: {
      brandRoot: string;
      brandId: string;
      image: string;
      inst: ServerRegistryInstance;
      cf?: Record<string, string> | null;
      allowDropSidecar?: boolean;
    }) => {
      dir: string;
      composeFile: string;
      withCf: boolean;
      preservedSidecar?: boolean;
    };
    stackUp: (
      brandRoot: string,
      inst: ServerRegistryInstance,
      opts?: { quiet?: boolean },
    ) => void;
    stackDown: (
      brandRoot: string,
      inst: ServerRegistryInstance,
      opts?: { quiet?: boolean },
    ) => void;
    stackStop: (
      brandRoot: string,
      inst: ServerRegistryInstance,
      opts?: { quiet?: boolean },
    ) => void;
    stackStart: (
      brandRoot: string,
      inst: ServerRegistryInstance,
      opts?: { quiet?: boolean },
    ) => void;
    stackLogs: (
      brandRoot: string,
      inst: ServerRegistryInstance,
      opts?: { tail?: number; follow?: boolean },
    ) => void;
    stackHostPort: (containerName: string) => number;
    recordedHostPort: (inst: {
      hostPort?: number;
      port?: number;
    }) => number;
    applyAllocatedHostPort: <T extends { port?: number; hostPort?: number }>(
      inst: T,
      hp: number,
    ) => T;
    resolveInstanceHostPort: (
      inst: ServerRegistryInstance,
    ) => Promise<number>;
    readKernelTunnelConfig: (
      brandRoot: string,
      inst: ServerRegistryInstance,
      brandId: string,
    ) => {
      slug: string;
      hostname: string;
      publicUrl: string;
      tunnelId: string;
      tunnelToken: string;
      localPort: number;
    } | null;
  };
}

/** Contrat Cloudflare côté hôte (CLI) — mêmes clés que cf.env. */
const CF_CLI_ENV_KEYS = [
  "CREEZIO_CF_API_TOKEN",
  "CREEZIO_CF_ACCOUNT_ID",
  "CREEZIO_CF_ZONE_ID",
  "CREEZIO_CF_ZONE_NAME",
  "CREEZIO_CF_UNIVERSAL_SSL",
  "CREEZIO_DOMAIN",
  "CREEZIO_TUNNEL_SLUG",
  "CREEZIO_TUNNEL_EXTRA_HOSTNAMES",
] as const;

type CfTunnelEnv = {
  apiToken: string;
  accountId: string;
  zoneId: string;
  zoneName?: string;
};

type CfTunnelEnsureResult = {
  ok: true;
  slug: string;
  hostname: string;
  hostMode: "nested" | "flat";
  tunnelId: string;
  tunnelToken: string;
  publicUrl: string;
  emailDomain: string | null;
  recreated: boolean;
};

type CfAgentTunnelEnsureResult = {
  ok: true;
  slug: string;
  hostname: string;
  hostMode: "nested" | "flat";
  tunnelId: string;
  tunnelToken: string;
  agentUrl: string;
  recreated: boolean;
};

/**
 * Client Cloudflare Tunnel du kit (`platform-core/dist`) — import dynamique
 * (même pattern qu'instance-stack : pas de dist factory). Requiert
 * `npm run build:packages` dans le clone kit.
 */
async function importTunnelCf(kit: string) {
  const clientPath = path.join(
    kit,
    "packages/platform-core/dist/tunnel-cf-client.js",
  );
  const purePath = path.join(kit, "packages/platform-core/dist/tunnel-cf.js");
  if (!fs.existsSync(clientPath) || !fs.existsSync(purePath)) {
    throw new Error(
      `client CF introuvable (${clientPath}) — lancer npm run build:packages dans le kit`,
    );
  }
  const client = (await import(pathToFileURL(clientPath).href)) as {
    resolveCfTunnelEnv: (env: NodeJS.ProcessEnv) => CfTunnelEnv | null;
    missingCfTunnelEnvKeys: (env: NodeJS.ProcessEnv) => string[];
    verifyCfApiToken: (
      env: CfTunnelEnv,
    ) => Promise<{ ok: boolean; kind: "account" | "user"; id?: string }>;
    ensureCfTunnel: (
      env: CfTunnelEnv,
      opts: {
        slug: string;
        domain?: string;
        ports?: { crmPort: number; n8nPort?: number; hermesPort?: number };
        hostMode?: "nested" | "flat" | null;
        extraHostnames?: string[];
        stored?: { tunnelId?: string; tunnelToken?: string } | null;
        log?: (line: string) => void;
      },
    ) => Promise<CfTunnelEnsureResult>;
    putCfTunnelIngress: (
      env: CfTunnelEnv,
      tunnelId: string,
      ingress: Array<{ hostname?: string; service: string }>,
    ) => Promise<void>;
    ensureCfAgentTunnel: (
      env: CfTunnelEnv,
      opts: {
        slug: string;
        serverHostname: string;
        agentPort: number;
        hostMode?: "nested" | "flat" | null;
        originHost?: string;
        dns?: boolean;
        stored?: { tunnelId?: string; tunnelToken?: string } | null;
        log?: (line: string) => void;
      },
    ) => Promise<CfAgentTunnelEnsureResult>;
    ensureCfAgentTunnelDns: (
      env: CfTunnelEnv,
      opts: { hostname: string; tunnelId: string; slug?: string },
    ) => Promise<"exists" | "updated" | "created">;
    removeCfTunnelAgentRule: (
      env: CfTunnelEnv,
      opts: { tunnelId: string; agentHostname: string },
    ) => Promise<boolean>;
    deprovisionCfSlug: (
      env: CfTunnelEnv,
      opts: {
        slug: string;
        hostname?: string;
        tunnelId?: string;
        extraHostnames?: string[];
        log?: (line: string) => void;
      },
    ) => Promise<{
      ok: true;
      slug: string;
      removed: { dns: string[]; tunnel: string | null };
    }>;
    deprovisionCfAgentTunnel: (
      env: CfTunnelEnv,
      opts: {
        slug: string;
        hostname?: string;
        tunnelId?: string;
        extraHostnames?: string[];
        log?: (line: string) => void;
      },
    ) => Promise<{
      ok: true;
      slug: string;
      removed: { dns: string[]; tunnel: string | null };
    }>;
  };
  const pure = (await import(pathToFileURL(purePath).href)) as {
    tunnelAgentHostname: (
      hostname: string,
      hostMode: "nested" | "flat",
    ) => string;
    parseExtraHostnames: (raw: unknown) => string[];
    buildTunnelIngressRules: (
      hostname: string,
      ports: { crmPort: number; n8nPort?: number; hermesPort?: number },
      opts?: {
        hostMode?: "nested" | "flat" | null;
        originHost?: string;
        extraHostnames?: string[];
      },
    ) => Array<{ hostname?: string; service: string }>;
  };
  return { ...client, ...pure };
}

/**
 * Contrat CF pour les commandes hôte : env process > .env racine marque.
 * Retourne uniquement les clés posées (jamais de valeur inventée).
 */
function resolveCliCfEnv(brandRoot: string): Record<string, string> {
  const brandDotEnv = readEnvFileValues(path.join(brandRoot, ".env"));
  const out: Record<string, string> = {};
  for (const key of CF_CLI_ENV_KEYS) {
    const v = (process.env[key] || "").trim() || (brandDotEnv[key] || "").trim();
    if (v) out[key] = v;
  }
  return out;
}

/** resolveCfTunnelEnv sur env fusionné (process + .env marque). */
function cfEnvFromMerged(
  cf: Awaited<ReturnType<typeof importTunnelCf>>,
  cfVars: Record<string, string>,
): CfTunnelEnv | null {
  return cf.resolveCfTunnelEnv({
    ...process.env,
    ...cfVars,
  } as NodeJS.ProcessEnv);
}

/**
 * Déprovisionnement Cloudflare d'une instance (rm) : DNS (nested + flat +
 * mail + extras) puis tunnel. Jamais les DNS `agent.*` / `agent-*` —
 * propriétaire exclusif de `agent rm`. Best-effort — un résidu est
 * signalé, jamais bloquant pour la suppression locale. Lu AVANT la
 * suppression du stack dir (cf.env contient CREEZIO_DOMAIN /
 * CREEZIO_TUNNEL_EXTRA_HOSTNAMES).
 */
async function deprovisionInstanceTunnelCf(
  kit: string,
  brandRoot: string,
  inst: ServerRegistryInstance,
  brandId: string,
): Promise<void> {
  const stack = await importInstanceStack(kit);
  const cf = await importTunnelCf(kit);
  const kc = stack.readKernelTunnelConfig(brandRoot, inst, brandId);
  const cfFileVars = readEnvFileValues(stack.cfEnvPath(brandRoot, inst));
  const cfVars = { ...cfFileVars, ...resolveCliCfEnv(brandRoot) };
  const env = cfEnvFromMerged(cf, cfVars);
  if (!env) {
    if (kc?.tunnelId) {
      console.log(
        "⚠ CREEZIO_CF_* absents — tunnel/DNS Cloudflare NON nettoyés " +
          `(tunnel ${kc.tunnelId} toujours actif côté Cloudflare)`,
      );
    }
    return;
  }
  const slug = (
    kc?.slug ||
    cfVars.CREEZIO_TUNNEL_SLUG ||
    inst.name
  ).trim();
  const r = await cf.deprovisionCfSlug(env, {
    slug,
    hostname:
      (cfVars.CREEZIO_DOMAIN || "").trim() || kc?.hostname || undefined,
    tunnelId: kc?.tunnelId || undefined,
    extraHostnames: cf.parseExtraHostnames(
      cfVars.CREEZIO_TUNNEL_EXTRA_HOSTNAMES,
    ),
    log: (s) => console.log(`  ${s}`),
  });
  console.log(
    `✓ Cloudflare nettoyé — dns: ${r.removed.dns.length} enregistrement(s), tunnel: ${r.removed.tunnel || "aucun"}`,
  );
}

/** Marqueur de version du template — un .dockerignore sans lui est rafraîchi. */
const DOCKERIGNORE_MARKER = "# creezio-dockerignore v5";

/**
 * Layout monorepo 3 livrables (client/ server/ admin/) : le livrable serveur
 * vit sous `<brandRoot>/server`. Layout plat legacy : tout à la racine.
 */
export function resolveBrandServerDir(brandRoot: string): string {
  const monorepo = path.join(brandRoot, "server");
  if (fs.existsSync(path.join(monorepo, "package.json"))) return monorepo;
  return brandRoot;
}

/** `server` (monorepo) ou `.` (plat) — consommé par le Dockerfile (ARG SERVER_DIR). */
export function brandServerDirRel(brandRoot: string): string {
  return resolveBrandServerDir(brandRoot) === brandRoot ? "." : "server";
}

function ensureBrandDockerignore(brandRoot: string, kit: string): void {
  const dest = path.join(brandRoot, ".dockerignore");
  const src = path.join(kit, "docker/server/brand.dockerignore");
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) {
    const cur = fs.readFileSync(dest, "utf8");
    if (cur.includes(DOCKERIGNORE_MARKER)) return;
    fs.copyFileSync(src, dest);
    console.log(`~ .dockerignore rafraîchi (template kit v5 — build 100% in-image)`);
    return;
  }
  fs.copyFileSync(src, dest);
  console.log(`+ .dockerignore (depuis kit docker/server/brand.dockerignore)`);
}

function resolvePaths(args: ServerDockerArgs): {
  kit: string;
  brandRoot: string;
  /** Livrable serveur : `<brandRoot>/server` (monorepo) ou brandRoot (plat). */
  serverDir: string;
  /** `server` ou `.` — transmis au Dockerfile via ARG SERVER_DIR. */
  serverDirRel: string;
  composeFile: string;
  dockerfile: string;
  project: string;
} {
  const kit = path.resolve(
    args.kitRoot || process.env.CREEZIO_KIT_ROOT || kitRootDefault(),
  );
  const brandRaw = String(args.brandRoot || process.env.BRAND_ROOT || "").trim();
  if (!brandRaw) {
    throw new Error("--brand-root <app> (ou env BRAND_ROOT) requis");
  }
  const brandRoot = path.resolve(brandRaw);
  if (!fs.existsSync(brandRoot)) {
    throw new Error(`brand-root introuvable: ${brandRoot}`);
  }
  const composeFile = path.join(kit, "docker/server/docker-compose.yml");
  const dockerfile = path.join(kit, "docker/server/Dockerfile");
  if (!fs.existsSync(composeFile) || !fs.existsSync(dockerfile)) {
    throw new Error(`docker/server incomplet sous ${kit}`);
  }
  return {
    kit,
    brandRoot,
    serverDir: resolveBrandServerDir(brandRoot),
    serverDirRel: brandServerDirRel(brandRoot),
    composeFile,
    dockerfile,
    project: args.project || "creezio-servers",
  };
}

function run(
  cmd: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  opts?: { cwd?: string },
): void {
  const r = spawnSync(cmd, argv, {
    stdio: "inherit",
    env,
    cwd: opts?.cwd,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argv.join(" ")} exit ${r.status ?? "?"}`);
  }
}

function composeEnv(
  paths: ReturnType<typeof resolvePaths>,
): NodeJS.ProcessEnv {
  const brandId =
    process.env.BRAND_ID || inferBrandId(paths.brandRoot) || "brand";
  return {
    ...process.env,
    BRAND_ROOT: paths.brandRoot,
    CREEZIO_KIT_ROOT: paths.kit,
    BRAND_ID: brandId,
    // Layout monorepo : livrable serveur sous server/ (Dockerfile ARG).
    SERVER_DIR: paths.serverDirRel,
    // Image par marque — compose et `docker run` (registre) partagent le tag.
    SERVER_IMAGE: serverImageName(brandId),
    DATA_DIR:
      process.env.DATA_DIR ||
      path.join(paths.brandRoot, "docker-data", "servers"),
  };
}

function inferBrandId(brandRoot: string): string | null {
  for (const dir of [brandRoot, resolveBrandServerDir(brandRoot)]) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string; creezio?: { brandId?: string } };
      if (pkg.creezio?.brandId) return pkg.creezio.brandId;
      if (!pkg.name) continue;
      // "@creezio/app-acme" → "acme" (tag image / nom container).
      const last = pkg.name.split("/").pop() || pkg.name;
      const id = last.replace(/^app-/, "").replace(/[^a-z0-9-]/gi, "");
      if (id) return id;
    } catch {
      /* essayer le dossier suivant */
    }
  }
  return null;
}

/** Nom produit pour raccourcis (→ {Product}-Server-1.desktop). */
export function inferProductName(brandRoot: string): string {
  const env = String(process.env.SERVER_DESKTOP_PRODUCT || "").trim();
  if (env) return env;
  for (const rel of ["brand-spec/brand.yaml", "brand-spec/brand.yml"]) {
    const p = path.join(brandRoot, rel);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const m = text.match(/^\s*brandName:\s*["']?([^\n#"']+)/m);
    if (m?.[1]) return m[1].trim();
  }
  for (const dir of [brandRoot, resolveBrandServerDir(brandRoot)]) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { creezio?: { productName?: string }; description?: string };
      if (pkg.creezio?.productName) return pkg.creezio.productName;
    } catch {
      /* ignore */
    }
  }
  const id = inferBrandId(brandRoot) || "Brand";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function resolveServerIcon(brandRoot: string): string | null {
  for (const rel of [
    "server/resources/icons/server.png",
    "client/resources/icons/server.png",
    "resources/icons/server.png",
    "brand-spec/icons/server.png",
    "icons/server.png",
  ]) {
    const p = path.join(brandRoot, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function desktopDirs(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];
  for (const name of ["Desktop", "Bureau"]) {
    const d = path.join(home, name);
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) dirs.push(d);
  }
  return dirs;
}

function sanitizeDesktopProduct(product: string): string {
  return product
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "Brand";
}

function resolveInstancePort(inst: ServerInstance): number {
  const raw = process.env[inst.portEnv];
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return inst.defaultPort;
}

/** Script générique URL → navigateur (copié depuis docker/server/). */
export const CREEZIO_OPEN_URL_BIN = "creezio-open-url";

/** Fallback inline si le script kit est absent (tests / kit partiel). */
const CREEZIO_OPEN_URL_FALLBACK = `#!/usr/bin/env bash
set -u
URL="\${1:-}"
LOG_DIR="\${XDG_STATE_HOME:-\${HOME:-/home/deploy}/.local/state}/creezio-server"
LOG="\$LOG_DIR/open-server.log"
mkdir -p "\$LOG_DIR" 2>/dev/null || true
log() { echo "[\$(date -Iseconds 2>/dev/null || date)] \$*" >>"\$LOG" 2>/dev/null || true; echo "\$*" >&2; }
[[ -n "\$URL" ]] || { log "ERROR usage: creezio-open-url <url>"; exit 2; }
if [[ -z "\${DISPLAY:-}" ]]; then
  for sock in /tmp/.X11-unix/X10 /tmp/.X11-unix/X*; do
    [[ -S "\$sock" ]] || continue
    n="\${sock##*/X}"
    [[ "\$n" =~ ^[0-9]+$ ]] || continue
    export DISPLAY=":\$n"
    break
  done
fi
export XAUTHORITY="\${XAUTHORITY:-\${HOME:-/home/deploy}/.Xauthority}"
export PATH="/snap/bin:/usr/local/bin:/usr/bin:/bin:\${PATH:-}"
export PATH="\${HOME:-/home/deploy}/bin:\${HOME:-/home/deploy}/.local/firefox:/snap/bin:/usr/bin:/bin:\${PATH:-}"
log "start url=\$URL DISPLAY=\${DISPLAY:-}"
for bin in "\${HOME:-/home/deploy}/.local/firefox/firefox" /snap/bin/firefox \\
  /usr/bin/firefox-esr /usr/bin/firefox firefox \\
  /usr/bin/chromium-browser /usr/bin/chromium chromium; do
  if [[ -x "\$bin" ]] || command -v "\$bin" >/dev/null 2>&1; then
    r="\$bin"; [[ -x "\$bin" ]] || r="\$(command -v "\$bin")"
    nohup env MOZ_DISABLE_CONTENT_SANDBOX=1 "\$r" "\$URL" >>"\$LOG" 2>&1 &
    log "OK \$r → \$URL (pid \$!)"; echo "opened with \$r → \$URL (pid \$!)"; exit 0
  fi
done
log "ERROR aucun navigateur pour \$URL"; exit 1
`;

function binDir(): string {
  const d = path.join(os.homedir(), "bin");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function chmod755(p: string): void {
  try {
    fs.chmodSync(p, 0o755);
  } catch {
    /* ignore */
  }
}

/**
 * Installe ~/bin/creezio-open-url (copie kit docker/server/creezio-open-url.sh).
 */
export function ensureCreezioOpenUrl(kitRoot?: string): string {
  const dest = path.join(binDir(), CREEZIO_OPEN_URL_BIN);
  const kit = path.resolve(
    kitRoot || process.env.CREEZIO_KIT_ROOT || kitRootDefault(),
  );
  const src = path.join(kit, "docker/server/creezio-open-url.sh");
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else {
    fs.writeFileSync(dest, CREEZIO_OPEN_URL_FALLBACK, { mode: 0o755 });
  }
  chmod755(dest);
  return dest;
}

/** @deprecated alias — préférer ensureCreezioOpenUrl */
export function ensureOpenCreezioServerWrapper(kitRoot?: string): string {
  return ensureCreezioOpenUrl(kitRoot);
}

/**
 * Wrapper par instance : ~/bin/open-creezio-server-N → URL fixe.
 * Les .desktop appellent ce binaire (pas xdg-open direct).
 */
export function writeOpenCreezioServerN(opts: {
  n: number;
  url: string;
  openUrlBin: string;
}): string {
  const dest = path.join(binDir(), `open-creezio-server-${opts.n}`);
  const body = `#!/usr/bin/env bash
# Raccourci Docker server-${opts.n} — généré par creezio server-docker
set -u
LOG_DIR="\${XDG_STATE_HOME:-\${HOME:-/home/deploy}/.local/state}/creezio-server"
LOG="\$LOG_DIR/open-server.log"
mkdir -p "\$LOG_DIR" 2>/dev/null || true
echo "[\$(date -Iseconds 2>/dev/null || date)] open-creezio-server-${opts.n} → ${opts.url} DISPLAY=\${DISPLAY:-}" >>"\$LOG" 2>/dev/null || true
export PATH="/snap/bin:/usr/local/bin:/usr/bin:/bin:\${PATH:-}"
exec "${opts.openUrlBin}" "${opts.url}"
`;
  fs.writeFileSync(dest, body, { mode: 0o755 });
  chmod755(dest);
  return dest;
}

function markDesktopTrusted(desktopPath: string): void {
  // XFCE/GNOME refuse le double-clic tant que metadata::trusted n'est pas true.
  const r = spawnSync(
    "gio",
    ["set", desktopPath, "metadata::trusted", "true"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.log(
      `⚠ gio set metadata::trusted échoué pour ${desktopPath}: ${r.stderr || r.stdout || r.status}`,
    );
  }
}

function desktopFileContent(opts: {
  name: string;
  comment: string;
  icon: string | null;
  /** Chemin absolu du wrapper open-creezio-server-N (sans args). */
  execPath: string;
}): string {
  const exec = opts.execPath.includes(" ")
    ? `"${opts.execPath}"`
    : opts.execPath;
  const lines = [
    "[Desktop Entry]",
    "Version=1.0",
    "Type=Application",
    `Name=${opts.name}`,
    `Comment=${opts.comment}`,
    `Exec=${exec}`,
  ];
  if (opts.icon) lines.push(`Icon=${opts.icon}`);
  lines.push(
    "Terminal=false",
    "Categories=Network;",
    // false : le wrapper bash n'émet pas de startup notification → sinon XFCE « rien ».
    "StartupNotify=false",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * Génère/met à jour les raccourcis Linux pour chaque instance Compose up.
 * Cibles : ~/Desktop et ~/Bureau (si présents).
 * Exec → ~/bin/open-creezio-server-N (firefox/chromium/gio/xdg-open…).
 */
export function writeServerDesktopShortcuts(opts: {
  brandRoot: string;
  kitRoot?: string;
  instances?: ServerInstance[];
}): {
  files: string[];
  product: string;
  wrappers: string[];
  openUrlBin: string;
} {
  const instances = opts.instances || DEFAULT_SERVER_INSTANCES;
  const product = inferProductName(opts.brandRoot);
  const slug = sanitizeDesktopProduct(product);
  const icon = resolveServerIcon(opts.brandRoot);
  const openUrlBin = ensureCreezioOpenUrl(opts.kitRoot);
  const dirs = desktopDirs();
  const files: string[] = [];
  const wrappers: string[] = [];
  if (!dirs.length) {
    console.log(
      "⚠ aucun ~/Desktop ni ~/Bureau — raccourcis .desktop non écrits",
    );
    return { files, product, wrappers, openUrlBin };
  }
  for (const inst of instances) {
    const port = resolveInstancePort(inst);
    const url = `http://127.0.0.1:${port}/`;
    const wrapper = writeOpenCreezioServerN({
      n: inst.n,
      url,
      openUrlBin,
    });
    wrappers.push(wrapper);
    const baseName = `${slug}-Server-${inst.n}.desktop`;
    const body = desktopFileContent({
      name: `${product} Server ${inst.n}`,
      comment: `${product} serveur Docker (${inst.id}) — UI/API :${port} (setup /settings via HTTP)`,
      icon,
      execPath: wrapper,
    });
    for (const dir of dirs) {
      const dest = path.join(dir, baseName);
      fs.writeFileSync(dest, body, { mode: 0o755 });
      chmod755(dest);
      markDesktopTrusted(dest);
      files.push(dest);
      console.log(`+ raccourci ${dest} → Exec=${wrapper} (${url}) [trusted]`);
    }
  }
  return { files, product, wrappers, openUrlBin };
}

/**
 * App standalone dockerisable (mode npm) — garantit les package-lock alignés
 * (lock racine workspace = SoT, entrées `""` + `server` ; locks autonomes
 * ui/client) avant le `npm ci` de l'image. Les deps `@creezio/*` sont des
 * packages npm publiés (npmjs.org) : plus de vendor à sync ; la
 * régénération du lock interroge le registre public (aucun token).
 *
 * Ne PAS « corriger » un lock Docker à la main : passer par cette fonction
 * (via `creezio server-docker build|create`).
 */
function ensureBrandStandalone(brandRoot: string, kit: string): void {
  void kit; // kit non utilisé en mode npm (deps publiées, pas de sync vendor)
  const serverDir = resolveBrandServerDir(brandRoot);
  const monorepo = serverDir !== brandRoot;
  const rootLock = path.join(brandRoot, "package-lock.json");
  const pkgPath = path.join(serverDir, "package.json");
  const lockOk = monorepo
    ? isPackageLockInSync(path.join(brandRoot, "package.json"), rootLock) &&
      isPackageLockInSync(pkgPath, rootLock, "server")
    : isPackageLockInSync(pkgPath);
  if (!lockOk) {
    console.log(
      "package-lock incohérent/absent — régénération (évite l'échec npm ci Docker)…",
    );
    // Régénère racine workspace (+ ui/client si besoin) ; mode install = node_modules host.
    ensureBrandPackageLocks(brandRoot, { mode: "install" });
  } else if (!fs.existsSync(path.join(brandRoot, "node_modules"))) {
    console.log("npm install (node_modules racine, lock déjà cohérent)…");
    run("npm", ["install", "--no-audit", "--no-fund"], process.env, {
      cwd: brandRoot,
    });
  }
}

/**
 * Fail-closed avant publish/build Docker : le dist kit des packages runtime
 * critiques doit refléter le src (content contracts + mtime). En mode npm
 * l'image consomme les packages PUBLIÉS, mais le CLI tourne depuis le dist
 * local — un dist stale = comportement CLI trompeur (régression Admin
 * Database / routes manquantes).
 *
 * Bypass ops d'urgence uniquement : CREEZIO_SKIP_RUNTIME_DIST_ASSERT=1.
 */
function assertKitRuntimeDistFresh(kit: string): void {
  if (process.env.CREEZIO_SKIP_RUNTIME_DIST_ASSERT === "1") {
    console.warn(
      "⚠ CREEZIO_SKIP_RUNTIME_DIST_ASSERT=1 — skip assert dist runtime (déconseillé)",
    );
    return;
  }
  const script = path.join(kit, "scripts/lib/assert-runtime-dist.mjs");
  if (!fs.existsSync(script)) {
    console.warn(
      `⚠ assert-runtime-dist.mjs absent (${script}) — kit trop ancien ?`,
    );
    return;
  }
  console.log("assert kit runtime dist (content + mtime)…");
  run("node", [script, kit], process.env);
}

/** Label OCI qui rattache un package GHCR au repo GitHub de la marque. */
export const OCI_IMAGE_SOURCE_LABEL = "org.opencontainers.image.source";

/**
 * Normalise un remote git en URL HTTPS `https://github.com/<org>/<repo>`.
 * Accepte HTTPS, SSH (`git@github.com:org/repo.git`) et remotes avec token.
 */
export function parseGithubHttpsSource(remote: string): string | null {
  const cleaned = remote
    .trim()
    .replace(/^[a-zA-Z]+:\/\/[^@/]+@/, "https://")
    .replace(/^git@/i, "");
  const m = cleaned.match(/github\.com[/:]([^/]+)\/([^/\s]+)/i);
  if (!m) return null;
  const org = m[1];
  const repoRaw = m[2];
  if (!org || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/i, "");
  if (!repo) return null;
  return `https://github.com/${org}/${repo}`;
}

/** Remote `origin` du brand-root → URL source GitHub, ou null si absent. */
export function resolveBrandGithubSourceUrl(brandRoot: string): string | null {
  const r = spawnSync("git", ["-C", brandRoot, "remote", "get-url", "origin"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return parseGithubHttpsSource(r.stdout || "");
}

/**
 * ghcr.io exige un source GitHub (sinon le package reste orphelin au compte).
 * Autres registres : source optionnel (posé s'il est résolvable).
 */
export function requireImageSourceForRegistry(
  registry: string,
  source: string | null,
): string | undefined {
  const isGhcr = /^ghcr\.io(\/|$)/i.test(registry);
  if (isGhcr && !source) {
    throw new Error(
      "ghcr.io : org.opencontainers.image.source introuvable — le brand-root " +
        "doit avoir un remote git origin GitHub (https://github.com/<org>/<repo>) " +
        "pour rattacher le package GHCR au repo marque",
    );
  }
  return source || undefined;
}

/** `--label` + `--build-arg IMAGE_SOURCE` pour `docker build`. */
export function ociImageSourceBuildArgs(source: string | undefined): string[] {
  if (!source) return [];
  return [
    "--label",
    `${OCI_IMAGE_SOURCE_LABEL}=${source}`,
    "--build-arg",
    `IMAGE_SOURCE=${source}`,
  ];
}

export type DockerBuildArgsOpts = {
  dockerfile: string;
  serverVariant: "base" | "browser";
  serverDirRel: string;
  image: string;
  extraTags?: string[];
  version?: string;
  imageSource?: string;
  brandRoot: string;
};

/** Args `docker build` (testable sans daemon) — SoT consommée par publish. */
export function collectDockerBuildArgs(opts: DockerBuildArgsOpts): string[] {
  const args = [
    "build",
    "--secret",
    "id=CREEZIO_NPM_TOKEN,env=CREEZIO_NPM_TOKEN",
    "-f",
    opts.dockerfile,
    "--build-arg",
    `SERVER_VARIANT=${opts.serverVariant}`,
    "--build-arg",
    `SERVER_DIR=${opts.serverDirRel}`,
  ];
  if (opts.version) {
    args.push("--build-arg", `SERVER_VERSION=${opts.version}`);
  }
  args.push(...ociImageSourceBuildArgs(opts.imageSource));
  args.push("-t", opts.image);
  for (const t of opts.extraTags || []) {
    args.push("-t", t);
  }
  args.push(opts.brandRoot);
  return args;
}

function dockerBuildImage(
  paths: ReturnType<typeof resolvePaths>,
  env: NodeJS.ProcessEnv,
  opts?: {
    variant?: "base" | "browser";
    image?: string;
    /** Tags supplémentaires (publish : image versionnée registry). */
    extraTags?: string[];
    /** Version embarquée (ENV CREEZIO_APP_VERSION + label OCI). */
    version?: string;
    /** Label OCI `org.opencontainers.image.source` (publish / GHCR). */
    imageSource?: string;
  },
): void {
  const variant = opts?.variant || "base";
  assertKitRuntimeDistFresh(paths.kit);
  ensureBrandStandalone(paths.brandRoot, paths.kit);
  // Build runtime (tsc) + UI Next : 100% dans l'image (stage brand-build du
  // Dockerfile kit). node/npm de l'hôte ne produisent AUCUN artefact d'image
  // — même résultat sur tous les serveurs, zéro divergence possible.
  // Deps @creezio/* npm (GitHub Packages) : token via secret BuildKit —
  // jamais en ARG/ENV de l'image (hors historique, invisible dans
  // `docker history`). Fail-fast : sans token, le npm ci de l'image
  // échouerait sur les packages privés.
  const npmToken = env.CREEZIO_NPM_TOKEN || process.env.CREEZIO_NPM_TOKEN;
  if (!npmToken) {
    throw new Error(
      "CREEZIO_NPM_TOKEN absent — requis pour le `npm ci` des @creezio/* " +
        "privés pendant le build Docker (PAT read:packages, exporté dans " +
        "l'environnement ou le .env marque).",
    );
  }
  const args = collectDockerBuildArgs({
    dockerfile: paths.dockerfile,
    serverVariant: variant,
    serverDirRel: paths.serverDirRel,
    image: opts?.image || String(env.SERVER_IMAGE),
    extraTags: opts?.extraTags,
    version: opts?.version,
    imageSource: opts?.imageSource,
    brandRoot: paths.brandRoot,
  });
  run("docker", args, {
    ...env,
    DOCKER_BUILDKIT: "1",
    CREEZIO_NPM_TOKEN: npmToken,
  });
}

function dockerImageExists(image: string): boolean {
  const r = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8",
  });
  return r.status === 0;
}

function dockerContainerState(name: string): {
  exists: boolean;
  running: boolean;
  status: string;
  health: string | null;
} {
  const r = spawnSync(
    "docker",
    [
      "inspect",
      "--format",
      "{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{end}}",
      name,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    return { exists: false, running: false, status: "absent", health: null };
  }
  const [status = "?", health = ""] = r.stdout.trim().split("\t");
  return {
    exists: true,
    running: status === "running",
    status,
    health: health || null,
  };
}

/** CREEZIO_ADMIN_ROOT du container creezio-server-admin s'il tourne. */
function inspectAdminRootFromContainer(): string | null {
  const r = spawnSync(
    "docker",
    [
      "inspect",
      "-f",
      "{{range .Config.Env}}{{println .}}{{end}}",
      "creezio-server-admin",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  for (const line of (r.stdout || "").split("\n")) {
    if (!line.startsWith("CREEZIO_ADMIN_ROOT=")) continue;
    const v = line.slice("CREEZIO_ADMIN_ROOT=".length).trim();
    return v || null;
  }
  return null;
}

async function curlHealth(
  port: number,
): Promise<{ ok: boolean; status: number; brandId?: string; body: string }> {
  const url = `http://127.0.0.1:${port}/api/v1/core/health`;
  try {
    const res = await fetch(url);
    const body = await res.text();
    let brandId: string | undefined;
    try {
      brandId = (JSON.parse(body) as { brandId?: string }).brandId;
    } catch {
      /* ignore */
    }
    return { ok: res.status === 200, status: res.status, brandId, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Admin web multi-serveurs — container backend @creezio/fleet (docker.sock). */
const ADMIN_IMAGE = "creezio-server-admin:local";
const ADMIN_CONTAINER = "creezio-server-admin";
const ADMIN_DEFAULT_PORT = 18800;

type AdminConfig = {
  port: number;
  user: string;
  pass: string;
  brandRoots: string[];
};

/**
 * Racine de configuration admin.
 *
 * - Mode historique (mono-VPS marque) : root = brandRoot ; config versionnée
 *   sous `<brandRoot>/admin/server-admin.json` (layout 3 livrables).
 * - Repo admin dédié (`--admin-root`) : config versionnée à la RACINE du repo
 *   (`server-admin.json`, `fleet-hosts.json`) ; runtime sous docker-data/.
 */
type AdminRootPaths = {
  root: string;
  runtimeFile: string;
  versionedFile: string;
};

function resolveAdminRoot(
  args: ServerDockerArgs,
  brandRoot: string,
): AdminRootPaths {
  const root = path.resolve(args.adminRoot || brandRoot);
  const dedicated = Boolean(args.adminRoot);
  // Repo admin dédié : config versionnée à la racine. Monorepo historique :
  // sous admin/ (le miroir n'est écrit que si le dossier existe — les marques
  // plates legacy ne sont jamais polluées).
  const versionedFile = dedicated
    ? path.join(root, "server-admin.json")
    : path.join(root, "admin", "server-admin.json");
  return {
    root,
    runtimeFile: path.join(root, "docker-data", "server-admin.json"),
    versionedFile,
  };
}

function saveAdminConfig(ar: AdminRootPaths, cfg: AdminConfig): void {
  fs.mkdirSync(path.dirname(ar.runtimeFile), { recursive: true });
  fs.writeFileSync(ar.runtimeFile, JSON.stringify(cfg, null, 2) + "\n", {
    mode: 0o600,
  });
  // Miroir versionnable sans secret — seulement si l'emplacement versionné
  // existe déjà (layout 3 livrables / repo admin dédié) : ne pas polluer
  // les marques plates legacy.
  if (fs.existsSync(path.dirname(ar.versionedFile))) {
    const { pass: _pass, ...noSecret } = cfg;
    // Préserver les champs factory du miroir (brandId, domain…) — le runtime
    // ne possède que port/user/brandRoots.
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(ar.versionedFile, "utf8"));
    } catch {
      /* premier write */
    }
    fs.writeFileSync(
      ar.versionedFile,
      JSON.stringify({ ...existing, ...noSecret }, null, 2) + "\n",
    );
  }
}

function loadOrInitAdminConfig(
  ar: AdminRootPaths,
  opts?: { port?: number; addBrandRoot?: string },
): AdminConfig {
  let cfg: AdminConfig | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(ar.runtimeFile, "utf8")) as AdminConfig;
    if (raw && raw.user && raw.pass) cfg = raw;
  } catch {
    /* premier up */
  }
  // Défauts versionnés (server-admin.json, sans pass) : port / user /
  // brandRoots — fusionnés avec le runtime (union brandRoots).
  try {
    const versioned = JSON.parse(
      fs.readFileSync(ar.versionedFile, "utf8"),
    ) as Partial<AdminConfig>;
    if (versioned && typeof versioned === "object") {
      if (!cfg) {
        cfg = {
          port: versioned.port || ADMIN_DEFAULT_PORT,
          user: versioned.user || "admin",
          pass: crypto.randomBytes(12).toString("base64url"),
          brandRoots: [...(versioned.brandRoots || [])],
        };
      } else {
        for (const root of versioned.brandRoots || []) {
          if (!cfg.brandRoots.includes(root)) cfg.brandRoots.push(root);
        }
      }
    }
  } catch {
    /* pas de config versionnée */
  }
  if (!cfg) {
    cfg = {
      port: opts?.port || ADMIN_DEFAULT_PORT,
      user: "admin",
      pass: crypto.randomBytes(12).toString("base64url"),
      brandRoots: opts?.addBrandRoot ? [opts.addBrandRoot] : [],
    };
  }
  if (opts?.port && opts.port > 0) cfg.port = opts.port;
  if (opts?.addBrandRoot && !cfg.brandRoots.includes(opts.addBrandRoot)) {
    cfg.brandRoots.push(opts.addBrandRoot);
  }
  saveAdminConfig(ar, cfg);
  return cfg;
}

/** Lecture minimale d'un fichier .env (KEY=VALUE, # commentaires). */
function isAdminBrandRoot(brandRoot: string, brandId: string): boolean {
  return (
    isAdminBrandId(brandId) ||
    fs.existsSync(path.join(brandRoot, "server-admin.json"))
  );
}

/** Recopie DOMAIN / EXTRA dans le .env marque (pas de secrets). */
function persistAdminTunnelKeys(
  brandRoot: string,
  cf: Record<string, string>,
): void {
  const file = path.join(brandRoot, ".env");
  const keys: Record<string, string> = {};
  if (cf.CREEZIO_DOMAIN) keys.CREEZIO_DOMAIN = cf.CREEZIO_DOMAIN;
  if (cf.CREEZIO_TUNNEL_EXTRA_HOSTNAMES) {
    keys.CREEZIO_TUNNEL_EXTRA_HOSTNAMES = cf.CREEZIO_TUNNEL_EXTRA_HOSTNAMES;
  }
  if (!Object.keys(keys).length) return;
  upsertEnvFileKeys(file, keys);
}

function upsertEnvFileKeys(
  file: string,
  keys: Record<string, string>,
): void {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    raw = "";
  }
  const seen = new Set<string>();
  const lines = raw.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    const i = t.startsWith("#") ? -1 : t.indexOf("=");
    const k = i > 0 ? t.slice(0, i).trim() : "";
    if (k && keys[k] !== undefined) {
      out.push(`${k}=${keys[k]}`);
      seen.add(k);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(keys)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  const text = out.join("\n").replace(/\n+$/, "") + "\n";
  fs.writeFileSync(file, text);
}

function readEnvFileValues(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = "";
  try {
    raw = readTextFileDirectOrSudo(file);
  } catch (e) {
    if (isFsPermissionError(e)) {
      throw new Error(formatStackFileEaccesError(file));
    }
    return out;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

async function runServerAdminSubcommand(
  args: ServerDockerArgs,
  paths: ReturnType<typeof resolvePaths>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  let action = args.rest[0] || "up";
  // --admin-root : repo admin dédié (multi-VPS) — sinon mode historique
  // mono-repo (config sous <brandRoot>/admin + docker-data).
  const dedicated = Boolean(args.adminRoot);
  const ar = resolveAdminRoot(args, paths.brandRoot);
  const defaultBrandRoot = dedicated ? undefined : paths.brandRoot;

  if (action === "add-brand") {
    const rootArg = args.rest[1];
    if (!rootArg) {
      throw new Error(
        "creezio server-docker admin add-brand <brandRoot> --brand-root <app>",
      );
    }
    const abs = path.resolve(rootArg);
    if (!fs.existsSync(abs)) {
      throw new Error(`brand root introuvable: ${abs}`);
    }
    const cfg = loadOrInitAdminConfig(ar, { addBrandRoot: defaultBrandRoot });
    if (cfg.brandRoots.includes(abs)) {
      console.log(`= marque déjà enregistrée: ${abs}`);
    } else {
      cfg.brandRoots.push(abs);
      saveAdminConfig(ar, cfg);
      console.log(`+ marque ajoutée à l'admin: ${abs}`);
    }
    const st = dockerContainerState(ADMIN_CONTAINER);
    if (!st.exists) {
      console.log(
        "admin pas encore démarré — creezio server-docker admin up pour le lancer",
      );
      return;
    }
    // Recreate : le container doit monter le nouveau volume + env brandRoots.
    console.log("~ recreate du container admin (nouveau volume marque)…");
    action = "up";
  }

  if (action === "down") {
    const st = dockerContainerState(ADMIN_CONTAINER);
    if (st.exists) run("docker", ["rm", "-f", ADMIN_CONTAINER], env);
    console.log("✓ admin arrêté");
    return;
  }

  if (action === "status") {
    const st = dockerContainerState(ADMIN_CONTAINER);
    console.log(
      `admin ${ADMIN_CONTAINER}: ${st.status}${st.health ? ` (${st.health})` : ""}`,
    );
    if (st.running) {
      const cfg = loadOrInitAdminConfig(ar, { addBrandRoot: defaultBrandRoot });
      console.log(`  URL  : http://127.0.0.1:${cfg.port}/admin`);
      console.log(
        `  user : ${cfg.user} (pass: ${path.relative(process.cwd(), ar.runtimeFile)})`,
      );
    }
    return;
  }

  if (action !== "up") {
    throw new Error(`admin ${action} inconnu (up|down|status|add-brand)`);
  }

  const cfg = loadOrInitAdminConfig(ar, {
    port: args.port,
    addBrandRoot: defaultBrandRoot,
  });
  // Préflight UFW fail-closed (incident 10–30/08/2026) : le backend flotte
  // est consommé depuis les conteneurs (172.16.0.0/12) — règle posée
  // automatiquement si absente, sinon erreur avec la commande exacte.
  assertUfwFleetRule({ port: cfg.port, label: "backend flotte" });
  const adminDockerfile = path.join(paths.kit, "docker/server-admin/Dockerfile");
  if (!fs.existsSync(adminDockerfile)) {
    throw new Error(`Dockerfile admin introuvable: ${adminDockerfile}`);
  }
  const adminContext = stageFleetImageContext(paths.kit);
  try {
    run(
      "docker",
      ["build", "-f", adminDockerfile, "-t", ADMIN_IMAGE, adminContext],
      env,
    );
  } finally {
    fs.rmSync(adminContext, { recursive: true, force: true });
  }
  const st = dockerContainerState(ADMIN_CONTAINER);
  if (st.exists) run("docker", ["rm", "-f", ADMIN_CONTAINER], env);

  const runArgs = [
    "run",
    "-d",
    "--name",
    ADMIN_CONTAINER,
    "--restart",
    "unless-stopped",
    // host network : boot-status/health des serveurs via 127.0.0.1:<port>
    // (ports serveurs publiés loopback) — l'admin bind lui-même 127.0.0.1.
    "--network",
    "host",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "--label",
    "creezio.server-admin=1",
    "-e",
    `CREEZIO_ADMIN_PORT=${cfg.port}`,
    "-e",
    `CREEZIO_ADMIN_USER=${cfg.user}`,
    "-e",
    `CREEZIO_ADMIN_PASS=${cfg.pass}`,
    "-e",
    `CREEZIO_ADMIN_BRAND_ROOTS=${cfg.brandRoots.join(":")}`,
    "-e",
    `CREEZIO_ADMIN_ROOT=${ar.root}`,
  ];
  // Registre d'images versionnées (comparaison de versions / update flotte).
  // Priorité : env process > .env du repo admin (secrets locaux gitignorés).
  const adminDotEnv = readEnvFileValues(path.join(ar.root, ".env"));
  for (const key of [
    "CREEZIO_REGISTRY",
    "CREEZIO_REGISTRY_BASIC",
    "CREEZIO_REGISTRY_AUTH",
  ]) {
    const v = ((env[key] || "").trim() || (adminDotEnv[key] || "").trim());
    if (v) runArgs.push("-e", `${key}=${v}`);
  }
  const mounts = new Set<string>(cfg.brandRoots);
  mounts.add(ar.root);
  for (const root of mounts) {
    runArgs.push("-v", `${root}:${root}`);
  }
  runArgs.push(ADMIN_IMAGE);
  run("docker", runArgs, env);

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${cfg.port}/admin/api/health`, {
        headers: {
          authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`,
        },
      });
      if (res.status === 200) break;
    } catch {
      /* warming */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`✓ Creezio Server Admin : http://127.0.0.1:${cfg.port}/admin`);
  console.log(
    `  login ${cfg.user} — mot de passe dans ${path.relative(process.cwd(), ar.runtimeFile)}`,
  );
}

/* ----------------------------------------------------- publish (registry) */

/** Tag docker valide (version). */
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function resolveRegistry(args: ServerDockerArgs): string {
  return (args.registry || process.env.CREEZIO_REGISTRY || "")
    .trim()
    .replace(/\/+$/, "");
}

/** Repo image versionnée d'une marque : creezio-server-<brand>[-browser]. */
export function publishRepoName(
  brandId: string,
  variant: "base" | "browser" = "base",
): string {
  return `creezio-server-${brandId}${variant === "browser" ? "-browser" : ""}`;
}

/** Image complète registry : <registry>/creezio-server-<brand>:<tag>. */
export function publishImageName(
  registry: string,
  brandId: string,
  tag: string,
  variant: "base" | "browser" = "base",
): string {
  return `${registry.replace(/\/+$/, "")}/${publishRepoName(brandId, variant)}:${tag}`;
}

function ensureGhcrLogin(paths: ReturnType<typeof resolvePaths>): void {
  for (const dir of [paths.brandRoot, paths.kit]) {
    const f = path.join(dir, ".github-token");
    if (!fs.existsSync(f)) continue;
    const token = fs.readFileSync(f, "utf8").trim();
    if (!token) continue;
    const user = process.env.CREEZIO_GHCR_USER || "creezio";
    const r = spawnSync(
      "docker",
      ["login", "ghcr.io", "-u", user, "--password-stdin"],
      { input: token, encoding: "utf8" },
    );
    if (r.status === 0) {
      console.log("✓ docker login ghcr.io (token .github-token)");
    } else {
      console.log(`⚠ docker login ghcr.io KO: ${(r.stderr || "").trim()}`);
    }
    return;
  }
  console.log("⚠ pas de .github-token — docker push ghcr.io suppose un login existant");
}

/** Digest (sha256:…) d'une image locale après push — RepoDigests. */
function imageDigestOf(image: string): string | null {
  const r = spawnSync(
    "docker",
    ["image", "inspect", "--format", "{{range .RepoDigests}}{{.}}\n{{end}}", image],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  for (const line of String(r.stdout || "").split("\n")) {
    const m = line.trim().match(/@(sha256:[0-9a-f]{64})$/);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * Déclare une release dans l'app admin de marque (F5) —
 * POST /api/v1/modules/fleet-releases/releases (status draft ; le rollout se
 * pilote ensuite depuis /flotte). Idempotent : re-publish même tag → update.
 */
export async function declareFleetRelease(opts: {
  adminAppUrl: string;
  brandId: string;
  tag: string;
  image: string;
  digest?: string | null;
  variant?: "base" | "browser";
  channel?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const base = opts.adminAppUrl.trim().replace(/\/+$/, "");
  const doFetch = opts.fetchImpl || fetch;
  try {
    const res = await doFetch(`${base}/api/v1/modules/fleet-releases/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandId: opts.brandId,
        tag: opts.tag,
        image: opts.image,
        digest: opts.digest || undefined,
        variant: opts.variant || "base",
        channel: opts.channel || "stable",
        status: "draft",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if ((res.status !== 200 && res.status !== 201) || !json.ok) {
      return {
        ok: false,
        status: res.status,
        error: json.error || "réponse invalide",
      };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: String((e as Error)?.message || e) };
  }
}

async function runPublishSubcommand(
  args: ServerDockerArgs,
  paths: ReturnType<typeof resolvePaths>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const tag = (args.tag || "").trim();
  if (!tag || !TAG_RE.test(tag)) {
    throw new Error(
      "creezio server-docker publish --tag <version> (ex. --tag 0.2.0)",
    );
  }
  const registry = resolveRegistry(args);
  if (!registry) {
    throw new Error(
      "--registry ou env CREEZIO_REGISTRY requis (ex. 127.0.0.1:5000 ou ghcr.io/creezio)",
    );
  }
  const brandId = String(env.BRAND_ID);
  const variant = args.browser ? ("browser" as const) : ("base" as const);
  const image = publishImageName(registry, brandId, tag, variant);
  const localImage = serverImageName(brandId, variant);
  const imageSource = requireImageSourceForRegistry(
    registry,
    resolveBrandGithubSourceUrl(paths.brandRoot),
  );
  if (imageSource) {
    console.log(`  ${OCI_IMAGE_SOURCE_LABEL}=${imageSource}`);
  }
  console.log(`build image versionnée ${image} (variant ${variant})…`);
  dockerBuildImage(paths, env, {
    variant,
    image,
    extraTags: [localImage],
    version: tag,
    imageSource,
  });
  console.log(`✓ image construite : ${image} (alias local ${localImage})`);
  if (args.noPush) {
    console.log("--no-push : build seulement (pas de push registry)");
    return;
  }
  if (/^ghcr\.io(\/|$)/.test(registry)) ensureGhcrLogin(paths);
  run("docker", ["push", image], env);
  console.log(`✓ push ${image}`);
  console.log(
    `  update flotte : creezio server-docker update <nom> --brand-root … --image ${image}`,
  );
  console.log(
    `  (défaut sans nouveau backup ; opt-in : --backup / API {"backup":true})`,
  );
  // Référence publique pull-only (F4) : le MÊME repo/tag vu à travers
  // l'ingress registry.{zone} → proxy /v2/* du Creezio Server Admin. Pas de
  // second push (même registre) — on tague localement + on affiche la
  // référence que les VPS distants doivent puller (Basic hostId:agentToken).
  const publicHost = (
    args.publicHost ||
    env.CREEZIO_REGISTRY_PUBLIC_HOST ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (publicHost) {
    const publicImage = publishImageName(publicHost, brandId, tag, variant);
    run("docker", ["tag", image, publicImage], env);
    console.log(`✓ référence publique : ${publicImage}`);
    console.log(
      `  pull distant : docker login ${publicHost} -u <hostId> -p <agentToken> && docker pull ${publicImage}`,
    );
  }
  // Déclaration de release dans l'app admin (F5) : les agents en pull la
  // verront dès qu'elle passera `rolling` (pilotage /flotte). L'image
  // annoncée est la référence PUBLIQUE si dispo (résoluble des VPS distants).
  if (args.release) {
    const adminApp = (
      args.adminApp ||
      env.CREEZIO_FLEET_ADMIN_URL ||
      ""
    )
      .trim()
      .replace(/\/+$/, "");
    if (!adminApp) {
      console.log(
        "⚠ --release ignoré : --admin-app <url> ou CREEZIO_FLEET_ADMIN_URL requis",
      );
    } else {
      const releaseImage = publicHost
        ? publishImageName(publicHost, brandId, tag, variant)
        : image;
      const digest = imageDigestOf(image);
      const r = await declareFleetRelease({
        adminAppUrl: adminApp,
        brandId,
        tag,
        image: releaseImage,
        digest,
        variant,
        channel: args.channel,
      });
      if (r.ok) {
        console.log(
          `✓ release déclarée (draft) : ${brandId}:${tag}${digest ? ` @${digest.slice(0, 19)}…` : ""} → ${adminApp}`,
        );
        console.log("  passer en rolling : UI /flotte (ou PUT fleet-releases/releases/<id>)");
      } else {
        console.log(
          `⚠ déclaration release KO (${r.status}): ${r.error} — publish réussi, déclarer manuellement`,
        );
      }
    }
  }
  if (args.noRetention) {
    console.log("--no-retention : pas de nettoyage post-publish");
    return;
  }
  await runPublishRetention({
    registry,
    repo: publishRepoName(brandId, variant),
    justPushedTag: tag,
    keepTags: resolvePublishKeepTags(args, env),
    brandRoot: paths.brandRoot,
    env,
  });
}

/* ------------------------------------------------ rétention post-publish */

// Rétention agressive (décision 2026-08-06, disque VPS saturé à 91 %) :
// 2 tags = version courante + rollback 1 cran ; cache builder plafonné 5GB.
const PUBLISH_KEEP_TAGS_DEFAULT = 2;
const PUBLISH_KEEP_STORAGE_DEFAULT = "5GB";

function resolvePublishKeepTags(
  args: ServerDockerArgs,
  env: NodeJS.ProcessEnv,
): number {
  const raw =
    args.keepTags ?? Number((env.CREEZIO_PUBLISH_KEEP_TAGS || "").trim());
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  return PUBLISH_KEEP_TAGS_DEFAULT;
}

function dockerCapture(argv: string[]): string {
  const r = spawnSync("docker", argv, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : "";
}

/** Base(s) URL de l'API v2 d'un registre privé (jamais ghcr.io). */
function privateRegistryBases(registry: string): string[] {
  if (/^ghcr\.io(\/|$)/.test(registry)) return [];
  const host = registry.replace(/^https?:\/\//, "").split("/")[0];
  if (!host) return [];
  return /^(127\.|localhost)/.test(host)
    ? [`http://${host}`]
    : [`https://${host}`, `http://${host}`];
}

async function registryFetch(
  bases: string[],
  pathname: string,
  init?: RequestInit,
): Promise<Response | null> {
  for (const base of bases) {
    try {
      return await fetch(`${base}${pathname}`, init);
    } catch {
      /* base suivante */
    }
  }
  return null;
}

const MANIFEST_ACCEPT =
  "application/vnd.docker.distribution.manifest.v2+json, " +
  "application/vnd.oci.image.manifest.v1+json, " +
  "application/vnd.oci.image.index.v1+json, " +
  "application/vnd.docker.distribution.manifest.list.v2+json";

/**
 * Nettoyage après un push réussi. Daemon + build cache = best-effort
 * (ne fait pas échouer le publish). Registre local = best-effort.
 * Cible `ghcr.io` = fail-closed (auth / API Packages).
 */
function publishProtectedTags(opts: {
  repo: string;
  justPushedTag: string;
  brandRoot?: string;
}): string[] {
  const protect = new Set<string>([opts.justPushedTag]);
  const root = (opts.brandRoot || "").trim();
  if (root) {
    const file = path.join(root, "docker-data", "servers.json");
    const refs = serversFileImageRefs(file);
    if (refs) {
      for (const ref of refs) {
        const parsed = parseImageRef(ref);
        if (parsed?.repo === opts.repo && parsed.tag) protect.add(parsed.tag);
      }
    }
  }
  return [...protect];
}

async function runPublishRetention(opts: {
  registry: string;
  repo: string;
  justPushedTag: string;
  keepTags: number;
  brandRoot?: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const { registry, repo, justPushedTag, keepTags } = opts;
  const imageRef = `${registry.replace(/\/+$/, "")}/${repo}`;
  const protect = publishProtectedTags({
    repo,
    justPushedTag,
    brandRoot: opts.brandRoot,
  });

  // 1. Vieilles images du daemon local.
  const localTags = dockerCapture([
    "image",
    "ls",
    "--format",
    "{{.Tag}}",
    imageRef,
  ])
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t && t !== "<none>" && TAG_RE.test(t));
  for (const t of selectTagsToPrune(localTags, keepTags, protect)) {
    const r = spawnSync("docker", ["rmi", `${imageRef}:${t}`], {
      encoding: "utf8",
    });
    if (r.status === 0) {
      console.log(`✓ rétention daemon : image supprimée ${imageRef}:${t}`);
    } else {
      console.log(
        `⚠ rétention daemon : ${imageRef}:${t} conservée (${(r.stderr || "").trim().split("\n")[0] || "docker rmi KO"})`,
      );
    }
  }

  // 2. Build cache au-delà du budget. Attention sémantique BuildKit :
  // `--keep-storage` (alias de --reserved-space) est un plancher « toujours
  // autorisé » et ne purge donc JAMAIS tant que le cache prunable tient sous
  // ce budget (vécu VPS kit : cache 23,5 Go, prune --keep-storage 12GB
  // → « Total: 0B »). C'est `--max-used-space` qui plafonne réellement
  // l'usage total ; fallback --keep-storage pour les daemons plus anciens.
  const keepStorage =
    (opts.env.CREEZIO_PUBLISH_KEEP_STORAGE || "").trim() ||
    PUBLISH_KEEP_STORAGE_DEFAULT;
  let pr = spawnSync(
    "docker",
    ["builder", "prune", "--max-used-space", keepStorage, "-f"],
    { encoding: "utf8" },
  );
  let pruneFlag = "--max-used-space";
  if (pr.status !== 0 && /unknown flag|unknown option/i.test(pr.stderr || "")) {
    pruneFlag = "--keep-storage";
    pr = spawnSync(
      "docker",
      ["builder", "prune", "--keep-storage", keepStorage, "-f"],
      { encoding: "utf8" },
    );
  }
  if (pr.status === 0) {
    const total = (pr.stdout || "").trim().split("\n").pop() || "";
    console.log(`✓ rétention build cache (${pruneFlag} ${keepStorage}) : ${total}`);
  } else {
    console.log("⚠ docker builder prune KO — cache non purgé");
  }

  // 3. Vieux tags du registre : local (API v2) ou GHCR (Packages API).
  if (isGhcrRegistry(registry)) {
    await runGhcrPublishRetention({
      registry,
      repo,
      justPushedTag,
      keepTags,
      brandRoot: opts.brandRoot,
      env: opts.env,
    });
    return;
  }
  const bases = privateRegistryBases(registry);
  if (!bases.length) return;
  const tagsRes = await registryFetch(bases, `/v2/${repo}/tags/list`);
  if (!tagsRes || !tagsRes.ok) {
    console.log("⚠ rétention registre : API v2 injoignable — sautée");
    return;
  }
  const remoteTags = (
    ((await tagsRes.json()) as { tags?: string[] }).tags || []
  ).filter((t) => TAG_RE.test(t));
  const prune = selectTagsToPrune(remoteTags, keepTags, protect);
  if (!prune.length) return;

  const digestOf = async (t: string): Promise<string> => {
    const res = await registryFetch(bases, `/v2/${repo}/manifests/${t}`, {
      method: "HEAD",
      headers: { accept: MANIFEST_ACCEPT },
    });
    return res?.ok ? res.headers.get("docker-content-digest") || "" : "";
  };
  const keptDigests = new Set<string>();
  for (const t of remoteTags.filter((x) => !prune.includes(x))) {
    const d = await digestOf(t);
    if (d) keptDigests.add(d);
  }
  for (const t of prune) {
    const d = await digestOf(t);
    if (!d) {
      console.log(`⚠ rétention registre : digest introuvable pour ${repo}:${t}`);
      continue;
    }
    if (keptDigests.has(d)) {
      console.log(
        `  rétention registre : ${repo}:${t} partage le digest d'un tag conservé — ignoré`,
      );
      continue;
    }
    const del = await registryFetch(bases, `/v2/${repo}/manifests/${d}`, {
      method: "DELETE",
    });
    if (del && (del.ok || del.status === 202)) {
      console.log(`✓ rétention registre : tag supprimé ${repo}:${t}`);
    } else {
      console.log(
        `⚠ rétention registre : échec suppression ${repo}:${t} (HTTP ${del?.status ?? "?"} — delete.enabled ?)`,
      );
    }
  }
  console.log(
    "  blobs registre : balayés par la GC planifiée hôte (registry garbage-collect)",
  );
}

/* -------------------------------------------------- agent hôte + enroll */

const AGENT_IMAGE = "creezio-host-agent:local";
const AGENT_CONTAINER = "creezio-host-agent";
const AGENT_DEFAULT_PORT = 18810;
const AGENT_DEFAULT_BIND_HOSTS = "127.0.0.1,172.17.0.1";

type AgentTokenEntry = {
  id: string;
  hash: string;
  label: string | null;
  createdAt: string;
  revokedAt?: string;
};

type AgentState = {
  version: 1;
  hostId: string;
  label: string;
  port: number;
  bindHosts: string;
  brandRoots: string[];
  tokens: AgentTokenEntry[];
  adminUrl?: string | null;
  agentUrl?: string | null;
  /** App admin de marque (module fleet-releases) — updates en pull (F5). */
  adminAppUrl?: string | null;
  /** Credential flotte sortant (= agentToken émis à l'enroll) — F4 pull registre + F5 poll. */
  fleetKey?: string | null;
  /**
   * T7 : tunnel cloudflared DÉDIÉ agent (container creezio-agent-tunnel),
   * provisionné à l'enroll. Le token du connecteur vit dans
   * `docker-data/agent-tunnel.env` (600) — jamais ici.
   */
  agentTunnel?: {
    tunnelId: string;
    hostname: string;
    container?: string;
    provisionedAt?: string;
  } | null;
};

function agentStatePath(brandRoot: string): string {
  return path.join(brandRoot, "docker-data", "host-agent.json");
}

function sha256Token(token: string): string {
  return (
    "sha256:" + crypto.createHash("sha256").update(token).digest("hex")
  );
}

function loadOrInitAgentState(
  brandRoot: string,
  args?: ServerDockerArgs,
): AgentState {
  const file = agentStatePath(brandRoot);
  let st: AgentState | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as AgentState;
    if (raw && raw.hostId && Array.isArray(raw.tokens)) st = raw;
  } catch {
    /* premier up */
  }
  if (!st) {
    st = {
      version: 1,
      hostId: `host-${crypto.randomBytes(4).toString("hex")}`,
      label: args?.label || os.hostname(),
      port: AGENT_DEFAULT_PORT,
      bindHosts: AGENT_DEFAULT_BIND_HOSTS,
      brandRoots: [brandRoot],
      tokens: [],
      adminUrl: null,
      agentUrl: null,
    };
  }
  if (args?.port && args.port > 0) st.port = args.port;
  if (args?.bindHosts) st.bindHosts = args.bindHosts;
  if (args?.label) st.label = args.label;
  if (!st.brandRoots.includes(brandRoot)) st.brandRoots.push(brandRoot);
  saveAgentState(brandRoot, st);
  return st;
}

function saveAgentState(brandRoot: string, st: AgentState): void {
  const file = agentStatePath(brandRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(st, null, 2) + "\n", { mode: 0o600 });
}

/** Génère un token agent (hash stocké, clair retourné UNE fois). */
function issueAgentToken(
  brandRoot: string,
  st: AgentState,
  label: string | null,
): { id: string; token: string } {
  const token = crypto.randomBytes(24).toString("hex");
  const entry: AgentTokenEntry = {
    id: crypto.randomBytes(4).toString("hex"),
    hash: sha256Token(token),
    label,
    createdAt: new Date().toISOString(),
  };
  st.tokens.push(entry);
  saveAgentState(brandRoot, st);
  return { id: entry.id, token };
}

async function agentPing(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/agent/ping`);
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Écrit docker-data/agent-tunnel.env (chmod 600) — token connecteur, jamais loggé. */
function writeAgentTunnelEnv(brandRoot: string, tunnelToken: string): string {
  const file = agentTunnelEnvPath(brandRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderAgentTunnelEnvFile(tunnelToken), {
    mode: 0o600,
  });
  fs.chmodSync(file, 0o600);
  return file;
}

/**
 * Résout le hostname CRM + tunnel d'instance pour un slug agent
 * (kernel /data si l'instance existe encore — sinon null).
 */
async function lookupKernelTunnelForSlug(
  kit: string,
  brandRoot: string,
  slug: string,
  brandId: string,
): Promise<{
  hostname: string;
  tunnelId: string;
  tunnelToken: string;
  slug: string;
} | null> {
  const stack = await importInstanceStack(kit);
  const registry = loadServerRegistry(brandRoot, brandId);
  let kc: ReturnType<typeof stack.readKernelTunnelConfig> = null;
  for (const i of registry.instances) {
    if (i.name !== slug) continue;
    kc = stack.readKernelTunnelConfig(brandRoot, i, brandId);
    break;
  }
  if (!kc) {
    for (const i of registry.instances) {
      const c = stack.readKernelTunnelConfig(brandRoot, i, brandId);
      if (c && c.slug === slug) {
        kc = c;
        break;
      }
    }
  }
  if (!kc?.hostname) return null;
  return {
    hostname: kc.hostname,
    tunnelId: kc.tunnelId || "",
    tunnelToken: kc.tunnelToken || "",
    slug: kc.slug || slug,
  };
}

type DedicatedAgentTunnelResult = {
  agentUrl: string;
  hostname: string;
  tunnelId: string;
};

/**
 * Provision idempotent du tunnel dédié agent : ensure CF (ingress seul) →
 * env file 600 → connecteur up → bascule DNS → retrait d'une règle agent
 * résiduelle sur un tunnel d'instance (si encore présent).
 */
async function provisionDedicatedAgentTunnel(opts: {
  kit: string;
  brandRoot: string;
  brandId: string;
  state: AgentState;
  slug: string;
  serverHostname?: string;
  sharedTunnelId?: string | null;
}): Promise<DedicatedAgentTunnelResult> {
  const cf = await importTunnelCf(opts.kit);
  const cfVars = resolveCliCfEnv(opts.brandRoot);
  const cfEnv = cfEnvFromMerged(cf, cfVars);
  if (!cfEnv) {
    const missing = cf.missingCfTunnelEnvKeys({
      ...process.env,
      ...cfVars,
    } as NodeJS.ProcessEnv);
    throw new Error(
      `hôte enrôlé sans tunnel dédié — migration automatique impossible : ` +
        `contrat Cloudflare incomplet (${missing.join(", ")} requis). ` +
        `Poser CREEZIO_CF_API_TOKEN / CREEZIO_CF_ACCOUNT_ID / CREEZIO_CF_ZONE_ID ` +
        `dans l'env ou le .env marque, puis relancer \`creezio server-docker agent up\`.`,
    );
  }
  let serverHostname = (opts.serverHostname || "").trim().toLowerCase();
  let sharedTunnelId = (opts.sharedTunnelId || "").trim();
  if (!serverHostname || !sharedTunnelId) {
    const kc = await lookupKernelTunnelForSlug(
      opts.kit,
      opts.brandRoot,
      opts.slug,
      opts.brandId,
    );
    if (kc) {
      if (!serverHostname) serverHostname = kc.hostname;
      if (!sharedTunnelId) sharedTunnelId = kc.tunnelId;
    }
  }
  if (!serverHostname) {
    const zoneName = (cfVars.CREEZIO_CF_ZONE_NAME || "").trim().toLowerCase();
    if (zoneName) serverHostname = `${opts.slug}.${zoneName}`;
  }
  if (!serverHostname) {
    throw new Error(
      `tunnel agent dédié ${opts.slug} : hostname CRM introuvable — ` +
        `passer --slug <slug> (instance encore présente) ou poser ` +
        `CREEZIO_CF_ZONE_NAME pour dériver {slug}.{zone}`,
    );
  }
  console.log(
    `tunnel agent dédié ${opts.slug} → 127.0.0.1:${opts.state.port} ` +
      `(API Cloudflare, container ${AGENT_TUNNEL_CONTAINER})…`,
  );
  const storedToken = readEnvFileValues(agentTunnelEnvPath(opts.brandRoot))
    .TUNNEL_TOKEN;
  const ensured = await cf.ensureCfAgentTunnel(cfEnv, {
    slug: opts.slug,
    serverHostname,
    agentPort: opts.state.port,
    originHost: "127.0.0.1",
    dns: false,
    stored: {
      tunnelId: opts.state.agentTunnel?.tunnelId,
      tunnelToken: storedToken,
    },
    log: (s) => console.log(`  ${s}`),
  });
  const envFile = writeAgentTunnelEnv(opts.brandRoot, ensured.tunnelToken);
  ensureAgentTunnelContainer({ env: process.env, envFile, recreate: true });
  const dns = await cf.ensureCfAgentTunnelDns(cfEnv, {
    hostname: ensured.hostname,
    tunnelId: ensured.tunnelId,
    slug: opts.slug,
  });
  console.log(`  DNS agent ${ensured.hostname} → tunnel dédié (${dns})`);
  if (sharedTunnelId) {
    try {
      const removed = await cf.removeCfTunnelAgentRule(cfEnv, {
        tunnelId: sharedTunnelId,
        agentHostname: ensured.hostname,
      });
      if (removed) {
        console.log(
          "✓ règle agent résiduelle retirée du tunnel de l'instance",
        );
      }
    } catch (e) {
      console.log(
        `⚠ retrait règle agent résiduelle (best-effort) : ${(e as Error)?.message || e}`,
      );
    }
  }
  const dedicatedUrl = canonicalDedicatedAgentUrl({
    provisionedUrl: ensured.agentUrl,
    hostname: ensured.hostname,
  });
  opts.state.agentTunnel = {
    tunnelId: ensured.tunnelId,
    hostname: ensured.hostname,
    container: AGENT_TUNNEL_CONTAINER,
    provisionedAt: new Date().toISOString(),
  };
  applyDedicatedAgentUrlToHostState(opts.state, dedicatedUrl);
  saveAgentState(opts.brandRoot, opts.state);
  console.log(`✓ tunnel agent dédié : ${dedicatedUrl}`);
  return {
    agentUrl: dedicatedUrl,
    hostname: ensured.hostname,
    tunnelId: ensured.tunnelId,
  };
}

/**
 * (Re)démarre le container cloudflared dédié agent (T7 — network host,
 * restart unless-stopped, token via --env-file 600 uniquement).
 * `recreate: true` (enroll / migration — token potentiellement neuf) → rm -f + run ;
 * `recreate: false` (agent up — reprise) → start si arrêté, run si absent.
 */
function ensureAgentTunnelContainer(opts: {
  env: NodeJS.ProcessEnv;
  envFile: string;
  recreate: boolean;
}): void {
  const st = dockerContainerState(AGENT_TUNNEL_CONTAINER);
  if (st.exists && !opts.recreate) {
    if (!st.running) run("docker", ["start", AGENT_TUNNEL_CONTAINER], opts.env);
    return;
  }
  if (st.exists) run("docker", ["rm", "-f", AGENT_TUNNEL_CONTAINER], opts.env);
  run(
    "docker",
    buildAgentTunnelRunArgs({
      image: resolveAgentTunnelImage(opts.env),
      envFile: opts.envFile,
    }),
    opts.env,
  );
}

/**
 * Après provision/reprise du tunnel dédié : persiste l'URL canonique dans
 * host-agent.json ET toutes les SoT admin (fleet-hosts.json locaux +
 * POST /admin/api/hosts/agent-url). Idempotent. Fail-closed si l'URL
 * ne peut pas être dérivée, ou si l'hôte est enrôlé sans SoT admin
 * joignable (l'admin continuerait de sonder l'ancienne URL nested).
 * `fleet-hosts.json` root:root 600 : écriture via `sudo -n`, sinon
 * POST admin (container). Jamais d'abort EACCES brut ni chmod manuel.
 */
async function persistDedicatedAgentUrlAfterUp(opts: {
  brandRoot: string;
  state: AgentState;
  provisionedUrl?: string | null;
  adminRoot?: string | null;
}): Promise<string> {
  const dedicatedUrl = canonicalDedicatedAgentUrl({
    provisionedUrl: opts.provisionedUrl,
    hostname: opts.state.agentTunnel?.hostname,
  });
  if (applyDedicatedAgentUrlToHostState(opts.state, dedicatedUrl)) {
    saveAgentState(opts.brandRoot, opts.state);
    console.log(`✓ agentUrl persisté (host-agent.json) : ${dedicatedUrl}`);
  }

  const extraRoots: string[] = [];
  const fromContainer = inspectAdminRootFromContainer();
  if (fromContainer) extraRoots.push(fromContainer);
  const files = discoverFleetHostsJsonPaths({
    brandRoot: opts.brandRoot,
    adminRoot: opts.adminRoot,
    extraRoots,
  });
  let fleetFound = false;
  const deniedFiles: string[] = [];
  for (const file of files) {
    const r = persistDedicatedAgentUrlInFleetHostsFile(
      file,
      opts.state.hostId,
      dedicatedUrl,
    );
    if (r.permissionDenied) {
      deniedFiles.push(file);
      console.log(
        `⚠ ${file} : EACCES (root:root 600 typique) — sudo -n impossible, ` +
          `on pousse via POST /admin/api/hosts/agent-url`,
      );
      continue;
    }
    if (r.found) fleetFound = true;
    if (r.changed) {
      console.log(`✓ agentUrl persisté (${file}) : ${dedicatedUrl}`);
    }
  }

  const adminUrl = String(opts.state.adminUrl || "").trim().replace(/\/+$/, "");
  const fleetKey = String(opts.state.fleetKey || "").trim();
  let apiOk = false;
  let adminDetail = adminUrl
    ? `${adminUrl} injoignable`
    : "adminUrl absente de host-agent.json";
  if (adminUrl && fleetKey) {
    try {
      const res = await fetch(`${adminUrl}/admin/api/hosts/agent-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: opts.state.hostId,
          agentUrl: dedicatedUrl,
          agentToken: fleetKey,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.status === 200 && json.ok) {
        apiOk = true;
        console.log(`✓ agentUrl poussé à l'admin (${adminUrl}) : ${dedicatedUrl}`);
      } else if (fleetFound) {
        console.log(
          `⚠ admin agentUrl (${res.status}): ${json.error || "réponse invalide"} — SoT locale à jour`,
        );
      } else {
        adminDetail = `${adminUrl} (${res.status}): ${json.error || "réponse invalide"}`;
      }
    } catch (e) {
      if (fleetFound) {
        console.log(
          `⚠ admin agentUrl injoignable : ${(e as Error)?.message || e} — SoT locale à jour`,
        );
      } else {
        adminDetail = `${adminUrl} : ${(e as Error)?.message || e}`;
      }
    }
  }

  if ((adminUrl || fleetKey || deniedFiles.length) && !fleetFound && !apiOk) {
    throw new Error(
      deniedFiles.length
        ? formatFleetHostsEaccesError({
            dedicatedUrl,
            deniedFiles,
            adminDetail,
          })
        : `hôte enrôlé : agentUrl dédiée ${dedicatedUrl} écrite dans host-agent.json ` +
            `mais fleet-hosts.json introuvable et admin injoignable. ` +
            `L'admin flotte continuerait de sonder l'ancienne URL nested. ` +
            `Poser --admin-root <repo-admin> ou relancer avec l'admin up.`,
    );
  }
  return dedicatedUrl;
}

async function runAgentSubcommand(
  args: ServerDockerArgs,
  paths: ReturnType<typeof resolvePaths>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const action = args.rest[0] || "status";
  const brandRoot = paths.brandRoot;

  if (action === "token") {
    const st = loadOrInitAgentState(brandRoot);
    const op = args.rest[1] || "ls";
    if (op === "new") {
      const { id, token } = issueAgentToken(brandRoot, st, args.label || null);
      console.log(`+ token agent id=${id} (affiché UNE fois) :`);
      console.log(token);
      return;
    }
    if (op === "revoke") {
      const id = args.rest[2];
      const entry = st.tokens.find((t) => t.id === id);
      if (!entry) throw new Error(`token inconnu: ${id}`);
      entry.revokedAt = new Date().toISOString();
      saveAgentState(brandRoot, st);
      console.log(`✓ token ${id} révoqué`);
      return;
    }
    console.log(`${"ID".padEnd(10)}${"LABEL".padEnd(24)}${"CRÉÉ".padEnd(26)}RÉVOQUÉ`);
    for (const t of st.tokens) {
      console.log(
        `${t.id.padEnd(10)}${String(t.label || "-").padEnd(24)}${t.createdAt.padEnd(26)}${t.revokedAt || "-"}`,
      );
    }
    return;
  }

  if (action === "down") {
    const st = dockerContainerState(AGENT_CONTAINER);
    if (st.exists) run("docker", ["rm", "-f", AGENT_CONTAINER], env);
    console.log("✓ agent hôte arrêté");
    return;
  }

  if (action === "status") {
    const st = dockerContainerState(AGENT_CONTAINER);
    const state = loadOrInitAgentState(brandRoot);
    console.log(
      `agent ${AGENT_CONTAINER}: ${st.status}${st.health ? ` (${st.health})` : ""}`,
    );
    console.log(`  hostId : ${state.hostId} (${state.label})`);
    console.log(`  port   : ${state.port} (bind ${state.bindHosts})`);
    console.log(`  tokens : ${state.tokens.filter((t) => !t.revokedAt).length} actifs`);
    if (state.agentUrl) console.log(`  URL    : ${state.agentUrl}`);
    if (state.adminUrl) console.log(`  admin  : ${state.adminUrl}`);
    // T7 : container cloudflared dédié agent (provisionné à l'enroll).
    const tun = dockerContainerState(AGENT_TUNNEL_CONTAINER);
    if (state.agentTunnel || tun.exists) {
      console.log(
        `  tunnel : ${AGENT_TUNNEL_CONTAINER} ${tun.status}` +
          (state.agentTunnel
            ? ` (${state.agentTunnel.hostname}, tunnel ${state.agentTunnel.tunnelId})`
            : ""),
      );
    } else {
      console.log("  tunnel : dédié non provisionné");
    }
    return;
  }

  if (action === "rm") {
    const state = loadOrInitAgentState(brandRoot);
    const tun = dockerContainerState(AGENT_TUNNEL_CONTAINER);
    if (tun.exists) run("docker", ["rm", "-f", AGENT_TUNNEL_CONTAINER], env);
    const parsed = parseAgentPublicUrl(state.agentUrl || "");
    const slug = (
      args.slug ||
      parsed?.slugGuess ||
      ""
    )
      .trim()
      .toLowerCase();
    const hostname = (state.agentTunnel?.hostname || parsed?.hostname || "").trim();
    if (state.agentTunnel?.tunnelId || hostname || slug) {
      if (!slug) {
        throw new Error(
          "agent rm : --slug <slug> requis (impossible de dériver le slug depuis l'URL agent)",
        );
      }
      const cf = await importTunnelCf(paths.kit);
      const cfVars = resolveCliCfEnv(brandRoot);
      const cfEnv = cfEnvFromMerged(cf, cfVars);
      if (!cfEnv) {
        const missing = cf.missingCfTunnelEnvKeys({
          ...process.env,
          ...cfVars,
        } as NodeJS.ProcessEnv);
        throw new Error(
          `agent rm : contrat Cloudflare incomplet (${missing.join(", ")} requis) ` +
            `pour retirer le tunnel/DNS agent de ${slug}. Poser CREEZIO_CF_* ` +
            `dans l'env ou le .env marque, puis relancer \`creezio server-docker agent rm --slug ${slug}\`.`,
        );
      }
      const brandId = String(composeEnv(paths).BRAND_ID);
      const kc = await lookupKernelTunnelForSlug(
        paths.kit,
        brandRoot,
        slug,
        brandId,
      );
      if (kc?.tunnelId && hostname) {
        try {
          await cf.removeCfTunnelAgentRule(cfEnv, {
            tunnelId: kc.tunnelId,
            agentHostname: hostname,
          });
        } catch (e) {
          console.log(
            `⚠ retrait règle agent résiduelle (best-effort) : ${(e as Error)?.message || e}`,
          );
        }
      }
      const r = await cf.deprovisionCfAgentTunnel(cfEnv, {
        slug,
        hostname: hostname || undefined,
        tunnelId: state.agentTunnel?.tunnelId || undefined,
        log: (s) => console.log(`  ${s}`),
      });
      console.log(
        `✓ Cloudflare agent nettoyé — dns: ${r.removed.dns.length} enregistrement(s), tunnel: ${r.removed.tunnel || "aucun"}`,
      );
    }
    const envFile = agentTunnelEnvPath(brandRoot);
    if (fs.existsSync(envFile)) fs.rmSync(envFile, { force: true });
    state.agentTunnel = null;
    saveAgentState(brandRoot, state);
    console.log("✓ ressources tunnel agent retirées (host-agent inchangé — agent down pour l'arrêter)");
    return;
  }

  if (action !== "up") {
    throw new Error(`agent ${action} inconnu (up|down|status|rm|token)`);
  }

  const state = loadOrInitAgentState(brandRoot, args);
  // Préflight UFW fail-closed (incident 10–30/08/2026 : 18810 scoped docker0
  // → host-agent droppé 20 jours) : le tunnel `agent.{slug}` du conteneur
  // serveur joint l'agent via 172.17.0.1:<port> depuis les réseaux compose
  // (172.16.0.0/12) — règle posée automatiquement si absente, sinon erreur
  // avec la commande exacte.
  assertUfwFleetRule({ port: state.port, label: "host-agent" });
  const agentDockerfile = path.join(paths.kit, "docker/host-agent/Dockerfile");
  if (!fs.existsSync(agentDockerfile)) {
    throw new Error(`Dockerfile agent introuvable: ${agentDockerfile}`);
  }
  const agentContext = stageFleetImageContext(paths.kit);
  try {
    run(
      "docker",
      ["build", "-f", agentDockerfile, "-t", AGENT_IMAGE, agentContext],
      env,
    );
  } finally {
    fs.rmSync(agentContext, { recursive: true, force: true });
  }
  const st = dockerContainerState(AGENT_CONTAINER);
  if (st.exists) run("docker", ["rm", "-f", AGENT_CONTAINER], env);

  const runArgs = [
    "run",
    "-d",
    "--name",
    AGENT_CONTAINER,
    "--restart",
    "unless-stopped",
    // host network : serveurs marques publiés loopback + bind gateway bridge
    // (172.17.0.1) pour l'ingress tunnel `agent.{slug}` du container serveur.
    "--network",
    "host",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "--label",
    "creezio.host-agent=1",
    "-e",
    `CREEZIO_AGENT_PORT=${state.port}`,
    "-e",
    `CREEZIO_AGENT_HOSTS=${state.bindHosts}`,
    "-e",
    `CREEZIO_AGENT_BRAND_ROOTS=${state.brandRoots.join(":")}`,
    "-e",
    `CREEZIO_AGENT_STATE_FILE=${agentStatePath(brandRoot)}`,
  ];
  for (const key of ["CREEZIO_REGISTRY_AUTH"]) {
    const v = (env[key] || "").trim();
    if (v) runArgs.push("-e", `${key}=${v}`);
  }
  // Updates en pull (F5) : env process prioritaire, sinon state posé par
  // `enroll` (adminAppUrl/fleetKey) — l'agent relit aussi le state à chaud.
  const pullAdminUrl =
    (env.CREEZIO_AGENT_ADMIN_URL || "").trim() || (state.adminAppUrl || "").trim();
  const pullFleetKey =
    (env.CREEZIO_AGENT_FLEET_KEY || "").trim() || (state.fleetKey || "").trim();
  if (pullAdminUrl) runArgs.push("-e", `CREEZIO_AGENT_ADMIN_URL=${pullAdminUrl}`);
  if (pullFleetKey) runArgs.push("-e", `CREEZIO_AGENT_FLEET_KEY=${pullFleetKey}`);
  for (const root of state.brandRoots) {
    runArgs.push("-v", `${root}:${root}`);
  }
  runArgs.push(AGENT_IMAGE);
  run("docker", runArgs, env);

  for (let i = 0; i < 20; i++) {
    if (await agentPing(state.port)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(
    `✓ agent hôte flotte : http://127.0.0.1:${state.port}/agent/ping (hostId ${state.hostId})`,
  );
  const tunnelEnvFile = agentTunnelEnvPath(brandRoot);
  const envFileExists = fs.existsSync(tunnelEnvFile);
  let provisionedUrl: string | null = null;
  if (
    needsDedicatedAgentTunnelMigration({
      adminUrl: state.adminUrl,
      agentUrl: state.agentUrl,
      fleetKey: state.fleetKey,
      agentTunnel: state.agentTunnel,
      envFileExists,
    })
  ) {
    const parsed = parseAgentPublicUrl(state.agentUrl || "");
    const slug = (args.slug || parsed?.slugGuess || "").trim().toLowerCase();
    if (!slug) {
      throw new Error(
        "hôte enrôlé sans tunnel dédié — --slug <slug> requis pour migrer " +
          "(impossible de dériver le slug depuis l'URL agent). " +
          "Relancer `creezio server-docker agent up --slug <slug>`.",
      );
    }
    const brandId = String(composeEnv(paths).BRAND_ID);
    const provisioned = await provisionDedicatedAgentTunnel({
      kit: paths.kit,
      brandRoot,
      brandId,
      state,
      slug,
      serverHostname: parsed?.serverHostname,
    });
    provisionedUrl = provisioned.agentUrl;
  } else if (envFileExists) {
    ensureAgentTunnelContainer({ env, envFile: tunnelEnvFile, recreate: false });
    console.log(
      `✓ tunnel agent dédié : container ${AGENT_TUNNEL_CONTAINER} up` +
        (state.agentTunnel ? ` (${state.agentTunnel.hostname})` : ""),
    );
  }
  const canDeriveDedicatedUrl = Boolean(
    provisionedUrl || state.agentTunnel?.hostname,
  );
  const enrolled = Boolean(state.adminUrl || state.fleetKey);
  if (canDeriveDedicatedUrl || (envFileExists && enrolled)) {
    await persistDedicatedAgentUrlAfterUp({
      brandRoot,
      state,
      provisionedUrl,
      adminRoot: args.adminRoot,
    });
  }
  if (!state.adminUrl) {
    console.log(
      "  enrôler auprès de l'admin : creezio server-docker enroll --admin <url> --token <enrollToken> --slug <slug>",
    );
  }
}

/**
 * Enrôlement du VPS auprès de l'admin flotte :
 *   1. token agent dédié à l'admin (hashé localement, révocable)
 *   2. tunnel cloudflared DÉDIÉ agent (T7) si --slug : même geste que
 *      `agent up` (provision → connecteur → bascule DNS)
 *   3. POST {admin}/admin/api/enroll (authentifié par enrollToken)
 */
async function runEnrollSubcommand(
  args: ServerDockerArgs,
  paths: ReturnType<typeof resolvePaths>,
): Promise<void> {
  const adminUrl = (args.admin || "").trim().replace(/\/+$/, "");
  const enrollToken = (args.token || "").trim();
  if (!adminUrl || !enrollToken) {
    throw new Error(
      "creezio server-docker enroll --admin <url> --token <enrollToken> [--slug <slug>|--agent-url <url>]",
    );
  }
  const brandRoot = paths.brandRoot;
  const state = loadOrInitAgentState(brandRoot, args);
  // Préflight UFW fail-closed : le connecteur dédié (network host) joint
  // l'agent en loopback ; les stacks compose joignent 172.17.0.1:<port>
  // depuis 172.16.0.0/12 — sans la règle, l'hôte est enrôlé mais
  // injoignable (silencieux).
  assertUfwFleetRule({ port: state.port, label: "host-agent" });
  const agentRunning = dockerContainerState(AGENT_CONTAINER).running;
  if (!agentRunning) {
    console.log(
      "⚠ agent hôte non démarré — creezio server-docker agent up (l'enrôlement continue)",
    );
  }

  // URL publique de l'agent : explicite, ou tunnel cloudflared DÉDIÉ (T7 —
  // hostname agent.{slug} nested / agent-{slug}.{zone} flat, container
  // creezio-agent-tunnel). L'agent ne partage plus le cloudflared d'un
  // serveur applicatif : serveur down/recréé ≠ agent injoignable.
  let agentUrl = (args.agentUrl || "").trim().replace(/\/+$/, "");
  if (!agentUrl) {
    const slug = (args.slug || "").trim().toLowerCase();
    if (!slug) {
      throw new Error(
        "--slug <slug> (tunnel agent dédié via API Cloudflare) ou --agent-url <url> requis",
      );
    }
    const brandId = String(composeEnv(paths).BRAND_ID);
    const provisioned = await provisionDedicatedAgentTunnel({
      kit: paths.kit,
      brandRoot,
      brandId,
      state,
      slug,
    });
    agentUrl = provisioned.agentUrl;
  }

  const { id, token: agentToken } = issueAgentToken(
    brandRoot,
    state,
    `admin ${adminUrl}`,
  );
  console.log(`+ token agent id=${id} émis pour l'admin (hash local, révocable)`);

  const res = await fetch(`${adminUrl}/admin/api/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enrollToken,
      hostId: state.hostId,
      label: state.label,
      agentUrl,
      agentToken,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    verified?: boolean;
    error?: string;
  };
  if (res.status !== 200 || !json.ok) {
    throw new Error(
      `enroll KO (${res.status}): ${json.error || "réponse invalide"}`,
    );
  }
  state.adminUrl = adminUrl;
  state.agentUrl = agentUrl;
  // Updates en pull (F5) : le credential sortant de l'hôte est le MÊME
  // agentToken (state 0600) ; l'app admin (module fleet-releases) se pose
  // via --admin-app ou env CREEZIO_FLEET_ADMIN_URL.
  state.fleetKey = agentToken;
  const adminApp = (
    args.adminApp ||
    process.env.CREEZIO_FLEET_ADMIN_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (adminApp) state.adminAppUrl = adminApp;
  saveAgentState(brandRoot, state);
  console.log(
    `✓ hôte ${state.hostId} enrôlé auprès de ${adminUrl} (agent ${agentUrl}, vérifié=${json.verified ? "oui" : "pas encore"})`,
  );
  if (adminApp) {
    console.log(
      `  updates en pull : app admin ${adminApp} (recréer l'agent : creezio server-docker agent up)`,
    );
  } else {
    console.log(
      "  updates en pull : poser --admin-app <url app admin> (ou CREEZIO_FLEET_ADMIN_URL) puis agent up",
    );
  }
}

async function applyCreateOwner(
  port: number,
  ownerPolicy: CreateOwnerPolicy,
): Promise<void> {
  if (ownerPolicy.mode !== "create") return;
  const baseUrl = `http://127.0.0.1:${port}`;
  await applyFirstRunOwner({
    baseUrl,
    email: ownerPolicy.email,
    password: ownerPolicy.password,
  });
  console.log(`  ${formatOwnerLoginLog(ownerPolicy.email)}`);
  const demo = await assertInteractiveDemoScenarios({
    baseUrl,
    email: ownerPolicy.email,
    password: ownerPolicy.password,
  });
  console.log(`  démo interactive : ${demo.count} scénario(s)`);
}

async function runEnsureOwner(opts: {
  paths: ReturnType<typeof resolvePaths>;
  env: NodeJS.ProcessEnv;
  brandId: string;
  inst: ServerRegistryInstance;
  args: ServerDockerArgs;
}): Promise<void> {
  const { paths, env, brandId, inst, args } = opts;
  const stack = await importInstanceStack(paths.kit);
  const brandDotEnv = readEnvFileValues(path.join(paths.brandRoot, ".env"));
  const secretsFile = stack.secretsEnvPath(paths.brandRoot, inst);
  const secrets = stack.parseDotEnvFile(secretsFile);
  const merged = pickEnvValues(
    [args.env, env, brandDotEnv, secrets],
    [...CREATE_OWNER_ENV_KEYS, ...E2E_OWNER_ENV_KEYS],
  );
  let creds = resolveEnsureOwnerCreds(merged);

  const port = inst.stack
    ? stack.stackHostPort(inst.containerName) || inst.port
    : inst.port;
  if (!port) {
    throw new Error(
      `ensure-owner ${inst.name} : port hôte introuvable — instance up ?`,
    );
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const setup = await fetchSetupStatus({ baseUrl });

  if (!creds.owner && !setup.setupComplete) {
    throw new Error(
      [
        `ensure-owner ${inst.name} : setup incomplet et CREEZIO_OWNER_* absents.`,
        "Poser CREEZIO_OWNER_EMAIL + CREEZIO_OWNER_PASSWORD (env, .env marque, ou secrets.env)",
        "puis relancer — le fail-closed VPS n'est pas contourné.",
      ].join("\n"),
    );
  }

  if (!setup.setupComplete && creds.owner) {
    await applyFirstRunOwner({
      baseUrl,
      email: creds.owner.email,
      password: creds.owner.password,
    });
    console.log(`  first-run ${formatOwnerLoginLog(creds.owner.email)}`);
  } else if (setup.setupComplete) {
    console.log(
      `  setup déjà complet (${setup.username || "owner"}) — pas d'écrasement`,
    );
  }

  if (!creds.e2e) {
    const e2eEmail = defaultE2eEmail(inst.name, brandId);
    const e2ePassword = generateOwnerPassword();
    creds = { ...creds, e2e: { email: e2eEmail, password: e2ePassword } };
    console.log(`  e2e seed : ${formatOwnerLoginLog(e2eEmail)}`);
  }

  const e2e = creds.e2e!;
  const loginOk = await verifyOwnerLogin({
    baseUrl,
    email: e2e.email,
    password: e2e.password,
  });
  if (!loginOk) {
    const seeded = seedKitUserViaContainer({
      containerName: inst.containerName,
      email: e2e.email,
      password: e2e.password,
    });
    console.log(`  kit user ${seeded.action} — ${formatOwnerLoginLog(seeded.email)}`);
    const again = await verifyOwnerLogin({
      baseUrl,
      email: e2e.email,
      password: e2e.password,
    });
    if (!again) {
      throw new Error(
        `ensure-owner ${inst.name} : user seedé mais login KO — voir /api/v1/auth/login`,
      );
    }
  } else {
    console.log(`  login ok — ${formatOwnerLoginLog(e2e.email)}`);
  }

  const persistOwner = creds.owner
    ? creds.owner
    : setup.username
      ? { email: setup.username, password: "" }
      : null;
  stack.persistOwnerSecrets({
    brandRoot: paths.brandRoot,
    inst,
    owner: {
      email: persistOwner?.email,
      password: persistOwner?.password,
      e2eEmail: e2e.email,
      e2ePassword: e2e.password,
    },
  });
  console.log(
    `  persisté ${secretsFile} (chmod 600) — e-mails seulement, jamais le mot de passe`,
  );

  if (inst.stack) {
    stack.stackRecreateApp(paths.brandRoot, inst, { quiet: true });
    const hp = stack.stackHostPort(inst.containerName);
    if (hp) {
      stack.applyAllocatedHostPort(inst, hp);
      const registry = loadServerRegistry(paths.brandRoot, brandId);
      registry.instances = registry.instances.map((i) =>
        i.name === inst.name ? inst : i,
      );
      saveServerRegistry(paths.brandRoot, registry);
    }
    console.log(`  app recréée (sidecar / tunnel intact) — ${formatOwnerLoginLog(e2e.email)}`);
  }
}

async function waitBootReady(port: number, timeoutMs = 180000): Promise<void> {
  const started = Date.now();
  let lastLine = "";
  while (Date.now() - started < timeoutMs) {
    const h = await curlHealth(port);
    if (h.ok) {
      if (lastLine) process.stdout.write("\n");
      return;
    }
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/os/boot-status`,
      );
      if (res.status === 200) {
        const model = (await res.json()) as {
          overallPercent?: number;
          steps?: { id: string; status: string; label: string }[];
        };
        const running = (model.steps || []).find(
          (s) => s.status === "running",
        );
        const line = `boot ${Math.round(model.overallPercent || 0)}% — ${running?.label || "…"}`;
        if (line !== lastLine) {
          process.stdout.write(`\r${line.padEnd(70)}`);
          lastLine = line;
        }
      }
    } catch {
      /* container pas encore up */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (lastLine) process.stdout.write("\n");
  throw new Error(`serveur pas prêt après ${Math.round(timeoutMs / 1000)}s`);
}

async function runRegistrySubcommand(
  args: ServerDockerArgs,
  paths: ReturnType<typeof resolvePaths>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const brandId = String(env.BRAND_ID);
  const registry = loadServerRegistry(paths.brandRoot, brandId);
  registry.image = serverImageName(brandId);

  if (args.sub === "ls") {
    if (!registry.instances.length) {
      console.log(
        `aucune instance (registre ${path.join("docker-data", "servers.json")}) — creezio server-docker create <nom>`,
      );
      return;
    }
    console.log(`${"NOM".padEnd(14)}${"CONTAINER".padEnd(34)}${"PORT".padEnd(8)}${"ÉTAT".padEnd(12)}SANTÉ`);
    if (registry.instances.some((i) => i.stack)) {
      console.log("(* port hôte loopback auto — stack compose : app interne :18791, cloudflared in-process)");
    }
    for (const inst of registry.instances) {
      const st = dockerContainerState(inst.containerName);
      const port = inst.stack ? `${inst.port}*` : String(inst.port);
      console.log(
        `${inst.name.padEnd(14)}${inst.containerName.padEnd(34)}${port.padEnd(8)}${st.status.padEnd(12)}${st.health ?? "-"}`,
      );
    }
    return;
  }

  const name = args.rest[0];
  if (!name) {
    throw new Error(`creezio server-docker ${args.sub} <nom> — nom requis`);
  }
  if (!validInstanceName(name)) {
    throw new Error(
      `nom d'instance invalide: ${name} (attendu [a-z0-9][a-z0-9-]*)`,
    );
  }

  if (args.sub === "create") {
    if (registry.instances.some((i) => i.name === name)) {
      throw new Error(
        `instance déjà enregistrée: ${name} (creezio server-docker start ${name})`,
      );
    }
    const containerName = serverContainerName(brandId, name);
    const st = dockerContainerState(containerName);
    if (st.exists) {
      throw new Error(`container ${containerName} existe déjà — docker rm -f ?`);
    }
    const variant = args.browser ? ("browser" as const) : ("base" as const);
    const image = serverImageName(brandId, variant);
    if (args.profile && args.profile !== "prod") {
      throw new Error(`--profile inconnu: ${args.profile} (profils: prod)`);
    }
    // Priorité : --env > env process > .env racine marque (gitignoré).
    // Les vars tunnel sont lues MÊME sans --profile prod : sinon un create
    // VPS « npm run server-docker:create -- demo » réussissait en loopback.
    const brandDotEnv = readEnvFileValues(path.join(paths.brandRoot, ".env"));
    const extraEnv: Record<string, string> = {
      ...pickEnvValues([env, brandDotEnv], CREATE_TUNNEL_ENV_KEYS),
    };
    if (args.profile === "prod") {
      extraEnv.CREEZIO_NATIVE_WARM = "1";
      extraEnv.CREEZIO_CATALOG = "1";
      for (const key of [
        "CREEZIO_FLEET_ENDPOINT",
        "CREEZIO_CRASH_ENDPOINT",
        "CREEZIO_PLUGINS",
        "EMAIL_INBOUND_SECRET",
        "EMAIL_DOMAIN",
        "MAIL_TRANSPORT",
        "MAIL_FROM",
        "SMTP_URL",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_SECURE",
        "SMTP_USER",
        "SMTP_PASS",
        "SMTP_FROM",
        "RESEND_API_KEY",
        "RESEND_WEBHOOK_SECRET",
        "CLOUDFLARE_EMAIL_API_TOKEN",
        "CLOUDFLARE_EMAIL_TOKEN",
        "CREEZIO_SUPERADMIN_EMAIL",
        "CREEZIO_SUPERADMIN_PASSWORD",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "CREEZIO_FLEET_ADMIN_URL",
        "CREEZIO_FLEET_REGISTER_SECRET",
        "CREEZIO_FLEET_HOST_ID",
        "CREEZIO_FLEET_BACKEND_URL",
        "CREEZIO_FLEET_BACKEND_BASIC",
      ]) {
        const v = (env[key] || "").trim() || (brandDotEnv[key] || "").trim();
        if (v) extraEnv[key] = v;
      }
      // App admin de marque : la DB flotte (module fleet-registry) est
      // SERVIE par cette instance — sans CREEZIO_FLEET_ADMIN_URL explicite,
      // elle s'annonce à ELLE-MÊME en loopback in-container (:18791, port
      // app des stacks) pour apparaître au tableau /flotte avec son propre
      // kitVersion (P3.b — écart constaté sur la première flotte : l'admin
      // ne heartbeatait pas vers lui-même).
      if (
        extraEnv.CREEZIO_FLEET_REGISTER_SECRET &&
        !extraEnv.CREEZIO_FLEET_ADMIN_URL &&
        !args.noStack &&
        isAdminBrandRoot(paths.brandRoot, brandId)
      ) {
        extraEnv.CREEZIO_FLEET_ADMIN_URL = "http://127.0.0.1:18791";
        console.log(
          "CREEZIO_FLEET_ADMIN_URL=http://127.0.0.1:18791 (app admin : heartbeat flotte vers elle-même)",
        );
      }
    }
    Object.assign(extraEnv, args.env);
    if (args.warm) extraEnv.CREEZIO_NATIVE_WARM = "1";

    const reservedSlugs = await loadReservedSlugs(paths.kit);
    const cfVars = resolveCliCfEnv(paths.brandRoot);
    const tunnelPolicy: CreateTunnelPolicy = resolveCreateTunnelPolicy({
      instanceName: name,
      brandId,
      profile: args.profile,
      env: { ...extraEnv, ...cfVars },
      reservedSlugs,
      noStack: args.noStack,
    });
    if (tunnelPolicy.mode === "local") {
      extraEnv.CREEZIO_TUNNEL_LOCAL = "1";
      console.log(
        "CREEZIO_TUNNEL_LOCAL=1 — create loopback (dev local, pas de hostname public)",
      );
    } else {
      extraEnv.CREEZIO_TUNNEL_LOCAL = "0";
      extraEnv.CREEZIO_TUNNEL_SLUG = tunnelPolicy.slug;
      Object.assign(extraEnv, applyVpsNativeWarmDefaults(extraEnv));
      console.log(
        `CREEZIO_NATIVE_WARM=${extraEnv.CREEZIO_NATIVE_WARM} CREEZIO_NATIVE_WARM_HERMES=${extraEnv.CREEZIO_NATIVE_WARM_HERMES} (n8n+Hermes requis VPS)`,
      );
      if (tunnelPolicy.derived) {
        console.log(formatDerivedSlugLog(tunnelPolicy));
      }
    }
    // Owner : first-run HTTP hôte + persist secrets.env 600 (env_file).
    // JAMAIS dans compose `environment:` ni le registre (inspect).
    const ownerPolicy: CreateOwnerPolicy = resolveCreateOwnerPolicy({
      local: tunnelPolicy.mode === "local",
      env: pickEnvValues([args.env, env, brandDotEnv], CREATE_OWNER_ENV_KEYS),
    });

    if (!dockerImageExists(image)) {
      console.log(`image ${image} absente — build (variant ${variant})…`);
      dockerBuildImage(paths, env, { variant, image });
    }
    const port =
      args.port && args.port > 0 ? args.port : await allocateServerPort(registry);
    const inst: ServerRegistryInstance = {
      name,
      containerName,
      port,
      bind: args.bind || "127.0.0.1",
      dataDir: path.join("docker-data", "servers", name),
      createdAt: new Date().toISOString(),
      ...(Object.keys(extraEnv).length ? { env: extraEnv } : {}),
      ...(variant === "browser" ? { variant } : {}),
    };
    fs.mkdirSync(instanceDataDirAbs(paths.brandRoot, inst), {
      recursive: true,
    });

    // Stack compose autonome — DÉFAUT : app seule (cloudflared in-process),
    // port interne fixe 18791, port hôte loopback auto (--no-stack = legacy).
    if (!args.noStack) {
      const stack = await importInstanceStack(paths.kit);
      // Contrat Cloudflare → cf.env (chmod 600) : l'instance auto-provisionne
      // son tunnel au boot via l'API CF. Aucun secret dans le registre
      // ni le compose. Fail-closed : mode public exige le contrat complet.
      let cf: Record<string, string> | undefined;
      if (tunnelPolicy.mode === "public") {
        const cfClient = await importTunnelCf(paths.kit);
        const cfEnv = cfEnvFromMerged(cfClient, cfVars);
        if (!cfEnv) {
          throw new Error(
            `contrat Cloudflare incomplet (${cfClient.missingCfTunnelEnvKeys({ ...process.env, ...cfVars } as NodeJS.ProcessEnv).join(", ")} requis) — poser les CREEZIO_CF_* (env hôte ou .env marque)`,
          );
        }
        // Fail-fast : token rejeté (401/403) = erreur immédiate ; souci
        // réseau = avertissement (l'instance réessaiera au boot).
        try {
          const check = await cfClient.verifyCfApiToken(cfEnv);
          console.log(`✓ token Cloudflare vérifié (${check.kind})`);
        } catch (err) {
          const status = Number((err as { status?: number })?.status || 0);
          if (status === 401 || status === 403) {
            throw new Error(
              `token Cloudflare rejeté (HTTP ${status}) — vérifier CREEZIO_CF_API_TOKEN`,
            );
          }
          console.log(
            `⚠ vérification token CF impossible (${err instanceof Error ? err.message : String(err)}) — l'instance réessaiera au boot`,
          );
        }
        const adminTun = applyAdminPublicTunnelDefaults({
          brandId,
          isAdmin: isAdminBrandRoot(paths.brandRoot, brandId),
          env: { ...cfVars, CREEZIO_TUNNEL_SLUG: tunnelPolicy.slug },
        });
        cf = adminTun.env;
        persistAdminTunnelKeys(paths.brandRoot, cf);
        console.log(
          `tunnel auto-provisionné au boot par l'instance (slug ${cf.CREEZIO_TUNNEL_SLUG}, cf.env 600)` +
            (adminTun.applied && adminTun.adminHost
              ? ` — admin ${adminTun.adminHost}` +
                (adminTun.landingHost ? ` + ${adminTun.landingHost}` : "")
              : ""),
        );
      }
      inst.stack = true;
      inst.hostPort =
        args.hostPort && args.hostPort > 0
          ? args.hostPort
          : args.port && args.port > 0
            ? args.port
            : 0;
      inst.port = 0; // renseigné après up (attribution auto)
      if (ownerPolicy.mode === "create") {
        stack.persistOwnerSecrets({
          brandRoot: paths.brandRoot,
          inst,
          owner: {
            email: ownerPolicy.email,
            password: ownerPolicy.password,
          },
        });
      }
      stack.writeInstanceStack({
        brandRoot: paths.brandRoot,
        brandId,
        image,
        inst,
        cf,
      });
      stack.stackUp(paths.brandRoot, inst);
      const hp = stack.stackHostPort(containerName);
      if (!hp) {
        throw new Error(`port hôte du stack introuvable après up (${containerName})`);
      }
      stack.applyAllocatedHostPort(inst, hp);
      registry.instances.push(inst);
      saveServerRegistry(paths.brandRoot, registry);
      console.log(
        `+ instance ${name} (stack compose) → http://127.0.0.1:${hp}/ ` +
          `(container ${containerName}, port hôte persisté ${hp}, app interne :${stack.STACK_APP_PORT})`,
      );
      console.log(
        `  boot-status : curl http://127.0.0.1:${hp}/api/v1/os/boot-status`,
      );
      await waitBootReady(hp);
      await applyCreateOwner(hp, ownerPolicy);
      if (cf?.CREEZIO_TUNNEL_SLUG) {
        const publicHost =
          (cf.CREEZIO_DOMAIN || "").trim() ||
          `${cf.CREEZIO_TUNNEL_SLUG}.${(cf.CREEZIO_CF_ZONE_NAME || "crm.foove.io").trim()}`;
        console.log(
          `✓ serveur ${name} prêt — CRM public: https://${publicHost}/ (debug loopback http://127.0.0.1:${hp}/)`,
        );
      } else {
        console.log(`✓ serveur ${name} prêt — CRM: http://127.0.0.1:${hp}/`);
      }
      return;
    }

    run(
      "docker",
      buildDockerRunArgs({
        brandRoot: paths.brandRoot,
        brandId,
        image,
        inst,
      }),
      env,
    );
    registry.instances.push(inst);
    saveServerRegistry(paths.brandRoot, registry);
    console.log(
      `+ instance ${name} → http://${inst.bind === "0.0.0.0" ? "127.0.0.1" : inst.bind}:${port}/ (container ${containerName})`,
    );
    console.log(
      `  boot-status : curl http://127.0.0.1:${port}/api/v1/os/boot-status`,
    );
    await waitBootReady(port);
    await applyCreateOwner(port, ownerPolicy);
    console.log(`✓ serveur ${name} prêt — CRM: http://127.0.0.1:${port}/`);
    return;
  }

  const inst = registry.instances.find((i) => i.name === name);
  if (!inst) {
    throw new Error(
      `instance inconnue: ${name} — creezio server-docker ls (registre ${path.join("docker-data", "servers.json")})`,
    );
  }

  if (args.sub === "ensure-owner") {
    await runEnsureOwner({
      paths,
      env,
      brandId,
      inst,
      args,
    });
    return;
  }

  if (args.sub === "access") {
    // Permissions par module (access-control) — bootstrap sans UI, cohérent
    // ensure-owner : écriture directe core.db via docker exec (+ audit).
    if (!args.user) {
      throw new Error(
        [
          `access ${inst.name} : --user <email> requis.`,
          "Ex. : creezio server-docker access main --brand-root <admin> \\",
          "        --user compta@marque.fr --reset --grant nav.billing,nav.clients",
        ].join("\n"),
      );
    }
    const grant = (args.grant || "").split(",").map((s) => s.trim()).filter(Boolean);
    const revoke = (args.revoke || "").split(",").map((s) => s.trim()).filter(Boolean);
    const result = applyAccessOverridesViaContainer({
      containerName: inst.containerName,
      email: args.user,
      grant,
      revoke,
      reset: args.reset,
      role: args.role,
    });
    console.log(`✓ access ${inst.name} — ${result.email} (${result.userId})`);
    console.log(`  rôle access-control : ${result.role || "(rôle plateforme)"}`);
    if (result.overrides.length) {
      for (const o of result.overrides) {
        console.log(`  ${o.effect === "allow" ? "+" : "−"} ${o.permission} (${o.effect})`);
      }
    } else {
      console.log("  aucun override par compte (permissions = défauts du rôle)");
    }
    console.log("  effet ≤ 30 s (cache resolvePermissions) — audit access_audit_log (actor server-docker-cli)");
    return;
  }

  if (args.sub === "migrate-stack") {
    // Migration vers le modèle in-process (0.10.0) :
    //  - stack sidecar (cloudflared compose) → stack app seule + cf.env ;
    //  - legacy `docker run` → stack compose.
    // Backup /data obligatoire → cf.env écrit (CREEZIO_CF_* + slug + hostname
    // exact préservé via CREEZIO_DOMAIN) → compose up : le kernel re-ensure
    // le tunnel au boot (ingress http://127.0.0.1:18791 + DNS) et spawn
    // cloudflared in-process → health → rollback si KO.
    // Le token tunnel reste dans le store kernel /data — jamais affiché.
    const stack = await importInstanceStack(paths.kit);
    const composeFile = stack.composeFilePath(paths.brandRoot, inst);
    const hasSidecar =
      Boolean(inst.stack) &&
      fs.existsSync(composeFile) &&
      fs.readFileSync(composeFile, "utf8").includes("cloudflared:");
    const cfVarsEarly = resolveCliCfEnv(paths.brandRoot);
    const cfFileEarly = readEnvFileValues(stack.cfEnvPath(paths.brandRoot, inst));
    const cfClientEarly = await importTunnelCf(paths.kit);
    const hasCfContract = Boolean(
      cfEnvFromMerged(cfClientEarly, cfVarsEarly),
    );
    const adminTunEarly = applyAdminPublicTunnelDefaults({
      brandId,
      isAdmin: isAdminBrandRoot(paths.brandRoot, brandId),
      env: { ...cfFileEarly, ...cfVarsEarly },
    });
    const needsHostnameSync =
      extraHostnamesKey(adminTunEarly.env.CREEZIO_TUNNEL_EXTRA_HOSTNAMES) !==
        extraHostnamesKey(cfFileEarly.CREEZIO_TUNNEL_EXTRA_HOSTNAMES) ||
      (adminTunEarly.env.CREEZIO_DOMAIN || "").trim() !==
        (cfFileEarly.CREEZIO_DOMAIN || "").trim();
    const migratePlan = resolveMigrateStackPlan({
      isStack: Boolean(inst.stack),
      hasSidecar,
      hasCfEnv: fs.existsSync(stack.cfEnvPath(paths.brandRoot, inst)),
      hasCfContract,
      needsHostnameSync: Boolean(hasCfContract && needsHostnameSync),
    });
    if (migratePlan === "noop-inprocess") {
      console.log(
        hasCfContract
          ? `✓ ${name} déjà en stack in-process — rien à faire`
          : `✓ ${name} déjà en stack in-process sans tunnel (poser CREEZIO_CF_* + CREEZIO_DOMAIN pour attacher)`,
      );
      return;
    }
    const image =
      (inst as { image?: string }).image || registry.image ||
      serverImageName(brandId);
    const migrateKind =
      migratePlan === "attach-cf"
        ? "attach-cf"
        : migratePlan === "sync-cf"
          ? "sync-cf"
          : hasSidecar
            ? "sidecar → in-container"
            : "legacy → stack";
    console.log(
      `migration ${name} → stack in-process (${migrateKind}, image ${image})…`,
    );

    const serverLibPath = path.join(
      paths.kit,
      "packages/fleet/dist/server-lib.js",
    );
    const { backupInstanceData } = (await import(
      pathToFileURL(serverLibPath).href
    )) as {
      backupInstanceData: (
        brandRoot: string,
        inst: ServerRegistryInstance,
      ) => Promise<{ ok: boolean; file: string | null; detail: string }>;
    };
    if (!brandServerDockerBackupEnabled(paths.brandRoot)) {
      warnBackupSkipped();
    } else {
      console.log("backup /data avant bascule…");
      const b = await backupInstanceData(paths.brandRoot, inst);
      if (!b.ok) {
        throw new Error(`backup KO: ${b.detail} — migration annulée (rien touché)`);
      }
      console.log(`✓ backup ${b.detail}`);
    }

    const kc = stack.readKernelTunnelConfig(paths.brandRoot, inst, brandId);
    let cf: Record<string, string> | undefined;
    const cfVars = cfVarsEarly;
    const cfClient = cfClientEarly;
    if (kc) {
      const cfEnv = cfEnvFromMerged(cfClient, cfVars);
      if (!cfEnv) {
        throw new Error(
          `tunnel ${kc.slug} présent mais contrat Cloudflare incomplet (${cfClient.missingCfTunnelEnvKeys({ ...process.env, ...cfVars } as NodeJS.ProcessEnv).join(", ")}) — poser les CREEZIO_CF_* (env hôte ou .env marque) puis relancer`,
        );
      }
      cf = {
        ...adminTunEarly.env,
        CREEZIO_TUNNEL_SLUG: kc.slug,
      };
      if (!cf.CREEZIO_DOMAIN) cf.CREEZIO_DOMAIN = kc.hostname;
      persistAdminTunnelKeys(paths.brandRoot, cf);
      console.log(
        `✓ contrat CF prêt — l'instance re-ensure le tunnel ${kc.slug} au boot (ingress 127.0.0.1:${stack.STACK_APP_PORT})` +
          (cf.CREEZIO_TUNNEL_EXTRA_HOSTNAMES
            ? ` + extras ${cf.CREEZIO_TUNNEL_EXTRA_HOSTNAMES}`
            : ""),
      );
    } else if (hasCfContract) {
      const reservedSlugs = await loadReservedSlugs(paths.kit);
      const tunnelPolicy = resolveCreateTunnelPolicy({
        instanceName: name,
        brandId,
        profile: "prod",
        env: { ...cfVars, CREEZIO_TUNNEL_LOCAL: "0" },
        reservedSlugs,
        noStack: false,
      });
      if (tunnelPolicy.mode !== "public") {
        throw new Error("attach-cf : politique tunnel inattendue (attendu public)");
      }
      const attached: Record<string, string> = {
        ...adminTunEarly.env,
        CREEZIO_TUNNEL_SLUG: tunnelPolicy.slug,
      };
      cf = attached;
      persistAdminTunnelKeys(paths.brandRoot, cf);
      if (tunnelPolicy.derived) console.log(formatDerivedSlugLog(tunnelPolicy));
      console.log(
        `✓ contrat CF prêt — attach tunnel ${tunnelPolicy.slug}` +
          (attached.CREEZIO_DOMAIN
            ? ` (CREEZIO_DOMAIN=${attached.CREEZIO_DOMAIN})`
            : "") +
          (attached.CREEZIO_TUNNEL_EXTRA_HOSTNAMES
            ? ` extras=${attached.CREEZIO_TUNNEL_EXTRA_HOSTNAMES}`
            : "") +
          ` au boot (ingress 127.0.0.1:${stack.STACK_APP_PORT})`,
      );
    } else {
      console.log("pas de tunnel kernel dans /data — stack sans cf.env");
    }

    const instStack: ServerRegistryInstance = {
      ...inst,
      stack: true,
      hostPort:
        args.hostPort && args.hostPort > 0
          ? args.hostPort
          : stack.recordedHostPort(inst) || 0,
      env: Object.fromEntries(
        Object.entries({ ...(inst.env || {}), CREEZIO_TUNNEL_LOCAL: "0" }).filter(
          ([k]) =>
            !/^CREEZIO_TUNNEL_(PROVISION_URL|PROVISION_TOKEN|FLAT_HOSTS|SIDECAR|SERVICE_HOST|TOKEN|HOSTNAME|ID)$/.test(
              k,
            ),
        ),
      ),
    };

    // Backup du stack dir existant (rollback sidecar : compose + tunnel.env).
    const stackDirPath = stack.stackDir(paths.brandRoot, inst);
    const stackBackup = `${stackDirPath}.bak-migrate`;
    if (inst.stack && fs.existsSync(stackDirPath)) {
      fs.rmSync(stackBackup, { recursive: true, force: true });
      fs.cpSync(stackDirPath, stackBackup, { recursive: true });
    }

    stack.writeInstanceStack({
      brandRoot: paths.brandRoot,
      brandId,
      image,
      inst: instStack,
      cf,
      allowDropSidecar: true,
    });
    // L'ancien tunnel.env (secret sidecar) n'a plus lieu d'être.
    fs.rmSync(path.join(stackDirPath, "tunnel.env"), { force: true });

    console.log("bascule : arrêt ancien conteneur/stack → compose up…");
    if (inst.stack) {
      try {
        stack.stackDown(paths.brandRoot, inst, { quiet: true });
      } catch {
        /* stack déjà down */
      }
    } else {
      run("docker", ["rm", "-f", inst.containerName], env);
    }
    let hp = 0;
    try {
      stack.stackUp(paths.brandRoot, instStack, { quiet: true });
      hp = stack.stackHostPort(inst.containerName);
    } catch {
      hp = 0;
    }
    const ready = hp > 0 && (await waitBootReady(hp).then(() => true, () => false));
    if (!ready) {
      console.error("✗ stack KO — rollback…");
      try {
        stack.stackDown(paths.brandRoot, instStack, { quiet: true });
      } catch {
        /* best-effort */
      }
      if (inst.stack && fs.existsSync(stackBackup)) {
        // Rollback sidecar : restaurer compose.yml + tunnel.env, repointer
        // l'ingress vers http://app:18791 (le boot a pu le basculer sur
        // 127.0.0.1), puis relancer l'ancien stack.
        fs.rmSync(stackDirPath, { recursive: true, force: true });
        fs.cpSync(stackBackup, stackDirPath, { recursive: true });
        if (kc?.tunnelId && cf) {
          try {
            const cfClient = await importTunnelCf(paths.kit);
            const cfEnv = cfEnvFromMerged(cfClient, cf);
            if (cfEnv) {
              await cfClient.putCfTunnelIngress(
                cfEnv,
                kc.tunnelId,
                cfClient.buildTunnelIngressRules(
                  kc.hostname,
                  { crmPort: stack.STACK_APP_PORT },
                  { originHost: "app" },
                ),
              );
            }
          } catch {
            /* best-effort */
          }
        }
        try {
          stack.stackUp(paths.brandRoot, inst, { quiet: true });
        } catch {
          /* best-effort */
        }
        throw new Error(
          `migration ${name} KO — rollback stack sidecar restauré (vérifier https://${kc?.hostname || "?"})`,
        );
      }
      run(
        "docker",
        buildDockerRunArgs({ brandRoot: paths.brandRoot, brandId, image, inst }),
        env,
      );
      const back = await waitBootReady(inst.port).then(() => true, () => false);
      throw new Error(
        `migration ${name} KO — rollback legacy ${back ? "OK (service restauré)" : "ÉCHOUÉ (intervention manuelle: docker start " + inst.containerName + ")"}`,
      );
    }
    fs.rmSync(stackBackup, { recursive: true, force: true });
    stack.applyAllocatedHostPort(instStack, hp);
    registry.instances = registry.instances.map((i) =>
      i.name === name ? instStack : i,
    );
    saveServerRegistry(paths.brandRoot, registry);
    console.log(
      `✓ ${name} migré en stack in-process — app interne :${stack.STACK_APP_PORT}, ` +
        `port hôte debug 127.0.0.1:${hp} (persisté, réutilisé à l'update)`,
    );
    const publicHost = kc?.hostname || cf?.CREEZIO_DOMAIN;
    if (publicHost) {
      try {
        const res = await fetch(
          `https://${publicHost}/api/v1/core/health`,
          { signal: AbortSignal.timeout(20000) },
        );
        console.log(`✓ public https://${publicHost} → HTTP ${res.status}`);
      } catch (e) {
        console.log(
          `⚠ vérif publique https://${publicHost} en échec: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return;
  }

  if (args.sub === "start") {
    if (inst.stack) {
      const stack = await importInstanceStack(paths.kit);
      stack.stackStart(paths.brandRoot, inst);
      const hp = stack.stackHostPort(inst.containerName) || inst.port;
      if (hp && (hp !== inst.port || hp !== inst.hostPort)) {
        stack.applyAllocatedHostPort(inst, hp);
        saveServerRegistry(paths.brandRoot, registry);
      }
      await waitBootReady(hp);
      console.log(`✓ ${name} démarré (stack) — http://127.0.0.1:${hp}/`);
      return;
    }
    run("docker", ["start", inst.containerName], env);
    await waitBootReady(inst.port);
    console.log(`✓ ${name} démarré — http://127.0.0.1:${inst.port}/`);
    return;
  }

  if (args.sub === "stop") {
    if (inst.stack) {
      const stack = await importInstanceStack(paths.kit);
      stack.stackStop(paths.brandRoot, inst);
      console.log(`✓ ${name} arrêté (stack app + tunnel)`);
      return;
    }
    run("docker", ["stop", inst.containerName], env);
    console.log(`✓ ${name} arrêté`);
    return;
  }

  if (args.sub === "logs") {
    const tail = args.tail && args.tail > 0 ? args.tail : 200;
    if (inst.stack) {
      const stack = await importInstanceStack(paths.kit);
      stack.stackLogs(paths.brandRoot, inst, { tail, follow: !!args.follow });
      return;
    }
    const logArgs = ["logs", "--tail", String(tail)];
    if (args.follow) logArgs.push("-f");
    logArgs.push(inst.containerName);
    run("docker", logArgs, env);
    return;
  }

  if (args.sub === "rm") {
    if (inst.stack) {
      const stack = await importInstanceStack(paths.kit);
      // Déprovisionnement Cloudflare (DNS + tunnel) AVANT la suppression du
      // stack dir — cf.env contient CREEZIO_DOMAIN / EXTRA_HOSTNAMES et le
      // store kernel /data le tunnelId. Best-effort : un échec CF n'empêche
      // pas la suppression locale (résidu signalé).
      try {
        await deprovisionInstanceTunnelCf(paths.kit, paths.brandRoot, inst, brandId);
      } catch (err) {
        console.log(
          `⚠ déprovisionnement Cloudflare en échec: ${err instanceof Error ? err.message : String(err)} — résidus possibles (DNS/tunnel) à nettoyer à la main`,
        );
      }
      try {
        stack.stackDown(paths.brandRoot, inst, { quiet: true });
      } catch {
        /* stack déjà down */
      }
      fs.rmSync(
        path.join(paths.brandRoot, "docker-data", "stacks", inst.name),
        { recursive: true, force: true },
      );
    }
    const st = dockerContainerState(inst.containerName);
    if (st.exists) {
      run("docker", ["rm", "-f", inst.containerName], env);
    }
    registry.instances = registry.instances.filter((i) => i.name !== name);
    saveServerRegistry(paths.brandRoot, registry);
    if (args.purgeData) {
      fs.rmSync(instanceDataDirAbs(paths.brandRoot, inst), {
        recursive: true,
        force: true,
      });
      console.log(`✓ ${name} supprimé (container + données)`);
    } else {
      console.log(
        `✓ ${name} supprimé (données conservées: ${inst.dataDir} — --purge-data pour tout effacer)`,
      );
    }
    return;
  }

  if (args.sub === "backup") {
    const serverLibPath = path.join(
      paths.kit,
      "packages/fleet/dist/server-lib.js",
    );
    if (!fs.existsSync(serverLibPath)) {
      throw new Error(
        `server-lib introuvable: ${serverLibPath} — lancer \`npm run build:packages\` dans le kit`,
      );
    }
    const { backupInstanceData } = (await import(
      pathToFileURL(serverLibPath).href
    )) as {
      backupInstanceData: (
        brandRoot: string,
        inst: ServerRegistryInstance,
      ) => Promise<{ ok: boolean; file: string | null; detail: string }>;
    };
    if (!brandServerDockerBackupEnabled(paths.brandRoot)) {
      warnBackupSkipped();
      return;
    }
    console.log(`backup one-shot ${name} (/data → docker-data/backups/)…`);
    const b = await backupInstanceData(paths.brandRoot, inst);
    if (!b.ok) {
      throw new Error(`backup KO: ${b.detail}`);
    }
    console.log(`✓ backup ${b.detail}`);
    console.log(
      `  conservé pour restore manuel — les updates suivants ne le remplacent pas (défaut sans --backup)`,
    );
    return;
  }

  if (args.sub === "update") {
    const variant = inst.variant === "browser" ? ("browser" as const) : ("base" as const);
    let image = (args.image || "").trim();
    if (!image) {
      const tag = (args.tag || "").trim();
      if (!tag || !TAG_RE.test(tag)) {
        throw new Error(
          "creezio server-docker update <nom> --image <ref> | --tag <version> [--backup]",
        );
      }
      const regHost = resolveRegistry(args) || "127.0.0.1:5000";
      image = publishImageName(regHost, brandId, tag, variant);
    }
    const serverLibPath = path.join(
      paths.kit,
      "packages/fleet/dist/server-lib.js",
    );
    if (!fs.existsSync(serverLibPath)) {
      throw new Error(
        `server-lib introuvable: ${serverLibPath} — lancer \`npm run build:packages\` dans le kit`,
      );
    }
    const { updateServer } = (await import(
      pathToFileURL(serverLibPath).href
    )) as {
      updateServer: (opts: {
        brandRoot: string;
        registry: typeof registry;
        inst: ServerRegistryInstance;
        image: string;
        backup?: boolean;
        audit?: (s: string) => void;
      }) => Promise<{
        ok: boolean;
        error?: string;
        image?: string;
        previousImage?: string;
        version?: string | null;
        rolledBack?: boolean;
        backup?: string | null;
        steps?: string[];
      }>;
    };
    if ((inst.env?.CREEZIO_TUNNEL_LOCAL || "") !== "1") {
      inst.env = applyVpsNativeWarmDefaults(inst.env || {});
      saveServerRegistry(paths.brandRoot, registry);
      console.log(
        `VPS warm : CREEZIO_NATIVE_WARM=${inst.env.CREEZIO_NATIVE_WARM} HERMES=${inst.env.CREEZIO_NATIVE_WARM_HERMES} (n8n+Hermes requis)`,
      );
    }
    const backupEnabled = brandServerDockerBackupEnabled(paths.brandRoot);
    if (args.backup && !backupEnabled) warnBackupSkipped();
    const wantBackup = backupEnabled && !!args.backup;
    console.log(
      `update ${name} → ${image}${wantBackup ? " (--backup)" : " (sans nouveau backup)"}…`,
    );
    const result = await updateServer({
      brandRoot: paths.brandRoot,
      registry,
      inst,
      image,
      backup: wantBackup,
      audit: (s) => console.log(`  ${s}`),
    });
    if (!result.ok) {
      throw new Error(
        `update KO: ${result.error || "?"}${
          result.rolledBack ? ` (rollback → ${result.previousImage})` : ""
        }`,
      );
    }
    console.log(
      `✓ ${name} → ${result.image || image} (version ${result.version || "?"}${
        result.backup ? `, backup ${result.backup}` : ", sans nouveau backup"
      })`,
    );
    return;
  }
}

export async function runServerDockerCli(argv: string[]): Promise<void> {
  const args = parseServerDockerArgs(argv);
  if (args.help || !args.sub || args.sub === "help") {
    printServerDockerHelp();
    if (!args.sub || args.sub === "help") return;
    return;
  }

  if (args.sub === "registry-gc") {
    const resolved =
      (args.registry || "").trim() ||
      (process.env.CREEZIO_REGISTRY || "").trim() ||
      REGISTRY_GC_DEFAULT_HOST;
    if (isGhcrRegistry(resolved)) {
      await runGhcrGcCommand(args);
    } else {
      await runRegistryGcCommand(args);
    }
    return;
  }

  ensureDocker();

  if (args.sub === "ps") {
    const project = args.project || "creezio-servers";
    run("docker", ["compose", "-p", project, "ps"], process.env);
    return;
  }

  // Repo admin dédié : --admin-root suffit (pas de brand root obligatoire).
  if (args.sub === "admin" && args.adminRoot && !args.brandRoot) {
    args.brandRoot = args.adminRoot;
  }

  const paths = resolvePaths(args);
  const env = composeEnv(paths);
  ensureBrandDockerignore(paths.brandRoot, paths.kit);

  const registrySubs = new Set([
    "create",
    "start",
    "stop",
    "rm",
    "logs",
    "ls",
    "update",
    "backup",
    "migrate-stack",
    "ensure-owner",
    "access",
  ]);
  if (registrySubs.has(args.sub)) {
    await runRegistrySubcommand(args, paths, env);
    return;
  }

  if (args.sub === "admin") {
    await runServerAdminSubcommand(args, paths, env);
    return;
  }

  if (args.sub === "publish") {
    await runPublishSubcommand(args, paths, env);
    return;
  }

  if (args.sub === "agent") {
    await runAgentSubcommand(args, paths, env);
    return;
  }

  if (args.sub === "enroll") {
    await runEnrollSubcommand(args, paths);
    return;
  }

  if (args.sub === "build") {
    dockerBuildImage(paths, env);
    return;
  }

  if (args.sub === "down") {
    run(
      "docker",
      [
        "compose",
        "-p",
        paths.project,
        "-f",
        paths.composeFile,
        "down",
        ...args.rest,
      ],
      env,
    );
    return;
  }

  if (args.sub === "up" || args.sub === "proof") {
    // Builds 100% in-image (stage brand-build) — rien à builder sur l'hôte.
    const upArgs = [
      "compose",
      "-p",
      paths.project,
      "-f",
      paths.composeFile,
      "up",
      "-d",
      "--remove-orphans",
    ];
    if (!args.noBuild) upArgs.push("--build");
    upArgs.push(...args.rest);
    run("docker", upArgs, env);

    const shortcuts = writeServerDesktopShortcuts({
      brandRoot: paths.brandRoot,
      kitRoot: paths.kit,
    });

    if (args.sub === "proof") {
      const instances = DEFAULT_SERVER_INSTANCES;
      const expected = env.BRAND_ID;
      const ports = instances.map((i) => resolveInstancePort(i));
      let results = await Promise.all(ports.map((p) => curlHealth(p)));
      for (let i = 0; i < 30 && !results.every((r) => r.ok); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        results = await Promise.all(ports.map((p) => curlHealth(p)));
      }
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i]!;
        const h = results[i]!;
        console.log(
          `health ${inst.id} :${ports[i]} → ${h.status} brandId=${h.brandId}`,
        );
      }
      if (!results.every((r) => r.ok)) {
        throw new Error(
          "preuve health échouée (attendu HTTP 200 sur server-1 et server-2)",
        );
      }
      if (results.some((r) => r.brandId !== expected)) {
        throw new Error(
          `brandId incohérent: ${results.map((r) => r.brandId).join(", ")} expected=${expected}`,
        );
      }
      if (!shortcuts.files.length) {
        throw new Error(
          "preuve raccourcis échouée — aucun .desktop écrit (créer ~/Desktop ou ~/Bureau)",
        );
      }
      for (const f of shortcuts.files) {
        if (!fs.existsSync(f)) {
          throw new Error(`raccourci manquant: ${f}`);
        }
        const body = fs.readFileSync(f, "utf8");
        if (/^Exec=.*xdg-open/m.test(body)) {
          throw new Error(`raccourci utilise encore xdg-open direct: ${f}`);
        }
        if (!/^Exec=.*open-creezio-server-\d+/m.test(body)) {
          throw new Error(`raccourci sans Exec open-creezio-server-N: ${f}`);
        }
      }
      for (const w of shortcuts.wrappers) {
        if (!fs.existsSync(w)) {
          throw new Error(`wrapper manquant: ${w}`);
        }
      }
      // Smoke réel : lancer le wrapper server-1 (DISPLAY xrdp si besoin).
      const smokeEnv: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: os.homedir(),
        XAUTHORITY:
          process.env.XAUTHORITY || path.join(os.homedir(), ".Xauthority"),
      };
      if (!smokeEnv.DISPLAY) {
        const x10 = "/tmp/.X11-unix/X10";
        smokeEnv.DISPLAY = fs.existsSync(x10) ? ":10" : ":0";
      }
      const wrapper1 = shortcuts.wrappers[0]!;
      const smoke = spawnSync(wrapper1, [], {
        encoding: "utf8",
        env: smokeEnv,
        timeout: 15000,
      });
      if (smoke.status !== 0) {
        throw new Error(
          `preuve wrapper échouée (${wrapper1}): status=${smoke.status} stderr=${smoke.stderr || smoke.stdout || "?"}`,
        );
      }
      console.log(
        `✓ wrapper ${path.basename(wrapper1)} → ${(smoke.stdout || "").trim() || "ok"}`,
      );
      console.log(
        `✓ preuve server-docker : ${instances.length} instances OK + ${shortcuts.files.length} raccourcis (${shortcuts.product})`,
      );
    }
    return;
  }

  throw new Error(
    `Sous-commande inconnue: ${args.sub} (create|start|stop|rm|logs|ls|update|backup|ensure-owner|access|admin|publish|registry-gc|agent|enroll|build|up|down|ps|proof)`,
  );
}
