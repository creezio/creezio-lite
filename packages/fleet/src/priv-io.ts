/**
 * Lecture / écriture privilégiée des fichiers stack flotte (cf.env,
 * secrets.env, fleet-hosts.json, servers.json) — même chemin que
 * persistDedicatedAgentUrl (factory) : direct → `sudo -n` → wrapper
 * `/usr/local/sbin/creezio-server-docker priv-io`. Jamais de chmod/chown
 * one-shot. Fail-closed si sudo + wrapper impossibles.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

export const CREEZIO_SERVER_DOCKER_WRAPPER =
  "/usr/local/sbin/creezio-server-docker";

export type SudoExec = (
  argv: string[],
  opts?: { input?: string },
) => { ok: boolean; stdout: string; stderr: string };

export function isFsPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM";
}

function spawnSudo(
  argv: string[],
  opts?: { input?: string },
): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("sudo", ["-n", ...argv], {
    encoding: "utf8",
    input: opts?.input,
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout || "",
    stderr: String(r.stderr || r.error?.message || ""),
  };
}

export function defaultSudoExec(
  argv: string[],
  opts?: { input?: string },
): { ok: boolean; stdout: string; stderr: string } {
  const direct = spawnSudo(argv, opts);
  if (direct.ok) return direct;
  if (!fs.existsSync(CREEZIO_SERVER_DOCKER_WRAPPER)) return direct;
  const viaWrapper = spawnSudo(
    [CREEZIO_SERVER_DOCKER_WRAPPER, "priv-io", ...argv],
    opts,
  );
  if (viaWrapper.ok) return viaWrapper;
  return {
    ok: false,
    stdout: viaWrapper.stdout || direct.stdout,
    stderr:
      [direct.stderr, viaWrapper.stderr].filter(Boolean).join(" | ") ||
      "sudo -n / wrapper refusés",
  };
}

export function permissionError(message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = "EACCES";
  return err;
}

export function formatStackFileEaccesError(filePath: string): string {
  return (
    `fichier stack ${filePath} est root:root 600 (écrit par un geste root / wrapper) ` +
    `et sudo -n / ${CREEZIO_SERVER_DOCKER_WRAPPER} priv-io ont échoué. ` +
    `Ne PAS chmod/chown à la main. ` +
    `Chemin qui marche : installer ${CREEZIO_SERVER_DOCKER_WRAPPER} ` +
    `(docker/server/creezio-server-docker-sudo.sh) avec sudoers ` +
    `NOPASSWD: ${CREEZIO_SERVER_DOCKER_WRAPPER} puis relancer ` +
    `creezio server-docker update|migrate-stack|ensure-owner.`
  );
}

export type PrivilegedFileIo = {
  readFile: (filePath: string) => string;
  writeFile: (filePath: string, body: string) => void;
  exists: (filePath: string) => boolean;
  rmFile: (filePath: string) => void;
};

export function readTextFileDirectOrSudo(
  filePath: string,
  sudoExec: SudoExec = defaultSudoExec,
): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
  }
  const r = sudoExec(["cat", filePath]);
  if (!r.ok) {
    throw permissionError(r.stderr || formatStackFileEaccesError(filePath));
  }
  return r.stdout;
}

export function writeTextFileDirectOrSudo(
  filePath: string,
  body: string,
  sudoExec: SudoExec = defaultSudoExec,
): void {
  try {
    fs.writeFileSync(filePath, body, { mode: 0o600 });
    return;
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
  }
  const tee = sudoExec(["tee", filePath], { input: body });
  if (!tee.ok) {
    throw permissionError(tee.stderr || formatStackFileEaccesError(filePath));
  }
  sudoExec(["chmod", "600", filePath]);
}

export function rmFileDirectOrSudo(
  filePath: string,
  sudoExec: SudoExec = defaultSudoExec,
): void {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    return;
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
  }
  const r = sudoExec(["rm", "-f", filePath]);
  if (!r.ok) {
    throw permissionError(r.stderr || formatStackFileEaccesError(filePath));
  }
}

export function fileExistsDirectOrSudo(
  filePath: string,
  sudoExec: SudoExec = defaultSudoExec,
): boolean {
  try {
    return fs.existsSync(filePath);
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
  }
  const r = sudoExec(["test", "-e", filePath]);
  return r.ok;
}

export function createPrivilegedFileIo(sudoExec: SudoExec = defaultSudoExec): PrivilegedFileIo {
  return {
    readFile: (p) => readTextFileDirectOrSudo(p, sudoExec),
    writeFile: (p, body) => writeTextFileDirectOrSudo(p, body, sudoExec),
    exists: (p) => fileExistsDirectOrSudo(p, sudoExec),
    rmFile: (p) => rmFileDirectOrSudo(p, sudoExec),
  };
}

export const defaultPrivilegedFileIo: PrivilegedFileIo = createPrivilegedFileIo();
