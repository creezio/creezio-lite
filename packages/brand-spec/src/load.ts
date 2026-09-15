import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  defaultPlatformNeeds,
  type BrandModuleSpec,
  type BrandSpec,
  type BrandYaml,
} from "./types.js";

const MODULE_FILES = {
  prd: ["prd.md", "PRD.md"],
  schema: ["schema.sql", "schema.ts"],
  api: ["api.ts", "api.md"],
  mcp: ["mcp.yaml", "mcp.yml", "mcp.md"],
  ui: ["ui.md", "pages.md"],
} as const;

function readText(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function firstExisting(dir: string, names: readonly string[]): boolean {
  return names.some((n) => fs.existsSync(path.join(dir, n)));
}

function loadBrandYaml(rootDir: string): BrandYaml {
  const yamlPath = path.join(rootDir, "brand.yaml");
  const ymlPath = path.join(rootDir, "brand.yml");
  const file = fs.existsSync(yamlPath)
    ? yamlPath
    : fs.existsSync(ymlPath)
      ? ymlPath
      : null;
  if (!file) {
    throw new Error(`brand.yaml introuvable sous ${rootDir}`);
  }
  const raw = parseYaml(fs.readFileSync(file, "utf8")) as Partial<BrandYaml>;
  if (!raw || typeof raw !== "object") {
    throw new Error(`brand.yaml invalide: ${file}`);
  }
  if (!raw.brandId || !raw.brandName || !raw.domain) {
    throw new Error(
      "brand.yaml doit définir brandId, brandName et domain",
    );
  }
  const platform = {
    ...defaultPlatformNeeds(),
    ...(raw.platform || {}),
  };
  return {
    brandId: String(raw.brandId).trim(),
    brandName: String(raw.brandName).trim(),
    domain: String(raw.domain).trim(),
    tagline: raw.tagline ? String(raw.tagline) : undefined,
    vertical:
      typeof raw.vertical === "string" && raw.vertical.trim()
        ? raw.vertical.trim()
        : undefined,
    sandbox: raw.sandbox !== false,
    defaultServerUrl: raw.defaultServerUrl
      ? String(raw.defaultServerUrl).trim()
      : undefined,
    platform,
    meili: raw.meili,
    mcp: raw.mcp,
    onboarding: raw.onboarding,
  };
}

function loadModules(rootDir: string): BrandModuleSpec[] {
  const modulesDir = path.join(rootDir, "modules");
  if (!fs.existsSync(modulesDir)) return [];
  const entries = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_template" && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  return entries.map((id) => {
    const dir = path.join(modulesDir, id);
    return {
      id,
      dir,
      hasPrd: firstExisting(dir, MODULE_FILES.prd),
      hasSchema: firstExisting(dir, MODULE_FILES.schema),
      hasApi: firstExisting(dir, MODULE_FILES.api),
      hasMcp: firstExisting(dir, MODULE_FILES.mcp),
      hasUi: firstExisting(dir, MODULE_FILES.ui),
    };
  });
}

function loadInterviewSchema(rootDir: string): unknown | null {
  const p = path.join(rootDir, "interview.schema.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Charge un dossier `brand-spec/` (ou racine marque contenant brand.yaml).
 */
export function loadBrandSpec(rootDir: string): BrandSpec {
  const abs = path.resolve(rootDir);
  if (!fs.existsSync(abs)) {
    throw new Error(`brand-spec introuvable: ${abs}`);
  }
  const brand = loadBrandYaml(abs);
  const platformDir = path.join(abs, "platform");
  const databasesDir = path.join(abs, "databases");
  return {
    rootDir: abs,
    brand,
    productMd: readText(path.join(abs, "product.md")),
    modules: loadModules(abs),
    platformDir: fs.existsSync(platformDir) ? platformDir : null,
    databasesDir: fs.existsSync(databasesDir) ? databasesDir : null,
    agentsMd: readText(path.join(abs, "AGENTS.md")),
    interviewSchema: loadInterviewSchema(abs),
  };
}

/**
 * Résout le dossier brand-spec d'une app marque.
 * Ordre : `<app>/brand-spec` puis `<app>` si brand.yaml à la racine.
 */
export function resolveBrandSpecDir(appRoot: string): string | null {
  const candidates = [
    path.join(appRoot, "brand-spec"),
    appRoot,
  ];
  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, "brand.yaml")) ||
      fs.existsSync(path.join(c, "brand.yml"))
    ) {
      return c;
    }
  }
  return null;
}
