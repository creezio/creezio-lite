#!/usr/bin/env node
/**
 * Smoke live browser-host : lance Chromium (profil temporaire), ouvre une
 * page HTML locale, exécute list_targets / click / type / read / screenshot
 * via le driver partagé, capture 2+ frames de screencast. Exit 0 si tout OK.
 *
 * Env : CREEZIO_CHROMIUM_BIN (binaire), CREEZIO_BROWSER_PROFILE_ROOT
 * (défaut : dossier temp), CREEZIO_BROWSER_HEADLESS=0 pour headful (DISPLAY).
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { BrowserHost, runDriverVerb, findChromiumBinary } from "../dist/index.js";

const PAGE = `<!doctype html><html><head><title>Creezio Smoke</title></head><body>
<h1>Page de test driver</h1>
<button id="btn" onclick="document.getElementById('out').textContent='CLIQUE OK'">Valider la commande</button>
<input placeholder="Votre recherche" id="search" />
<div id="out">EN ATTENTE</div>
<script>document.getElementById('search').addEventListener('input',(e)=>{document.getElementById('out').textContent='SAISIE:'+e.target.value;});</script>
</body></html>`;

async function main() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const profileRoot =
    process.env.CREEZIO_BROWSER_PROFILE_ROOT ||
    fs.mkdtempSync(path.join(os.tmpdir(), "creezio-browser-smoke-"));
  const binary = findChromiumBinary();
  console.log(`[smoke] chromium=${binary} profil=${profileRoot}`);

  const host = await BrowserHost.launch({
    userDataDir: path.join(profileRoot, "smoke"),
    headless: process.env.CREEZIO_BROWSER_HEADLESS !== "0",
  });
  console.log(`[smoke] UA=${host.userAgent}`);

  const failures = [];
  const check = (name, cond, detail) => {
    console.log(`[smoke] ${cond ? "OK " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures.push(name);
  };

  try {
    const page = await host.newPage(url);

    const list = await runDriverVerb(page, "list_targets", {});
    check("list_targets", list.ok === true && Array.isArray(list.targets) && list.targets.length >= 2, `${(list.targets || []).length} cibles`);

    const click = await runDriverVerb(page, "click", { label: "Valider la commande" });
    check("click", click.ok === true, JSON.stringify(click.clicked || click.error));

    const read1 = await runDriverVerb(page, "read", { q: "CLIQUE" });
    check("read après click", read1.ok === true && String(read1.text || "").includes("CLIQUE OK"));

    const type = await runDriverVerb(page, "type", { label: "Votre recherche", text: "chromium sidecar" });
    check("type", type.ok === true, JSON.stringify(type.typed || type.error));

    const read2 = await runDriverVerb(page, "read", { q: "SAISIE" });
    check("read après type", read2.ok === true && String(read2.text || "").includes("SAISIE:chromium sidecar"));

    const shot = await runDriverVerb(page, "screenshot", {});
    check("screenshot", shot.ok === true && String(shot.imageBase64 || "").length > 1000, `${String(shot.imageBase64 || "").length} chars`);

    let frames = 0;
    await page.startScreencast(() => { frames += 1; });
    await runDriverVerb(page, "scroll", { direction: "down" });
    await new Promise((r) => setTimeout(r, 1500));
    await page.stopScreencast();
    check("screencast frames", frames >= 1, `${frames} frames`);

    await page.close();
  } finally {
    await host.close();
    server.close();
  }

  if (failures.length) {
    console.error(`[smoke] ÉCHEC: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("[smoke] browser-host OK");
}

main().catch((e) => {
  console.error("[smoke] erreur:", e);
  process.exit(1);
});
