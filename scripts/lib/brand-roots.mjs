/**
 * Resolve brand CRM roots across VPS (/opt/docker/…) and sibling layouts
 * (e.g. cloud agents: /agent/repos/{creezio,tempoflow2,…}).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(here, "../..");

/** Canonical brand directory names (repo folder under docker/sibling root). */
export const BRAND_IDS = ["tempoflow2", "certivan-app", "fidu"];

function envKey(brand) {
  return `CREEZIO_BRAND_ROOT_${String(brand).toUpperCase().replace(/-/g, "_")}`;
}

function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Resolve the brand repository root (parent of `crm/`).
 * @param {string} brand — tempoflow2 | certivan-app | fidu
 */
export function resolveBrandRoot(brand) {
  if (!BRAND_IDS.includes(brand)) {
    throw new Error(`unknown brand id: ${brand}`);
  }
  const fromEnv = process.env[envKey(brand)];
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (fs.existsSync(path.join(abs, "crm"))) return abs;
    // Env may point at …/crm directly
    if (path.basename(abs) === "crm" && fs.existsSync(abs)) {
      return path.dirname(abs);
    }
    if (fs.existsSync(abs)) return abs;
  }

  const found = firstExisting([
    `/opt/docker/${brand}`,
    path.resolve(KIT_ROOT, `../${brand}`),
    path.resolve(KIT_ROOT, `../../${brand}`),
    path.resolve(KIT_ROOT, `../../../${brand}`),
  ]);
  return found ?? path.resolve(KIT_ROOT, `../${brand}`);
}

/**
 * Resolve the brand CRM root (`…/<brand>/crm`).
 * Order: env → /opt/docker → sibling ../ → ../../ → …
 * @param {string} brand — tempoflow2 | certivan-app | fidu
 */
export function resolveBrandCrmRoot(brand) {
  if (!BRAND_IDS.includes(brand)) {
    throw new Error(`unknown brand id: ${brand}`);
  }
  const fromEnv = process.env[envKey(brand)];
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (fs.existsSync(path.join(abs, "crm"))) return path.join(abs, "crm");
    if (fs.existsSync(abs)) return abs;
  }

  const found = firstExisting([
    `/opt/docker/${brand}/crm`,
    path.resolve(KIT_ROOT, `../${brand}/crm`),
    path.resolve(KIT_ROOT, `../../${brand}/crm`),
    path.resolve(KIT_ROOT, `../../../${brand}/crm`),
  ]);
  return found ?? path.resolve(KIT_ROOT, `../${brand}/crm`);
}

/** Map brand id → CRM root (resolved once at import). */
export const BRAND_CRM_ROOTS = Object.fromEntries(
  BRAND_IDS.map((id) => [id, resolveBrandCrmRoot(id)]),
);

/** Map brand id → repo root (resolved once at import). */
export const BRAND_ROOTS = Object.fromEntries(
  BRAND_IDS.map((id) => [id, resolveBrandRoot(id)]),
);
