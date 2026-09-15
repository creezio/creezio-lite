#!/usr/bin/env node
/**
 * Génère electron-builder.client.json / .server.json via buildElectronBuilderConfig.
 * SoT = src/electron/app-manifest.json (H11 : plus de fallback registre kit).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildElectronBuilderConfig,
  renderNsisInstallerInclude,
} from "@creezio/brand-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const kind = process.argv[2] === "server" ? "server" : "client";
const brandId = process.env.CREEZIO_BRAND || "demobrand";

const genPath = path.join(root, "src/electron/app-manifest.json");
if (!fs.existsSync(genPath)) {
  throw new Error(
    `Manifest introuvable pour ${brandId} — src/electron/app-manifest.json requis (H11)`,
  );
}
const manifest = JSON.parse(fs.readFileSync(genPath, "utf8"));
if (manifest.brandId !== brandId) {
  throw new Error(
    `app-manifest.json brandId=${manifest.brandId} ≠ CREEZIO_BRAND=${brandId}`,
  );
}

const base = JSON.parse(
  fs.readFileSync(path.join(root, "electron-builder.base.json"), "utf8"),
);
const cfg = buildElectronBuilderConfig(manifest, kind, base);
const out = path.join(root, `electron-builder.${kind}.json`);
fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + "\n");
console.log("wrote", out);

const nsh = path.join(root, "installer.nsh");
fs.writeFileSync(nsh, renderNsisInstallerInclude(manifest));
console.log("wrote", nsh);
