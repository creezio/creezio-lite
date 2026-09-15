#!/usr/bin/env node
/**
 * Télécharge les binaires OS kit (Meili, cloudflared) sous resources/bin.
 * Appelé par preuves / packaging — jamais dans la marque.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../host-runtime",
);
const bin = path.join(root, "resources", "bin");
fs.mkdirSync(bin, { recursive: true });

function download(url, dest) {
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
          fs.unlinkSync(dest);
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(dest)));
      })
      .on("error", reject);
  });
}

async function ensure(name, url) {
  const dest = path.join(bin, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log(`OK present ${dest}`);
    return dest;
  }
  console.log(`download ${name}…`);
  const tmp = `${dest}.tmp`;
  await download(url, tmp);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
  console.log(`OK ${dest}`);
  return dest;
}

const meiliUrl =
  process.env.CREEZIO_MEILI_URL ||
  "https://github.com/meilisearch/meilisearch/releases/download/v1.11.3/meilisearch-linux-amd64";
const cfUrl =
  process.env.CREEZIO_CLOUDFLARED_URL ||
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";

await ensure("meili", meiliUrl);
await ensure("cloudflared", cfUrl);

const meili = path.join(bin, "meili");
const ver = spawnSync(meili, ["--version"], { encoding: "utf8" });
console.log((ver.stdout || ver.stderr || "").trim() || "meili ok");
process.exit(0);
