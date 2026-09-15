#!/usr/bin/env node
/**
 * electron-builder Linux CollectIcons exige `resources/icons/{N}x{N}.png`.
 * Dérive depuis client.png (ou CREEZIO_ICON_SOURCE).
 *
 * Usage :
 *   node …/ensure-linux-icons.mjs [appRoot]
 *   CREEZIO_ICON_SOURCE=/path/to.png node …/ensure-linux-icons.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(process.argv[2] || process.cwd());
const icons = path.join(appRoot, "resources", "icons");
fs.mkdirSync(icons, { recursive: true });

const client = path.join(icons, "client.png");
const source =
  process.env.CREEZIO_ICON_SOURCE ||
  process.env.ICON_SOURCE ||
  "";

function pngSize(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 24 || buf[0] !== 0x89) return 0;
    return buf.readUInt32BE(16);
  } catch {
    return 0;
  }
}

if (source && fs.existsSync(source)) {
  fs.copyFileSync(source, client);
  console.log("ensure-linux-icons: client.png ←", source);
} else if (
  !fs.existsSync(client) ||
  fs.statSync(client).size < 2000 ||
  pngSize(client) < 128
) {
  console.warn(
    "ensure-linux-icons: client.png manquant / trop petit — " +
      "fournir resources/icons/client.png (≥128px) ou CREEZIO_ICON_SOURCE",
  );
}

const sizes = [16, 32, 48, 64, 128, 256, 512];
if (!fs.existsSync(client)) {
  console.error("ensure-linux-icons: abort — pas de client.png");
  process.exit(1);
}

function needsRegen(out) {
  if (!fs.existsSync(out) || fs.statSync(out).size < 100) return true;
  // Regénérer si client.png a été remplacé (mtime plus récent).
  return fs.statSync(client).mtimeMs > fs.statSync(out).mtimeMs;
}

const force = process.env.CREEZIO_ICONS_FORCE === "1" ||
  process.argv.includes("--force");

const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpeg.status === 0) {
  for (const s of sizes) {
    const out = path.join(icons, `${s}x${s}.png`);
    if (!force && !needsRegen(out)) continue;
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-i", client, "-vf", `scale=${s}:${s}`, out],
      { encoding: "utf8" },
    );
    if (r.status !== 0) fs.copyFileSync(client, out);
  }
  fs.copyFileSync(path.join(icons, "512x512.png"), path.join(icons, "icon.png"));
  fs.copyFileSync(
    path.join(icons, "512x512.png"),
    path.join(appRoot, "resources", "icon.png"),
  );
} else {
  for (const s of sizes) {
    const out = path.join(icons, `${s}x${s}.png`);
    if (force || needsRegen(out)) fs.copyFileSync(client, out);
  }
  fs.copyFileSync(client, path.join(icons, "icon.png"));
  fs.copyFileSync(client, path.join(appRoot, "resources", "icon.png"));
}

console.log("ensure-linux-icons: ok", icons);

// silence unused when imported
void fileURLToPath;
