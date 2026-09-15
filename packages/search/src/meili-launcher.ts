/**
 * Meilisearch local OPTIONNEL — launcher générique (injecte chemins).
 * Port de electron/meili-launcher.ts sans dépendances marque.
 */

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findFreePort,
  waitForMeiliHealth,
} from "@creezio/platform-core";

export type RunningMeili = {
  host: string;
  masterKey: string;
  child: ChildProcess;
  stop: () => void;
};

export type StartMeiliOptions = {
  /** Chemin binaire meilisearch (ou null → skip). */
  binaryPath: string | null;
  dataDir: string;
  userDataDir: string;
  log?: (line: string) => void;
  /**
   * Transforme l'env du child (sandbox OS optionnel côté app).
   * Défaut : process.env tel quel.
   */
  buildEnv?: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  onCrash?: (info: Record<string, unknown>) => void;
};

function ensureMasterKey(dataDir: string): string {
  const keyFile = path.join(dataDir, ".master-key");
  try {
    const existing = fs.readFileSync(keyFile, "utf8").trim();
    // Une clé base64url historique commençant par `-` casse le parsing CLI
    // de Meili (`--master-key -xxx` → « unexpected argument ») : régénérer.
    if (existing.length >= 16 && !existing.startsWith("-")) return existing;
  } catch {
    /* première exécution */
  }
  // hex (jamais de tiret) — une clé à tiret initial est illisible en argv.
  const key = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}

/**
 * Démarre Meilisearch si le binaire est disponible.
 * Retourne null (sans throw) si absent ou en échec.
 */
export async function startMeili(
  opts: StartMeiliOptions,
): Promise<RunningMeili | null> {
  const log = opts.log ?? ((l: string) => console.log(`[meili] ${l}`));
  const bin = opts.binaryPath;
  if (!bin || !fs.existsSync(bin)) {
    log(
      "binaire Meilisearch absent — le boot fail-closed décide " +
        "(maybeBootBrandMeili : throw si le feed déclare des index).",
    );
    return null;
  }
  try {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    const masterKey = ensureMasterKey(opts.dataDir);
    const port = await findFreePort();
    const host = `http://127.0.0.1:${port}`;

    log(`spawn ${bin} (port ${port}, data ${path.join(opts.dataDir, "data.ms")})`);
    const env =
      opts.buildEnv?.({ ...process.env }) ?? { ...process.env };

    const child = spawn(
      bin,
      [
        "--http-addr",
        `127.0.0.1:${port}`,
        "--db-path",
        path.join(opts.dataDir, "data.ms"),
        "--master-key",
        masterKey,
        "--no-analytics",
        "--env",
        "production",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env,
      },
    );

    const errTail: string[] = [];
    const keepTail = (line: string) => {
      errTail.push(line);
      if (errTail.length > 25) errTail.shift();
    };
    child.stdout?.on("data", (d: Buffer) =>
      d
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((l) => {
          keepTail(l);
          log(l);
        }),
    );
    child.stderr?.on("data", (d: Buffer) =>
      d
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((l) => {
          keepTail(l);
          log(`stderr: ${l}`);
        }),
    );
    child.on("error", (e) => {
      log(`spawn error: ${e.message}`);
      opts.onCrash?.({ child: "meilisearch", spawnError: e.message });
    });
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        log(`meilisearch terminé (code ${code})`);
        opts.onCrash?.({
          child: "meilisearch",
          code,
          output: errTail.join("\n"),
        });
      }
    });

    await waitForMeiliHealth(host);
    log(`Meilisearch local démarré sur ${host}`);
    return {
      host,
      masterKey,
      child,
      stop: () => {
        try {
          child.kill();
        } catch {
          /* déjà mort */
        }
      },
    };
  } catch (e) {
    log(
      `démarrage Meilisearch échoué (${e instanceof Error ? e.message : e}).`,
    );
    return null;
  }
}
