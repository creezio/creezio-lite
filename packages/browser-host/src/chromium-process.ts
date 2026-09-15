/**
 * Spawn / supervision du binaire Chromium (sidecar serveur, sans Electron).
 *
 * - `--remote-debugging-port=0` : port CDP éphémère, ws:// parsé sur stderr ;
 * - `--user-data-dir=<profil>` : profil PERSISTANT par IA (cookies/sessions) ;
 * - headful sous Xvfb (DISPLAY) par défaut en container — certains sites
 *   refusent le mode headless ; fallback `--headless=new` si aucun DISPLAY.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

export type ChromiumLaunchOptions = {
  /** Profil persistant (ex. /data/browser/<aiUserId>). Créé si absent. */
  userDataDir: string;
  /** Binaire explicite — sinon CREEZIO_CHROMIUM_BIN puis candidats connus. */
  binary?: string;
  /** Force le mode headless=new (défaut : headful si DISPLAY dispo). */
  headless?: boolean;
  /** DISPLAY X (Xvfb) pour le mode headful. Défaut : process.env.DISPLAY. */
  display?: string;
  /** User-Agent forcé (sinon celui du binaire, override par page possible). */
  userAgent?: string;
  /**
   * Proxy sortant (`--proxy-server=`), ex. `http://user:pass@host:3128` ou
   * `socks5://host:1080`. Limitation : un proxy datacenter n'anonymise pas —
   * beaucoup de sites détectent/bloquent les plages IP datacenter (voir
   * README § Modèle de menace).
   */
  proxyServer?: string;
  extraArgs?: string[];
  onLog?: (line: string) => void;
};

export type ChromiumHandle = {
  child: ChildProcess;
  wsUrl: string;
  headless: boolean;
  /** Résolue à la sortie du process (code ou null si signal). */
  exited: Promise<number | null>;
  kill: () => void;
};

const BINARY_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
];

export function findChromiumBinary(): string | null {
  const env = String(process.env.CREEZIO_CHROMIUM_BIN || "").trim();
  if (env && fs.existsSync(env)) return env;
  for (const candidate of BINARY_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function wantSandboxOff(): boolean {
  if (process.env.CREEZIO_BROWSER_NO_SANDBOX === "1") return true;
  // Container Docker : root sans userns → le sandbox Chromium ne démarre pas.
  try {
    return typeof process.getuid === "function" && process.getuid() === 0;
  } catch {
    return false;
  }
}

/**
 * Purge les verrous Singleton* d'un profil persistant : après recréation du
 * container (hostname différent), Chromium refuse sinon de démarrer
 * (« profile in use on another computer »). Sûr ici : l'AiSessionHost
 * garantit un seul Chromium par profil dans ce process.
 */
function clearStaleProfileLocks(
  userDataDir: string,
  onLog?: (line: string) => void,
): void {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const p = `${userDataDir}/${name}`;
    try {
      // lstat : les verrous sont des symlinks morts (existsSync = false).
      fs.lstatSync(p);
      fs.rmSync(p, { force: true });
      onLog?.(`verrou profil obsolète purgé: ${name}`);
    } catch {
      /* absent — rien à faire */
    }
  }
}

export async function launchChromium(
  opts: ChromiumLaunchOptions,
): Promise<ChromiumHandle> {
  const binary = opts.binary || findChromiumBinary();
  if (!binary) {
    throw new Error(
      "Chromium introuvable — installer chromium (variant Docker browser) ou définir CREEZIO_CHROMIUM_BIN",
    );
  }
  // 0700 : le profil contient cookies/sessions en clair — accès propriétaire
  // uniquement (voir README § Modèle de menace).
  fs.mkdirSync(opts.userDataDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(opts.userDataDir, 0o700);
  } catch {
    /* best-effort (FS sans permissions POSIX) */
  }
  clearStaleProfileLocks(opts.userDataDir, opts.onLog);

  const display = opts.display ?? process.env.DISPLAY ?? "";
  const headless = opts.headless ?? !display;

  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${opts.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-features=TranslateUI",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--window-size=1280,800",
    ...(headless ? ["--headless=new"] : []),
    ...(wantSandboxOff() ? ["--no-sandbox"] : []),
    ...(opts.proxyServer ? [`--proxy-server=${opts.proxyServer}`] : []),
    ...(opts.userAgent ? [`--user-agent=${opts.userAgent}`] : []),
    ...(opts.extraArgs || []),
    "about:blank",
  ];

  const child = spawn(binary, args, {
    env: {
      ...process.env,
      ...(display ? { DISPLAY: display } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });

  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGKILL");
      reject(
        new Error(
          `Chromium n'a pas exposé DevTools en 30s (binaire ${binary})${buffer ? ` — dernier stderr: ${buffer.slice(-300)}` : ""}`,
        ),
      );
    }, 30_000);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      opts.onLog?.(chunk.toString("utf8").trim());
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (m && m[1]) {
        cleanup();
        resolve(m[1]);
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `Chromium terminé avant DevTools (code ${code})${buffer ? ` — stderr: ${buffer.slice(-300)}` : ""}`,
        ),
      );
    };
    function cleanup() {
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    }
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });

  return {
    child,
    wsUrl,
    headless,
    exited,
    kill: () => {
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* déjà mort */
          }
        }, 3000).unref?.();
      } catch {
        /* ignore */
      }
    },
  };
}
