/**
 * Écriture fichiers app marque — respecte `creezio:owned-by-brand`
 * même avec --force (le métier enrichi ne doit pas être wipe).
 *
 * package.json avec creezio.ownedByBrand=true : on régénère le shell npm
 * (deps/scripts template) mais on conserve creezio.* + scripts métier.
 */
import fs from "node:fs";
import path from "node:path";

export const OWNED_BY_BRAND_MARKER = "creezio:owned-by-brand";

function isPackageJsonOwned(raw: string): boolean {
  try {
    const pkg = JSON.parse(raw) as {
      creezio?: { ownedByBrand?: boolean };
    };
    return pkg.creezio?.ownedByBrand === true;
  } catch {
    return false;
  }
}

export function isOwnedByBrand(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const head = raw.slice(0, 4000);
    if (head.includes(OWNED_BY_BRAND_MARKER)) return true;
    if (path.basename(filePath) === "package.json") {
      return isPackageJsonOwned(raw);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Fusion package.json marque : template factory + creezio/scripts métier.
 */
export function mergeOwnedPackageJson(
  existingRaw: string,
  templateRaw: string,
): string {
  const prev = JSON.parse(existingRaw) as {
    creezio?: Record<string, unknown>;
    scripts?: Record<string, string>;
    [k: string]: unknown;
  };
  const neu = JSON.parse(templateRaw) as {
    creezio?: Record<string, unknown>;
    scripts?: Record<string, string>;
    [k: string]: unknown;
  };
  neu.creezio = {
    ...(neu.creezio ?? {}),
    ...(prev.creezio ?? {}),
    ownedByBrand: true,
  };
  neu.scripts = { ...(neu.scripts ?? {}), ...(prev.scripts ?? {}) };
  // Conserver name/version/description métier si déjà customisés.
  if (typeof prev.name === "string") neu.name = prev.name;
  if (typeof prev.version === "string") neu.version = prev.version;
  if (typeof prev.description === "string") neu.description = prev.description;
  return `${JSON.stringify(neu, null, 2)}\n`;
}

/**
 * Pages OS kit — jamais propriété marque. Écrase même `owned-by-brand`
 * (pollution historique agents qui ont marqué mails/mcp/setup).
 */
export function writeOsUiAppFile(
  filePath: string,
  content: string | Buffer,
  written: string[],
): boolean {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existed = fs.existsSync(filePath);
  const wasOwned = existed && isOwnedByBrand(filePath);
  fs.writeFileSync(filePath, content);
  written.push(filePath);
  if (wasOwned) {
    console.log(
      `overwrite OS UI (was owned-by-brand) ${path.relative(process.cwd(), filePath)}`,
    );
  }
  return true;
}

/**
 * @returns true si écrit, false si skip (owned-by-brand)
 */
export function writeAppFile(
  filePath: string,
  content: string | Buffer,
  force: boolean,
  written: string[],
): boolean {
  if (fs.existsSync(filePath)) {
    if (isOwnedByBrand(filePath)) {
      // package.json : merge au lieu de skip total (sinon deps factory figées).
      if (
        path.basename(filePath) === "package.json" &&
        force &&
        typeof content === "string"
      ) {
        try {
          const existing = fs.readFileSync(filePath, "utf8");
          const merged = mergeOwnedPackageJson(existing, content);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, merged);
          written.push(filePath);
          console.log(
            `merge owned-by-brand package.json ${path.relative(process.cwd(), filePath)}`,
          );
          return true;
        } catch {
          const rel = path.relative(process.cwd(), filePath);
          console.log(`skip owned-by-brand ${rel}`);
          return false;
        }
      }
      const rel = filePath.includes(process.cwd())
        ? path.relative(process.cwd(), filePath)
        : filePath;
      console.log(`skip owned-by-brand ${rel}`);
      return false;
    }
    if (!force) {
      throw new Error(`Fichier existe déjà (utilisez --force): ${filePath}`);
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  written.push(filePath);
  return true;
}
