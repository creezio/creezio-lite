/**
 * Spawn npm ancré sur un projet (repo marque), sans hériter du
 * prefix / workspace du process parent (kit).
 *
 * Vécu : `creezio upgrade` lancé via `npm run` depuis `/opt/docker/creezio`
 * héritait `npm_config_local_prefix` → `npm install` dans la marque a
 * vidé `node_modules/@creezio` du kit (liens workspace).
 *
 * Règle : cwd = projet, `--prefix` = projet, env npm prefix/workspace
 * stripé — jamais de walk-up vers le kit.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";

const STRIP_ENV_RE =
  /^(npm_config_(prefix|local_prefix|global_prefix|workspace|workspaces|workspace_root|workspace-root)|npm_lifecycle_|npm_package_|npm_execpath|npm_command|INIT_CWD)$/i;

/**
 * Env npm pour un projet isolé : retire prefix/workspace hérités du
 * parent (kit) et pose `INIT_CWD` sur le projet.
 */
export function npmEnvForProject(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const cwd = path.resolve(projectRoot);
  const isolated: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (STRIP_ENV_RE.test(key)) continue;
    isolated[key] = value;
  }
  isolated.INIT_CWD = cwd;
  return isolated;
}

export type SpawnNpmAtOpts = {
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe" | "ignore";
  encoding?: BufferEncoding;
};

/** `npm --prefix <projet> …` avec env isolé — cwd = projet. */
export function spawnNpmAt(
  projectRoot: string,
  args: string[],
  opts: SpawnNpmAtOpts = {},
): SpawnSyncReturns<string | Buffer> {
  const cwd = path.resolve(projectRoot);
  return spawnSync("npm", ["--prefix", cwd, ...args], {
    cwd,
    env: npmEnvForProject(cwd, opts.env ?? process.env),
    stdio: opts.stdio ?? "inherit",
    encoding: opts.encoding,
  });
}
