#!/usr/bin/env node
/**
 * Gate — module natif hybride « landing page » (ADR-module-natif-hybride).
 *
 * Verrouille :
 *   1. le moteur kit @creezio/landing (migrations, seed, mount CRUD + public,
 *      contenu 100 % DB) ;
 *   2. le mode brand-web du tunnel provisioner (lp.{zone}, un seul ingress,
 *      slug lp réservé aux marques) ;
 *   3. le câblage factory du repo admin (toute marque neuve naît avec le
 *      module + pages /landing, /lp, /lp-media + middleware host lp.).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createLandingMount,
  defaultLandingSeed,
  buildLandingSeedSql,
  landingMigrations,
  LANDING_PREFAB_KINDS,
} from "../packages/landing/dist/index.js";
import {
  BRAND_WEB_SLUGS,
  buildTunnelIngressRules,
  tunnelPublicUrls,
  slugCheckLocal,
} from "../packages/platform-core/dist/tunnel-cf.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// 1. Moteur kit
// ---------------------------------------------------------------------------

test("landing.migrations — schéma + seed défaut, ids stables", () => {
  const migs = landingMigrations();
  assert.deepEqual(
    migs.map((m) => m.id),
    ["landing_001_schema", "landing_002_seed_default"],
  );
  assert.match(migs[0].sql, /landing_sections/);
  assert.match(migs[0].sql, /landing_settings/);
  assert.match(migs[0].sql, /landing_media/);
  // Seed idempotent + tous les kinds préfabriqués présents par défaut.
  assert.match(migs[1].sql, /INSERT OR IGNORE/);
  for (const kind of LANDING_PREFAB_KINDS) {
    assert.ok(migs[1].sql.includes(`'${kind}'`), `seed sans kind ${kind}`);
  }
});

test("landing.seed — la marque paramètre son contenu (rien de hardcodé kit)", () => {
  const seed = defaultLandingSeed({ brandName: "ProbeBrand", tagline: "Slogan probe" });
  assert.equal(seed.settings.brandName, "ProbeBrand");
  const sql = buildLandingSeedSql(seed);
  assert.match(sql, /ProbeBrand/);
  assert.match(sql, /Slogan probe/);
  // Échappement SQL des apostrophes (contenu français).
  const apostrophe = buildLandingSeedSql(
    defaultLandingSeed({ brandName: "L'Atelier" }),
  );
  assert.match(apostrophe, /L''Atelier/);
});

function memoryDb() {
  // Stub SQLite minimal (prepare/get/all/run) suffisant pour le mount.
  const sections = new Map();
  const settings = new Map();
  return {
    layer: "brand",
    path: ":memory:",
    exec() {},
    access() {
      throw new Error("cross access interdit");
    },
    prepare(sql) {
      const s = String(sql);
      return {
        get(...args) {
          if (s.includes("FROM landing_settings")) {
            const row = settings.get("settings");
            return row ? { value_json: row } : undefined;
          }
          if (s.includes("MAX(position)")) {
            const m = Math.max(0, ...[...sections.values()].map((r) => r.position));
            return { m };
          }
          if (s.includes("FROM landing_sections WHERE id")) {
            return sections.get(args[0]);
          }
          return undefined;
        },
        all() {
          const rows = [...sections.values()].sort(
            (a, b) => a.position - b.position,
          );
          if (s.includes("enabled = 1")) return rows.filter((r) => r.enabled);
          return rows;
        },
        run(...args) {
          if (s.startsWith("INSERT INTO landing_sections")) {
            const [id, kind, position, enabled, content_json, created_at, updated_at] = args;
            sections.set(id, { id, kind, position, enabled, content_json, created_at, updated_at });
          } else if (s.includes("UPDATE landing_sections SET kind")) {
            const [kind, position, enabled, content_json, updated_at, id] = args;
            const cur = sections.get(id);
            sections.set(id, { ...cur, kind, position, enabled, content_json, updated_at });
          } else if (s.includes("UPDATE landing_sections SET position")) {
            const [position, updated_at, id] = args;
            const cur = sections.get(id);
            if (cur) sections.set(id, { ...cur, position, updated_at });
          } else if (s.startsWith("DELETE FROM landing_sections")) {
            sections.delete(args[0]);
          } else if (s.includes("INSERT INTO landing_settings")) {
            settings.set("settings", args[0]);
          }
          return { changes: 1 };
        },
      };
    },
  };
}

test("landing.mount — CRUD sections + public + settings (contenu en DB)", async () => {
  const mount = createLandingMount();
  assert.equal(mount.dbLayer, "brand");
  const db = memoryDb();
  const call = (method, subPath, body) =>
    mount.handle({
      req: { method, path: `/api/v1/modules/landing/${subPath}`, body },
      space: "module",
      mountId: "landing",
      subPath,
      db,
    });

  // Sans db → 503 explicite.
  const noDb = await mount.handle({
    req: { method: "GET", path: "/api/v1/modules/landing/public" },
    space: "module",
    mountId: "landing",
    subPath: "public",
  });
  assert.equal(noDb.status, 503);

  // Créer une section hero, la lire en public.
  const created = await call("POST", "sections", {
    kind: "hero",
    content: { title: "Titre édité", subtitle: "Sous-titre" },
  });
  assert.equal(created.status, 201);
  const id = created.body.section.id;

  let pub = await call("GET", "public");
  assert.equal(pub.status, 200);
  assert.equal(pub.body.sections.length, 1);
  assert.equal(pub.body.sections[0].content.title, "Titre édité");

  // Édition texte (le cœur du patron hybride : contenu DB, pas code).
  const updated = await call("PUT", `sections/${id}`, {
    content: { title: "Titre modifié depuis l'admin", subtitle: "Sous-titre" },
  });
  assert.equal(updated.status, 200);
  pub = await call("GET", "public");
  assert.equal(pub.body.sections[0].content.title, "Titre modifié depuis l'admin");

  // Désactivation → disparaît du rendu public.
  await call("PUT", `sections/${id}`, { enabled: false });
  pub = await call("GET", "public");
  assert.equal(pub.body.sections.length, 0);

  // Settings persistés.
  const st = await call("PUT", "settings", { brandName: "Probe", accent: "#123456" });
  assert.equal(st.status, 200);
  const stGet = await call("GET", "settings");
  assert.equal(stGet.body.settings.accent, "#123456");

  // Kinds préfabriqués exposés pour l'admin.
  const kinds = await call("GET", "kinds");
  assert.deepEqual(kinds.body.kinds, [...LANDING_PREFAB_KINDS]);
});

test("landing.media — upload base64 borné, service via route Next", async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "lnd-gate-"));
  try {
    const mount = createLandingMount({ mediaDir: tmp, maxUploadBytes: 64 });
    const db = memoryDb();
    // memoryDb ne connaît pas landing_media : stub run/all inoffensif suffit —
    // on vérifie surtout le fichier écrit + le refus hors bornes/type.
    db.prepare = ((orig) => (sql) => {
      const s = String(sql);
      if (s.includes("landing_media")) {
        return { get: () => undefined, all: () => [], run: () => ({ changes: 1 }) };
      }
      return orig(sql);
    })(db.prepare.bind(db));

    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const up = await mount.handle({
      req: {
        method: "POST",
        path: "/api/v1/modules/landing/media",
        body: { filename: "logo.png", dataBase64: png.toString("base64") },
      },
      space: "module",
      mountId: "landing",
      subPath: "media",
      db,
    });
    assert.equal(up.status, 201);
    assert.match(up.body.url, /^\/lp-media\/[0-9a-f-]+\.png$/);
    const stored = path.join(tmp, up.body.file);
    assert.ok(fs.existsSync(stored));

    // Type refusé.
    const bad = await mount.handle({
      req: {
        method: "POST",
        path: "/api/v1/modules/landing/media",
        body: { filename: "script.sh", dataBase64: png.toString("base64") },
      },
      space: "module",
      mountId: "landing",
      subPath: "media",
      db,
    });
    assert.equal(bad.status, 400);

    // Service binaire (route Next thin) + anti-traversée.
    const { createLandingMediaGET } = await import(
      "../packages/landing/dist/index.js"
    );
    const GET = createLandingMediaGET({ mediaDir: tmp });
    const res = await GET(null, { params: { file: up.body.file } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    // Traversée neutralisée (basename) → jamais servi.
    const evil = await GET(null, { params: { file: "../../etc/passwd" } });
    assert.ok(evil.status === 400 || evil.status === 404);
    const evil2 = await GET(null, { params: { file: "a/../b.png" } });
    assert.ok(evil2.status === 400 || evil2.status === 404);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Tunnel CF (platform-core) — mode brand-web
// ---------------------------------------------------------------------------

test("landing.tunnel — slug lp réservé aux marques (kind brand-web)", () => {
  assert.ok(BRAND_WEB_SLUGS.has("lp"));
  // admin.{zone} = app OS admin de marque (ADR-admin-app-os) — brand-web aussi.
  assert.ok(BRAND_WEB_SLUGS.has("admin"));
  // Un serveur client ne peut pas voler lp ni admin.
  assert.equal(slugCheckLocal("lp").available, false);
  assert.equal(slugCheckLocal("admin").available, false);
  // La marque peut les réserver explicitement.
  assert.equal(slugCheckLocal("lp", { kind: "brand-web" }).available, true);
  assert.equal(slugCheckLocal("admin", { kind: "brand-web" }).available, true);
  // brand-web n'ouvre pas les autres slugs réservés.
  assert.equal(slugCheckLocal("www", { kind: "brand-web" }).available, false);
});

test("landing.tunnel — ingress brand-web = un seul service + 404", () => {
  const ports = { crmPort: 18801, n8nPort: 15678, hermesPort: 18797 };
  const rules = buildTunnelIngressRules("lp.example.test", ports, {
    embeds: false,
  });
  assert.equal(rules.length, 2);
  assert.equal(rules[0].hostname, "lp.example.test");
  assert.equal(rules[0].service, "http://127.0.0.1:18801");
  assert.deepEqual(rules[1], { service: "http_status:404" });
  // Rétrocompat : sans opts, comportement serveur complet inchangé.
  const full = buildTunnelIngressRules("resto.example.test", ports);
  assert.equal(full.length, 4);
  const urls = tunnelPublicUrls("lp.example.test", { embeds: false });
  assert.deepEqual(Object.keys(urls), ["crm"]);
});

test("landing.tunnel — mode flat aplatit embeds + DNS sans wildcard", async () => {
  const {
    buildTunnelIngressRules: buildRules,
    tunnelPublicUrls: buildUrls,
    tunnelDnsRecordSpecs: dnsRecordSpecs,
    tunnelDeprovisionDnsHosts: deprovisionDnsHosts,
    slugCheckLocal: checkSlug,
  } = await import("../packages/platform-core/dist/tunnel-cf.js");
  const { resolveTunnelHostMode, tunnelServiceHostname: serviceHostname } =
    await import("../packages/platform-core/dist/tunnel-urls.js");
  assert.equal(resolveTunnelHostMode("flat"), "flat");
  assert.equal(resolveTunnelHostMode("nested"), "nested");
  assert.equal(
    serviceHostname("resto.winhub.fr", "n8n", "flat"),
    "n8n-resto.winhub.fr",
  );
  assert.equal(
    serviceHostname("resto.winhub.fr", "agent", "flat"),
    "agent-resto.winhub.fr",
  );
  const ports = { crmPort: 18791, n8nPort: 15678, hermesPort: 18797 };
  const rules = buildRules("resto.winhub.fr", ports, {
    hostMode: "flat",
  });
  assert.equal(rules[1].hostname, "n8n-resto.winhub.fr");
  assert.equal(rules[2].hostname, "hermes-resto.winhub.fr");
  assert.ok(
    !rules.some((r) => String(r.hostname || "").startsWith("agent")),
    "ingress instance : aucune règle agent",
  );
  const pub = buildUrls("resto.winhub.fr", { hostMode: "flat" });
  assert.equal(pub.n8n, "https://n8n-resto.winhub.fr");
  const dns = dnsRecordSpecs("resto", "resto.winhub.fr", "winhub.fr", {
    hostMode: "flat",
  });
  assert.equal(dns.hostMode, "flat");
  assert.ok(dns.records.every((r) => !String(r.name).startsWith("*.")));
  assert.ok(dns.records.some((r) => r.qName === "n8n-resto.winhub.fr"));
  const nestedDns = dnsRecordSpecs(
    "resto",
    "resto.tempoflow.fr",
    "tempoflow.fr",
    { hostMode: "nested" },
  );
  assert.ok(nestedDns.records.some((r) => r.name === "*.resto"));
  assert.ok(
    deprovisionDnsHosts("resto", "resto.winhub.fr", "winhub.fr").includes(
      "n8n-resto.winhub.fr",
    ),
  );
  assert.equal(checkSlug("n8n-resto", { hostMode: "flat" }).available, false);
  assert.equal(checkSlug("n8n-resto", { hostMode: "nested" }).available, true);
});

// ---------------------------------------------------------------------------
// 3. Factory — toute app admin neuve naît avec le module
// ---------------------------------------------------------------------------

test("landing.factory — câblage repo admin (migrations, mount, pages, middleware)", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/admin-repo.ts"),
    "utf8",
  );
  assert.match(src, /landingMigrations\(/);
  assert.match(src, /defaultLandingSeed\(/);
  // P4 permissions admin : le mount landing du repo admin est gardé par la
  // permission module (édition seulement — GET /public reste anonyme).
  assert.match(
    src,
    /createLandingMount\(\{ permission: ADMIN_MODULE_PERMISSIONS\.landing \}\)/,
    "admin : mount landing gardé par la permission module (nav.landing)",
  );
  assert.match(src, /ui\/app\/landing\/page\.tsx/);
  assert.match(src, /ui\/app\/lp\/page\.tsx/);
  assert.match(src, /ui\/app\/lp-media\/\[file\]\/route\.ts/);
  assert.match(src, /"@creezio\/landing": "\$\{creezioSpec\}"/);
  assert.match(
    src,
    /renderUiAuthMiddleware\(model\.brandId\)/,
    "admin : middleware unique (session JWT + rewrite lp.) — pas le stub landing-only",
  );
  const mwGen = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/generators/os-ui.ts"),
    "utf8",
  );
  assert.match(
    mwGen,
    /host\.startsWith\("lp\."\)/,
    "générateur middleware : rewrite lp.{zone}",
  );
  assert.match(mwGen, /jwtVerify/, "générateur middleware : garde session");
  // Nav : la page landing est déclarée dans le ProductModel admin.
  assert.match(src, /path: "\/landing", title: "Landing page"/);
});

test("landing.proxy — x-forwarded-host propagé au plane UI (routage lp.)", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/listen-brand-os-http.ts"),
    "utf8",
  );
  assert.match(src, /x-forwarded-host/);
});
