/**
 * Assure les binaires OS kit (Meili, cloudflared) sous
 * `@creezio/electron-shell/resources/bin` — jamais dans la marque.
 * Appelé au boot startBrandDesktop / harness pour le plug-and-play.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { kitOsResourcesRoot } from "@creezio/platform-core";

export type KitBinaryName = "meili" | "cloudflared";

export type EnsureKitBinariesResult = {
  ok: boolean;
  binDir: string;
  meili: string | null;
  cloudflared: string | null;
  downloaded: KitBinaryName[];
  errors: string[];
};

/** Version cloudflared pinée — alignée sur docker/server/Dockerfile. */
const CLOUDFLARED_VERSION = "2026.7.3";

function defaultDownloadUrl(name: KitBinaryName): string {
  if (name === "meili") {
    if (process.env.CREEZIO_MEILI_URL) return process.env.CREEZIO_MEILI_URL;
    return process.platform === "win32"
      ? "https://github.com/meilisearch/meilisearch/releases/download/v1.11.3/meilisearch-windows-amd64.exe"
      : "https://github.com/meilisearch/meilisearch/releases/download/v1.11.3/meilisearch-linux-amd64";
  }
  if (process.env.CREEZIO_CLOUDFLARED_URL) {
    return process.env.CREEZIO_CLOUDFLARED_URL;
  }
  return process.platform === "win32"
    ? `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`
    : `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`;
}

function binaryFileName(name: KitBinaryName): string {
  if (process.platform !== "win32") return name;
  // Le package Windows porte le nom canonique du stage electron-builder.
  // Conserver `meili.exe` en lecture comme alias des paquets historiques,
  // mais ne jamais le générer dans les nouveaux paquets.
  return name === "meili" ? "meilisearch-win.exe" : "cloudflared.exe";
}

function binaryNames(name: KitBinaryName): string[] {
  const canonical = binaryFileName(name);
  if (process.platform !== "win32" || name !== "meili") return [canonical];
  return [canonical, "meili.exe", "meilisearch.exe"];
}

function packagedBinDir(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (!resourcesPath || !path.isAbsolute(resourcesPath) || resourcesPath === path.sep) {
    return null;
  }
  return path.join(resourcesPath, "bin");
}

function binaryDirs(): string[] {
  return [
    ...(packagedBinDir() ? [packagedBinDir()!] : []),
    path.join(kitOsResourcesRoot(), "bin"),
  ];
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* */
          }
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      })
      .on("error", reject);
  });
}

async function ensureOne(
  name: KitBinaryName,
  binDir: string,
): Promise<{ path: string | null; downloaded: boolean; error?: string }> {
  const dest = path.join(
    binDir,
    binaryFileName(name),
  );
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    return { path: dest, downloaded: false };
  }
  if (process.env.CREEZIO_SKIP_KIT_BINARIES === "1") {
    return { path: null, downloaded: false, error: "CREEZIO_SKIP_KIT_BINARIES=1" };
  }
  const tmp = `${dest}.tmp`;
  try {
    await download(defaultDownloadUrl(name), tmp);
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, dest);
    return { path: dest, downloaded: true };
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* */
    }
    return {
      path: fs.existsSync(dest) ? dest : null,
      downloaded: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Chemins binaires kit (null si absents). */
export function kitBinaryPaths(): {
  binDir: string;
  meili: string | null;
  cloudflared: string | null;
} {
  const dirs = binaryDirs();
  const binDir = dirs[0]!;
  const resolve = (name: KitBinaryName): string | null => {
    for (const dir of dirs) {
      for (const file of binaryNames(name)) {
        const candidate = path.join(dir, file);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  };
  return {
    binDir,
    meili: resolve("meili"),
    cloudflared: resolve("cloudflared"),
  };
}

/**
 * Télécharge Meili + cloudflared si manquants.
 * No-op rapide si déjà présents.
 */
function resolveWritableBinDir(): string {
  // Packagé Electron : binaires sous process.resourcesPath/bin (hors app.asar).
  const packaged = packagedBinDir();
  if (packaged) return packaged;
  return path.join(kitOsResourcesRoot(), "bin");
}

export async function ensureKitOsBinaries(): Promise<EnsureKitBinariesResult> {
  const binDir = resolveWritableBinDir();
  const downloaded: KitBinaryName[] = [];
  const errors: string[] = [];

  try {
    fs.mkdirSync(binDir, { recursive: true });
  } catch (e) {
    // Soft : ne jamais planter le boot (EACCES /resources/bin vu en AppImage).
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`mkdir ${binDir}: ${msg}`);
    const existing = kitBinaryPaths();
    return {
      ok: Boolean(existing.meili || existing.cloudflared),
      binDir,
      meili: existing.meili,
      cloudflared: existing.cloudflared,
      downloaded,
      errors,
    };
  }

  if (process.env.CREEZIO_SKIP_KIT_BINARIES === "1") {
    const existing = kitBinaryPaths();
    return {
      ok: true,
      binDir,
      meili: existing.meili,
      cloudflared: existing.cloudflared,
      downloaded,
      errors,
    };
  }

  const meili = await ensureOne("meili", binDir);
  if (meili.downloaded) downloaded.push("meili");
  if (meili.error) errors.push(`meili: ${meili.error}`);

  const cf = await ensureOne("cloudflared", binDir);
  if (cf.downloaded) downloaded.push("cloudflared");
  if (cf.error) errors.push(`cloudflared: ${cf.error}`);

  if (meili.path) {
    const ver = spawnSync(meili.path, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (ver.status !== 0 && ver.error) {
      errors.push(`meili --version: ${ver.error.message}`);
    }
  }

  return {
    ok: Boolean(meili.path && cf.path),
    binDir,
    meili: meili.path,
    cloudflared: cf.path,
    downloaded,
    errors,
  };
}
