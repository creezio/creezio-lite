/**
 * Env pour spawn d'un script JS via un binaire Node (ou Electron run-as-node).
 * Déplacé depuis electron-shell/host/node-runtime.ts (P1.b) : helper bas du
 * graphe partagé par @creezio/search (cohérence Meili) et
 * @creezio/host-runtime (embeds) — évite un cycle search ↔ host-runtime.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Env pour spawn d'un script JS via `nodeBinary`.
 * Si le binaire est Electron (`process.execPath`), FORCE `ELECTRON_RUN_AS_NODE=1`
 * — sinon le child relance l'UI (Win « rien ») / crash chrome-sandbox (Linux).
 */
export function envForNodeScriptSpawn(
  nodeBin: string,
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(baseEnv || process.env) };
  let same = false;
  try {
    same =
      path.resolve(nodeBin) === path.resolve(process.execPath) ||
      fs.realpathSync(nodeBin) === fs.realpathSync(process.execPath);
  } catch {
    same = nodeBin === process.execPath;
  }
  // Heuristique : binaire Electron packagé (…-Server, etc.) sans node système.
  const base = path.basename(nodeBin).toLowerCase();
  const looksElectron =
    same ||
    base === "electron" ||
    base.includes("creezio") ||
    base.endsWith("-server");
  if (looksElectron) env.ELECTRON_RUN_AS_NODE = "1";
  else delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
