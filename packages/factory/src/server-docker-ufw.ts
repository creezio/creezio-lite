/**
 * Préflight UFW des ports hôte consommés depuis les conteneurs Docker
 * (18800 backend flotte, 18810 host-agent).
 *
 * Incident 10–30/08/2026 (migration stacks compose) : la règle UFW du port
 * 18810 était restée scoped `172.17.0.0/16` (docker0) alors que les stacks
 * compose créent des réseaux dédiés (172.25.x) → le cloudflared in-process
 * du conteneur porteur de l'ingress `agent.{slug}` était droppé par UFW
 * (`[UFW BLOCK] … DPT=18810`), host-agent injoignable 20 jours en silence.
 *
 * Règle structurelle : tout port hôte consommé depuis les conteneurs doit
 * être autorisé depuis `172.16.0.0/12` (TOUS les réseaux Docker) vers la
 * gateway `172.17.0.1`. Ce préflight la détecte et la pose automatiquement
 * (droits root/sudo -n) — sinon échec explicite avec la commande exacte,
 * jamais silencieux. Appelé par `agent up`, `admin up` et `enroll`.
 */

import { execFileSync } from "node:child_process";

export const UFW_DOCKER_SOURCE = "172.16.0.0/12";
export const UFW_DOCKER_GATEWAY = "172.17.0.1";

/** Commande exacte (sans sudo) qui pose la règle attendue. */
export function ufwAllowCommand(port: number): string {
  return `ufw allow proto tcp from ${UFW_DOCKER_SOURCE} to ${UFW_DOCKER_GATEWAY} port ${port}`;
}

/** true si la sortie `ufw status` est un firewall actif. */
export function ufwStatusIsActive(statusOutput: string): boolean {
  return /^Status:\s*active/m.test(statusOutput);
}

/**
 * true si la sortie `ufw status` contient la règle attendue :
 * `172.17.0.1 <port>/tcp   ALLOW   172.16.0.0/12`.
 */
export function ufwStatusHasFleetRule(
  statusOutput: string,
  port: number,
): boolean {
  for (const raw of statusOutput.split("\n")) {
    const line = raw.trim();
    if (!/\bALLOW\b/.test(line)) continue;
    if (!line.includes(UFW_DOCKER_SOURCE)) continue;
    if (new RegExp(`(^|\\s)${UFW_DOCKER_GATEWAY}\\s+${port}/tcp(\\s|$)`).test(line)) {
      return true;
    }
  }
  return false;
}

export type UfwExecResult = {
  ok: boolean;
  stdout: string;
  /** "ENOENT" (binaire absent), "EACCES"/autre message sinon. */
  error?: string;
};

/** Exécuteur injectable (tests) — LANG=C pour une sortie ufw stable. */
export type UfwExec = (argv: string[]) => UfwExecResult;

function defaultExec(argv: string[]): UfwExecResult {
  try {
    const stdout = execFileSync(argv[0]!, argv.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
      timeout: 15_000,
    });
    return { ok: true, stdout };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    return {
      ok: false,
      stdout: String(e.stdout || ""),
      error: e.code || e.message || "exec_failed",
    };
  }
}

export type UfwPreflightResult =
  /** Pas de binaire ufw sur l'hôte — rien à vérifier. */
  | { status: "no-ufw" }
  /** UFW installé mais inactif — aucune règle requise. */
  | { status: "inactive" }
  /** UFW actif, règle déjà présente. */
  | { status: "present" }
  /** UFW actif, règle absente — posée par ce préflight (et re-vérifiée). */
  | { status: "added" }
  /** Impossible de lire l'état (ni direct ni sudo -n) — à vérifier à la main. */
  | { status: "unknown"; detail: string }
  /** UFW actif, règle absente, pose impossible — geste manuel requis. */
  | { status: "missing"; detail: string };

const UFW_CANDIDATES = ["ufw", "/usr/sbin/ufw"];

/**
 * Vérifie (et pose si possible) la règle UFW du port flotte donné.
 * Ne lève jamais — le caller décide (fail-closed sur "missing").
 */
export function ufwFleetRulePreflight(opts: {
  port: number;
  exec?: UfwExec;
}): UfwPreflightResult {
  const exec = opts.exec || defaultExec;
  const port = opts.port;

  // 1. Lire `ufw status` : direct (root), puis sudo -n (non interactif).
  let status: UfwExecResult | null = null;
  let prefix: string[] | null = null;
  let sawPermissionIssue = false;
  let allEnoent = true;
  for (const bin of UFW_CANDIDATES) {
    for (const pre of [[] as string[], ["sudo", "-n"]]) {
      const r = exec([...pre, bin, "status"]);
      if (pre.length === 0 && r.error === "ENOENT") break; // binaire absent
      allEnoent = false;
      if (r.ok) {
        status = r;
        prefix = [...pre, bin];
        break;
      }
      sawPermissionIssue = true;
    }
    if (status) break;
  }
  if (!status) {
    if (allEnoent) return { status: "no-ufw" };
    return {
      status: "unknown",
      detail: sawPermissionIssue
        ? "lecture `ufw status` refusée (ni root ni sudo -n)"
        : "`ufw status` en échec",
    };
  }

  if (!ufwStatusIsActive(status.stdout)) return { status: "inactive" };
  if (ufwStatusHasFleetRule(status.stdout, port)) return { status: "present" };

  // 2. Règle absente sur un UFW actif → tenter de la poser (mêmes droits
  // que la lecture du status), puis RE-VÉRIFIER (jamais de succès déclaré
  // sans preuve).
  const allow = exec([
    ...prefix!,
    "allow",
    "proto",
    "tcp",
    "from",
    UFW_DOCKER_SOURCE,
    "to",
    UFW_DOCKER_GATEWAY,
    "port",
    String(port),
  ]);
  if (allow.ok) {
    const recheck = exec([...prefix!, "status"]);
    if (recheck.ok && ufwStatusHasFleetRule(recheck.stdout, port)) {
      return { status: "added" };
    }
  }
  return {
    status: "missing",
    detail: allow.error || "pose de la règle refusée",
  };
}

/**
 * Préflight fail-closed pour un geste CLI : log l'état, pose la règle si
 * possible, LÈVE si UFW actif + règle absente + pose impossible (message
 * actionnable avec la commande exacte — jamais silencieux).
 */
export function assertUfwFleetRule(opts: {
  port: number;
  label: string;
  exec?: UfwExec;
  log?: (line: string) => void;
}): UfwPreflightResult {
  const log = opts.log || ((l: string) => console.log(l));
  const r = ufwFleetRulePreflight({ port: opts.port, exec: opts.exec });
  const cmd = `sudo ${ufwAllowCommand(opts.port)}`;
  switch (r.status) {
    case "no-ufw":
      break; // pas de firewall UFW — rien à poser
    case "inactive":
      log(`  UFW inactif — pas de règle requise (${opts.label} :${opts.port})`);
      break;
    case "present":
      log(
        `✓ UFW : règle conteneurs (${UFW_DOCKER_SOURCE}) → :${opts.port} (${opts.label}) présente`,
      );
      break;
    case "added":
      log(`+ UFW : règle posée — ${ufwAllowCommand(opts.port)} (${opts.label})`);
      break;
    case "unknown":
      log(
        `⚠ UFW : état indéterminé (${r.detail}) — vérifier \`sudo ufw status | grep ${opts.port}\` ; règle attendue : ${cmd}`,
      );
      break;
    case "missing":
      throw new Error(
        `UFW actif mais la règle ${opts.label} manque : le port ${opts.port} est droppé depuis les réseaux Docker ${UFW_DOCKER_SOURCE} ` +
          `(symptôme : [UFW BLOCK] … DPT=${opts.port}, agent/admin injoignable via tunnel — incident 10–30/08/2026). ` +
          `Pose automatique impossible (${r.detail}). Poser à la main puis relancer :\n  ${cmd}`,
      );
  }
  return r;
}
