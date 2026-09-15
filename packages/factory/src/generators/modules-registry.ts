/**
 * Socle registre de modules marque — SoT partagée entre scaffold factory
 * (`new-app` / `brand create` / `brand apply`) et `creezio brand module init`.
 * Aligné sur le standard kit DOC-STANDARD-MODULE.md / TempoFlow3.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  ProductEntity,
  ProductField,
  ProductModel,
  ProductPage,
} from "../product-model.js";
import { isChrModel } from "../product-model.js";

/**
 * Forme canonique du `modules/types.ts` d'une marque depuis H9 (P2.c) :
 * simple ré-export du contrat kit — le doctor brand-spec
 * (`MODULE_TYPES_DIVERGENT`) refuse fail-closed toute redéclaration locale.
 */
export const MODULES_TYPES_TS = `/**
 * creezio:owned-by-brand (ré-export — ne rien redéclarer ici)
 * Contrat du registre de modules — un module métier = un fichier
 * \`modules/<id>.ts\` exportant un \`BrandModuleDef\` (standard kit
 * DOC-STANDARD-MODULE.md). SoT du contrat : \`@creezio/app-runtime\`
 * (P2.c / H9) — une redéclaration locale = doctor MODULE_TYPES_DIVERGENT.
 */
export type {
  BrandMeiliIndex,
  BrandModuleDef,
  BrandNavItem,
} from "@creezio/app-runtime";
`;

export const MODULES_INDEX_TS = `/**
 * creezio:owned-by-brand
 * Registre des modules métier — une ligne d'import par module (périmètre
 * multi-agents : chaque agent ne touche que SA ligne + son fichier module).
 * Les consommateurs (brand-module-api, brand-migrations, vertical-slot,
 * meili-feed, brand-mcp-tools) agrègent via les collecteurs kit
 * (\`createBrandModuleRegistry\`, @creezio/app-runtime — P2.c / H9).
 */
import { createBrandModuleRegistry } from "@creezio/app-runtime";
import type { BrandModuleDef } from "./types.js";

// <creezio:module-imports> (une ligne par module — insertion \`brand module init\`)
// </creezio:module-imports>

export const BRAND_MODULES: BrandModuleDef[] = [
  // <creezio:module-registry>
  // </creezio:module-registry>
];

/**
 * Collecteurs du registre — délégation aux collecteurs génériques kit
 * (collectDemoScenarios inclut validation + dédup par id, \`os-tour\`
 * partagé : premier gagne ; collectAssistantSources / collectOnboardingContent
 * = volet 2 F3.4 ; collectNavPermissions / collectPermissionGroups = D8).
 */
export const {
  collectEntitySpecs,
  collectApiMounts,
  collectNavItems,
  collectMcpTools,
  collectMeiliIndexes,
  collectModuleMigrations,
  collectDemoScenarios,
  collectAssistantSources,
  collectOnboardingContent,
  collectNavPermissions,
  collectPermissionGroups,
} = createBrandModuleRegistry(BRAND_MODULES);
`;

export function camelizeModuleId(id: string): string {
  return id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, i) =>
      i === 0 ? part.toLowerCase() : part[0]!.toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("");
}

/** id fichier/module : underscores → tirets (contrat brand module init). */
export function entityToModuleId(entityId: string): string {
  return entityId.replace(/_/g, "-");
}

export function insertAfterMarker(
  filePath: string,
  closeMarker: string,
  line: string,
): void {
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.includes(line.trim())) return;
  const idx = raw.indexOf(closeMarker);
  if (idx < 0) {
    throw new Error(`marqueur ${closeMarker} introuvable dans ${filePath}`);
  }
  const lineStart = raw.lastIndexOf("\n", idx) + 1;
  const indent = raw.slice(lineStart, idx);
  fs.writeFileSync(
    filePath,
    raw.slice(0, lineStart) + indent + line + "\n" + indent + raw.slice(idx),
    "utf8",
  );
}

/** Pose types.ts + index.ts vides (marqueurs prêts pour brand module init). */
export function ensureModulesRegistry(
  modulesDir: string,
  force: boolean,
  write: (filePath: string, body: string) => void,
): void {
  fs.mkdirSync(modulesDir, { recursive: true });
  const typesPath = path.join(modulesDir, "types.ts");
  const indexPath = path.join(modulesDir, "index.ts");
  if (force || !fs.existsSync(typesPath)) write(typesPath, MODULES_TYPES_TS);
  if (force || !fs.existsSync(indexPath)) write(indexPath, MODULES_INDEX_TS);
}

export function registerModuleInIndex(
  indexPath: string,
  moduleId: string,
): void {
  const camel = camelizeModuleId(moduleId);
  insertAfterMarker(
    indexPath,
    "// </creezio:module-imports>",
    `import { ${camel}Module } from "./${moduleId}.js";`,
  );
  insertAfterMarker(
    indexPath,
    "// </creezio:module-registry>",
    `${camel}Module,`,
  );
}

/**
 * Runner d'auto-découverte des gates colocalisées
 * (`<spec-root>/modules/<id>/gate.mjs` — DOC-STANDARD-MODULE.md).
 * Écrit dans `server/scripts/run-module-gates.mjs` : un module sans gate
 * fait échouer `npm test` — aucun module n'entre sans filet.
 */
export function renderModuleGatesRunner(): string {
  return `#!/usr/bin/env node
/**
 * Runner des gates de module colocalisées (convention kit
 * DOC-STANDARD-MODULE : \`<spec-root>/modules/<id>/gate.mjs\`).
 * Généré par la factory Creezio — générique, ne pas spécialiser.
 *
 * \`--only <regex>\` pour cibler, \`--keep-going\` pour l'inventaire complet.
 * Un module SANS gate.mjs = échec (aucun module ne rentre sans filet).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.resolve(serverRoot, "..");
const modulesDir = ["brand-spec", "admin-spec"]
  .map((d) => path.join(appRoot, d, "modules"))
  .find((d) => fs.existsSync(d));

if (!modulesDir) {
  console.error("aucun <spec-root>/modules trouvé (brand-spec/ ou admin-spec/)");
  process.exit(1);
}

const args = process.argv.slice(2);
const keepGoing = args.includes("--keep-going");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? new RegExp(args[onlyIdx + 1] ?? "") : null;

const moduleIds = fs
  .readdirSync(modulesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "_template")
  .map((e) => e.name)
  .sort();

const missing = moduleIds.filter(
  (id) => !fs.existsSync(path.join(modulesDir, id, "gate.mjs")),
);
if (missing.length) {
  console.error(
    \`✗ modules SANS gate.mjs (DOC-STANDARD-MODULE): \${missing.join(", ")}\`,
  );
  process.exit(1);
}

const selected = only ? moduleIds.filter((id) => only.test(id)) : moduleIds;

function runGate(id) {
  return new Promise((resolve) => {
    const started = Date.now();
    process.stdout.write(\`▶ \${id}\\n\`);
    const child = spawn(
      process.execPath,
      [path.join(modulesDir, id, "gate.mjs")],
      {
        cwd: serverRoot,
        env: { ...process.env, CREEZIO_APP_ROOT: appRoot },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      const secs = Math.round((Date.now() - started) / 1000);
      if (code === 0) {
        process.stdout.write(\`✓ OK (\${secs}s) \${id}\\n\`);
        resolve({ id, ok: true, secs });
      } else {
        process.stdout.write(\`✗ FAIL (\${secs}s) \${id}\\n\${out.slice(-8000)}\\n\`);
        resolve({ id, ok: false, secs });
      }
    });
  });
}

const results = [];
for (const id of selected) {
  const res = await runGate(id);
  results.push(res);
  if (!res.ok && !keepGoing) break;
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(
    \`✗ \${failed.length}/\${results.length} gate(s) module rouges: \${failed.map((r) => r.id).join(", ")}\`,
  );
  process.exit(1);
}
console.log(
  \`OK run-module-gates — \${results.length} modules verts (\${selected.join(", ")})\`,
);
`;
}

/**
 * Branche le runner de gates colocalisées dans package.json serveur :
 * scripts `test:modules` (tous) + `test:module` (--only) et présence dans
 * la chaîne `test`. Écrit `scripts/run-module-gates.mjs` s'il manque.
 */
export function wireModuleGateInPackageJson(
  serverDir: string,
  _moduleId?: string,
): boolean {
  const runnerPath = path.join(serverDir, "scripts", "run-module-gates.mjs");
  if (!fs.existsSync(runnerPath)) {
    fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
    fs.writeFileSync(runnerPath, renderModuleGatesRunner(), "utf8");
  }
  const pkgPath = path.join(serverDir, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  pkg.scripts = pkg.scripts ?? {};
  const before = JSON.stringify(pkg.scripts);
  pkg.scripts["test:modules"] = "node scripts/run-module-gates.mjs";
  pkg.scripts["test:module"] ??= "node scripts/run-module-gates.mjs --only";
  const testScript = pkg.scripts.test || 'echo "no tests"';
  if (!testScript.includes("test:modules")) {
    pkg.scripts.test =
      testScript === 'echo "no tests"'
        ? "npm run test:modules"
        : `${testScript} && npm run test:modules`;
  }
  if (JSON.stringify(pkg.scripts) === before) return false;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return true;
}

function renderEntityColumnSpec(
  f: ProductField,
  opts: { enumRef?: string },
): string {
  const parts = [`name: ${JSON.stringify(f.name)}`];
  if (f.required) parts.push("required: true");
  if (f.type === "number") parts.push(`type: "number"`);
  else if (f.type === "boolean") parts.push(`type: "boolean"`);
  else if (f.type === "date") parts.push(`type: "date"`);
  if (opts.enumRef) parts.push(`enum: ${opts.enumRef}`);
  if (f.type === "text") parts.push("searchable: true");
  if (f.type === "ref" || f.type === "boolean") parts.push("filterable: true");
  return `      { ${parts.join(", ")} },`;
}

function pageForEntity(
  model: ProductModel,
  entityId: string,
): ProductPage | undefined {
  return model.pages.find((p) => p.entityId === entityId || p.id === entityId);
}

/** Champ `demo` jouable (OS tour + scénario module) — factory + `brand module init`. */
export function renderPlayableDemoBlock(opts: {
  moduleId: string;
  title: string;
  productName: string;
  navLabel?: string;
}): string {
  const nav = opts.navLabel || opts.title;
  return `  demo: {
    scenarios: [
      genericOsTourScenario({ productName: ${JSON.stringify(opts.productName)} }),
      {
        id: ${JSON.stringify(`${opts.moduleId}-tour`)},
        title: ${JSON.stringify(`Découvrir ${opts.title}`)},
        description: ${JSON.stringify(`Visite guidée de ${opts.title}.`)},
        enabled: true,
        steps: [
          {
            id: "welcome",
            kind: "say",
            title: ${JSON.stringify(opts.title)},
            body: ${JSON.stringify(
              `Cette section couvre ${opts.title}. Suivez le curseur ou quittez à tout moment.`,
            )},
          },
          {
            id: "nav",
            kind: "highlight",
            target: { text: ${JSON.stringify(nav)} },
            title: ${JSON.stringify(opts.title)},
            body: "Ouvrez cette entrée depuis la navigation.",
            optional: true,
          },
        ],
      },
    ],
  },`;
}

/** Descripteurs assistant + étape onboarding — factory / `brand module init`. */
export function renderAssistantAndOnboardingBlocks(opts: {
  moduleId: string;
  title: string;
  entityId?: string;
  navHref?: string;
  titleField?: string;
}): string {
  const href = opts.navHref || `/${opts.moduleId}`;
  const entityKind = opts.entityId || opts.moduleId;
  const titleField = opts.titleField || "nom";
  return `  assistantSources: [
    {
      kind: "entity",
      entityKind: ${JSON.stringify(entityKind)},
      titleFields: [${JSON.stringify(titleField)}],
      type: ${JSON.stringify(entityKind)},
      urlWhenId: ${JSON.stringify(`${href}/{id}`)},
      urlWhenSearch: ${JSON.stringify(`${href}?q={q}`)},
    },
    {
      kind: "context",
      id: ${JSON.stringify(`${opts.moduleId}-overview`)},
      title: ${JSON.stringify(opts.title)},
      body: ${JSON.stringify(
        `Module ${opts.title} — entité ${entityKind}.`,
      )},
    },
  ],
  onboarding: {
    steps: [
      {
        id: ${JSON.stringify(opts.moduleId)},
        label: ${JSON.stringify(opts.title)},
        interstitialTitle: ${JSON.stringify(opts.title)},
        interstitialTagline: ${JSON.stringify(`Découvrir ${opts.title}.`)},
      },
    ],
  },`;
}

/** Un wiring module a ≥ 1 scénario jouable (pas un commentaire). */
export function moduleWiringHasDemoScenarios(src: string): boolean {
  if (!/\bdemo\s*:/.test(src) || !/\bscenarios\s*:/.test(src)) return false;
  return (
    /genericOsTourScenario\s*\(/.test(src) ||
    /kind\s*:\s*["'](?:say|navigate|highlight|click|type|scroll|wait)/.test(src)
  );
}

function renderEntityHooksAndExtras(
  model: ProductModel,
  entity: ProductEntity,
): { preamble: string; hooks: string[]; extraRoutes: boolean } {
  const chr = isChrModel(model);
  const hasField = (name: string) =>
    entity.fields.some((f) => f.name === name);
  const hooks: string[] = [];
  let preamble = "";
  let extraRoutes = false;

  if (entity.id === "prix" && hasField("montant")) {
    preamble += `
/** POST prix — coercions montant/promo/devise. */
function prixBeforeCreate(row: Record<string, unknown>): void {
  row.montant = Number(row.montant);
  row.promo = row.promo ? 1 : 0;
  row.devise = row.devise || "EUR";
}
`;
    hooks.push("beforeCreate: prixBeforeCreate");
  }

  if (
    entity.id === "panier_lignes" &&
    hasField("quantite") &&
    model.entities.some((e) => e.id === "prix")
  ) {
    preamble += `
/** POST panier — quantité numérique + dernier prix connu par défaut. */
function panierLigneBeforeCreate(
  row: Record<string, unknown>,
  { db }: EntityHookContext,
): void {
  row.quantite = Number(row.quantite);
  if (row.prix_unitaire == null) {
    const prices = db
      .prepare(
        \`SELECT montant FROM prix WHERE produit_id = ? AND fournisseur_id = ? ORDER BY created_at DESC LIMIT 1\`,
      )
      .get(row.produit_id, row.fournisseur_id) as
      | { montant: number }
      | undefined;
    if (prices) row.prix_unitaire = Number(prices.montant);
  } else {
    row.prix_unitaire = Number(row.prix_unitaire);
  }
}
`;
    hooks.push("beforeCreate: panierLigneBeforeCreate");
  }

  if (entity.id === "panier_lignes") {
    preamble += `
/** GET panier — items + total HT + ventilation par fournisseur. */
function panierAfterList(rows: Array<Record<string, unknown>>): unknown {
  let total = 0;
  const by = new Map<
    string,
    { fournisseur_id: string; lignes: number; total_ht: number }
  >();
  for (const l of rows) {
    const line = Number(l.quantite || 0) * Number(l.prix_unitaire || 0);
    total += line;
    const fid = String(l.fournisseur_id || "unknown");
    const cur = by.get(fid) || {
      fournisseur_id: fid,
      lignes: 0,
      total_ht: 0,
    };
    cur.lignes += 1;
    cur.total_ht += line;
    by.set(fid, cur);
  }
  return {
    items: rows,
    total_ht: total,
    by_fournisseur: [...by.values()],
  };
}
`;
    hooks.push("afterList: panierAfterList");
  }

  if (chr && entity.id === "commandes") {
    extraRoutes = true;
    preamble += `
function now() {
  return new Date().toISOString();
}

/** Routes métier commandes hors CRUD : from-panier. */
const commandesExtraRoutes: ApiMount["handle"] = async ({
  req,
  subPath,
  db,
}) => {
  if (!db) return { status: 503, body: { error: "db_unavailable" } };
  const method = req.method.toUpperCase();
  const parts = subPath.split("/").filter(Boolean);

  if (parts[0] === "from-panier" && method === "POST") {
    const body = (req.body || {}) as { fournisseur_id?: string; notes?: string };
    const lignes = db
      .prepare(\`SELECT * FROM panier_lignes\`)
      .all() as Array<Record<string, unknown>>;
    if (!lignes.length) return { status: 400, body: { error: "panier_vide" } };
    const fournisseurId =
      body.fournisseur_id || String(lignes[0]!.fournisseur_id);
    const related = lignes.filter((l) => l.fournisseur_id === fournisseurId);
    if (!related.length) {
      return { status: 400, body: { error: "aucune_ligne_fournisseur" } };
    }
    const total = related.reduce(
      (s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0),
      0,
    );
    const id = randomUUID();
    const created = now();
    db.prepare(
      \`INSERT INTO commandes (id, created_at, updated_at, fournisseur_id, statut, total_ht, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)\`,
    ).run(
      id,
      created,
      created,
      fournisseurId,
      "brouillon",
      total,
      body.notes || "",
    );
    db.prepare(\`DELETE FROM panier_lignes WHERE fournisseur_id = ?\`).run(
      fournisseurId,
    );
    return {
      status: 201,
      body: {
        id,
        created_at: created,
        updated_at: created,
        fournisseur_id: fournisseurId,
        statut: "brouillon",
        total_ht: total,
        notes: body.notes || "",
        lignes: related,
      },
    };
  }

  return { status: 404, body: { error: "not_found", subPath } };
};
`;
  }

  return { preamble, hooks, extraRoutes };
}

export function renderEntityModuleTs(
  model: ProductModel,
  entity: ProductEntity,
  order: number,
): { moduleId: string; body: string } {
  const moduleId = entityToModuleId(entity.id);
  const camel = camelizeModuleId(moduleId);
  const page = pageForEntity(model, entity.id);
  const chr = isChrModel(model);
  const commandesEnum = chr && entity.id === "commandes" &&
    entity.fields.some((f) => f.name === "statut");
  const { preamble, hooks, extraRoutes } = renderEntityHooksAndExtras(
    model,
    entity,
  );

  const needsHookCtx = preamble.includes("EntityHookContext");
  const needsApiMount = extraRoutes;
  const needsUuid = extraRoutes;

  const typeImports = [
    ...(needsApiMount ? ["ApiMount"] : []),
    ...(needsHookCtx ? ["EntityHookContext"] : []),
    "EntitySpec",
  ];
  const importLines = [
    needsUuid ? `import { randomUUID } from "node:crypto";` : "",
    `import type {\n${typeImports.map((t) => `  ${t},`).join("\n")}\n} from "@creezio/api-kernel";`,
    `import { genericOsTourScenario } from "@creezio/interactive-demo";`,
    `import type { BrandModuleDef } from "./types.js";`,
  ]
    .filter(Boolean)
    .join("\n");

  const enumLine = commandesEnum
    ? `const COMMANDE_STATUTS = ["brouillon", "envoyee", "recue"] as const;\n`
    : "";

  const columns = entity.fields
    .map((f) =>
      renderEntityColumnSpec(f, {
        enumRef:
          commandesEnum && f.name === "statut" ? "COMMANDE_STATUTS" : undefined,
      }),
    )
    .join("\n");

  const specLines = [
    `  ${JSON.stringify(entity.id)}: {`,
    `    table: ${JSON.stringify(entity.id)},`,
  ];
  if (entity.permission) {
    // Permission par module (apps admin) : garde authorizeModuleAccess sur
    // le mount CRUD généré + filtrage sidebar (navItems ci-dessous).
    specLines.push(`    permission: ${JSON.stringify(entity.permission)},`);
  }
  if (entity.archivable) specLines.push(`    archivable: true,`);
  specLines.push(`    columns: [`, columns, `    ],`);
  if (hooks.length) {
    specLines.push(`    hooks: { ${hooks.join(", ")} },`);
  }
  if (extraRoutes) {
    specLines.push(`    extraRoutes: commandesExtraRoutes,`);
    specLines.push(`    operations: [`);
    specLines.push(`      {`);
    specLines.push(`        id: "from-panier",`);
    specLines.push(`        method: "POST",`);
    specLines.push(`        path: "/from-panier",`);
    specLines.push(`        description: "Créer une commande depuis le panier",`);
    specLines.push(`      },`);
    specLines.push(`    ],`);
  }
  specLines.push(`  },`);

  const navHref = page?.path || `/${moduleId}`;
  const navLabel = page?.title || entity.labelPlural || entity.label;
  const meiliOrHors = renderMeiliOrHorsIndexBlock(entity.id);

  return {
    moduleId,
    body: `/**
 * creezio:owned-by-brand
 * Module ${moduleId} — entité \`${entity.id}\` (généré factory / ProductModel).
 * Spec : brand-spec/modules/${moduleId}/ (prd + interview + TODO + CHANGELOG).
 */
${importLines}

${enumLine}${preamble}
const ENTITY_SPECS: Record<string, EntitySpec> = {
${specLines.join("\n")}
};

export const ${camel}Module: BrandModuleDef = {
  id: ${JSON.stringify(moduleId)},
  entitySpecs: ENTITY_SPECS,
  navItems: [
    {
      id: ${JSON.stringify(`brand.${page?.id || moduleId}`)},
      label: ${JSON.stringify(navLabel)},
      href: ${JSON.stringify(navHref)},
      group: "brand",
      order: ${order},
      permission: ${JSON.stringify(entity.permission || `nav.${moduleId}`)},
    },
  ],
${renderPlayableDemoBlock({
    moduleId,
    title: navLabel,
    productName: model.brandName,
    navLabel,
  })}
${meiliOrHors}
${renderAssistantAndOnboardingBlocks({
    moduleId,
    title: navLabel,
    entityId: entity.id,
    navHref,
    titleField:
      entity.fields.find((f) => f.type === "text")?.name ||
      entity.fields[0]?.name ||
      "nom",
  })}
};
`,
  };
}

const CATALOG_BROWSE_IDS = new Set([
  "produits",
  "produit",
  "articles",
  "article",
  "products",
  "product",
  "catalog",
  "fournisseurs",
  "fournisseur",
  "sites",
  "site",
]);

const HORS_INDEX_REASONS: Record<string, string> = {
  commandes: "écritures + joins commande — hors index catalogue",
  panier: "écritures panier — hors index catalogue",
  panier_lignes: "écritures panier — hors index catalogue",
  prix: "bornes prix / relevés — hors index",
  releves: "relevés de prix — hors index",
  promotions: "pas d'index Meili dédié",
  stack: "besoins restaurant — hors index",
  likes: "préférences utilisateur — hors index",
};

/** Liste catalogue → meiliIndexes ; sinon justification hors-index. */
export function renderMeiliOrHorsIndexBlock(entityId: string): string {
  if (CATALOG_BROWSE_IDS.has(entityId)) {
    const sites = /fourn|sites?$/.test(entityId);
    const uid = sites ? "catalog_sites" : "catalog_products";
    const countKey = sites ? "sites" : "produits";
    return `  meiliIndexes: [
    {
      uid: ${JSON.stringify(uid)},
      countKey: ${JSON.stringify(countKey)},
      table: ${JSON.stringify(entityId)},
      columns: ["id", "nom"],
      settings: {
        searchableAttributes: ["nom"],
        filterableAttributes: ["id"],
        pagination: { maxTotalHits: 100000 },
      },
    },
  ],`;
  }
  const reason =
    HORS_INDEX_REASONS[entityId] ||
    "liste hors catalogue (pas de browse Meili)";
  return `  horsIndexJustification: ${JSON.stringify(reason)},`;
}

/**
 * Écrit le registre + un module par entité ProductModel, branchés dans index.ts.
 * `write` doit respecter owned-by-brand (typiquement writeAppFile wrapper).
 */
export function writeProductModelModules(
  serverDir: string,
  model: ProductModel,
  force: boolean,
  write: (filePath: string, body: string) => void,
): string[] {
  const modulesDir = path.join(serverDir, "src/electron/modules");
  ensureModulesRegistry(modulesDir, force, write);

  const indexPath = path.join(modulesDir, "index.ts");
  // Repose un index vide (marqueurs) puis réinsère — évite doublons au re-scaffold.
  write(indexPath, MODULES_INDEX_TS);

  const moduleIds: string[] = [];
  model.entities.forEach((entity, i) => {
    const { moduleId, body } = renderEntityModuleTs(
      model,
      entity,
      100 + i * 10,
    );
    moduleIds.push(moduleId);
    write(path.join(modulesDir, `${moduleId}.ts`), body);
  });

  for (const moduleId of moduleIds) {
    // registerModuleInIndex lit/écrit directement (après write du squelette).
    if (fs.existsSync(indexPath)) {
      registerModuleInIndex(indexPath, moduleId);
    }
  }

  return moduleIds;
}

/**
 * Stub gate structurel COLOCALISÉ (même contrat que \`brand module init\`) :
 * écrit dans \`<spec-root>/modules/<id>/gate.mjs\`, découvert par
 * \`scripts/run-module-gates.mjs\` (DOC-STANDARD-MODULE.md — 5ᵉ fichier).
 */
export function renderModuleGateStub(
  id: string,
  specRootName = "brand-spec",
): string {
  return `#!/usr/bin/env node
/**
 * Gate module ${id} — stub scaffoldé par la factory / \`brand module init\`.
 * Colocalisée dans ${specRootName}/modules/${id}/ (5ᵉ fichier obligatoire,
 * découverte par scripts/run-module-gates.mjs).
 * Vérifie le contrat structurel (spec 5 fichiers + wiring + registre).
 * À enrichir : boot harness + CRUD HTTP + hooks + tools MCP (voir
 * DOC-STANDARD-MODULE.md §9).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const specDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(specDir, "../../..");
const maybeServer = path.join(appDir, "server");
const serverDir = fs.existsSync(path.join(maybeServer, "package.json"))
  ? maybeServer
  : appDir;
const errors = [];

for (const f of ["prd.md", "interview.md", "TODO.md", "CHANGELOG.md", "gate.mjs"]) {
  if (!fs.existsSync(path.join(specDir, f))) errors.push(\`spec manquant: \${f}\`);
}

const wiring = path.join(serverDir, "src/electron/modules/${id}.ts");
if (!fs.existsSync(wiring)) {
  errors.push("wiring manquant: src/electron/modules/${id}.ts");
} else if (!fs.readFileSync(wiring, "utf8").includes("BrandModuleDef")) {
  errors.push("wiring sans BrandModuleDef");
}

const registry = path.join(serverDir, "src/electron/modules/index.ts");
if (!fs.existsSync(registry) || !fs.readFileSync(registry, "utf8").includes("./${id}.js")) {
  errors.push("module absent du registre modules/index.ts");
}

const api = path.join(serverDir, "src/electron/brand-module-api.ts");
if (fs.existsSync(api) && !fs.readFileSync(api, "utf8").includes("collectEntitySpecs")) {
  errors.push("brand-module-api ne consomme pas collectEntitySpecs (registre)");
}

if (fs.existsSync(wiring)) {
  const wiringSrc = fs.readFileSync(wiring, "utf8");
  if (!/\\bdemo\\s*:/.test(wiringSrc) || !/\\bscenarios\\s*:/.test(wiringSrc)) {
    errors.push("demo.scenarios obligatoire (≥ 1 scénario jouable)");
  } else if (
    !/genericOsTourScenario\\s*\\(/.test(wiringSrc) &&
    !/kind\\s*:\\s*["'](?:say|navigate|highlight|click|type|scroll|wait)/.test(wiringSrc)
  ) {
    errors.push("demo.scenarios sans scénario jouable (genericOsTourScenario ou steps)");
  }
}

const mig = path.join(serverDir, "src/electron/brand-migrations.ts");
if (fs.existsSync(mig) && !fs.readFileSync(mig, "utf8").includes("collectModuleMigrations")) {
  errors.push("brand-migrations ne consomme pas collectModuleMigrations (registre)");
}

if (errors.length) {
  console.error(\`✗ gate ${id}:\\n\` + errors.map((e) => \`  - \${e}\`).join("\\n"));
  process.exit(1);
}
console.log("OK gate ${id} (structurel — enrichir avec des preuves HTTP)");
`;
}

/** AGENTS.md marque — documente le standard modules (réf. kit). */
export function renderBrandAgentsMd(productName: string): string {
  return `# AGENTS — ${productName}

Marque légère sur **OS Creezio** — monorepo client + server (layout 2 repos).

- \`server/\` = livrable principal : métier (\`src/electron/brand-*\`), UI Next,
  harness, tests — \`startBrandDesktop\` (@creezio/app-runtime)
- \`client/\` = desktop thin remote-only (main **sans** imports métier)
- Admin flotte = **repo dédié privé** \`<brand>-admin\` (frère du monorepo) —
  jamais de \`admin/\` ici
- Kit \`@creezio/*\` = **packages npm versionnés** (npmjs.org, org creezio — aucun token) — plus de \`vendor/\` ni symlinks
- Déclaration = migrations + \`registerModuleApi\` + feed + nav **métier**
- Métier = **registre de modules** \`server/src/electron/modules/<id>.ts\`
  (un \`BrandModuleDef\` par module : entitySpecs, apiMounts + operations[],
  navItems, meiliIndexes, assistantSources, onboarding, demo, migrations) + specs 5 fichiers
  \`brand-spec/modules/<id>/\` (prd, interview, TODO, CHANGELOG, gate.mjs —
  standard kit \`DOC-STANDARD-MODULE.md\`, runner \`npm run test:modules\`).
  \`brand-module-api.ts\` / \`brand-migrations.ts\` / \`vertical-slot.ts\` /
  \`brand-mcp-tools.ts\` / \`meili-feed.ts\` = consommateurs du registre
  (\`collectEntitySpecs\` / \`collectModuleMigrations\` / \`collectNavItems\`…).
  Scaffold : \`creezio brand module init <id> --app .\`
  Guide : \`$CREEZIO_KIT_ROOT/docs/agents/CREATE-MODULE.md\`
- API métier = \`/api/v1/modules/*\` (EntitySpec déclaratifs — guide kit
  \`$CREEZIO_KIT_ROOT/docs/agents/CREATE-MODULE.md\`)
- UI OS (\`/mails\`, \`/taches\`, \`/setup\`, \`/login\`, MCP, admin…) =
  **wrappers** \`@creezio/*/ui\` générés factory — **ne pas** réécrire ni marquer
  \`owned-by-brand\`
- **Interdit** : glue OS (\`src/lib/*\`, \`brand-runtime\`), sidecar JSON,
  fetch maison vers \`/api/v1/os/*\` dans \`ui/app\`

- Guide naissance : \`$CREEZIO_KIT_ROOT/docs/agents/CREATE-APP.md\`
- **Interdit** : \`creezio demo-app\`, module notes par défaut, \`server/crm/\`

## Secrets (jamais commités, jamais dumpés)

- Packages : \`@creezio/*\` publics sur npmjs.org (aucun token)
- VPS tunnel : \`CREEZIO_CF_API_TOKEN\` + \`_ACCOUNT_ID\` + \`_ZONE_ID\`
- VPS owner : \`CREEZIO_OWNER_EMAIL\` + \`CREEZIO_OWNER_PASSWORD\`
- Local : \`CREEZIO_TUNNEL_LOCAL=1\`

\`\`\`bash
npm test                      # racine — délègue server/
npm run metier:api
creezio brand doctor --spec brand-spec
creezio brand module init <id> --app .
CREEZIO_TUNNEL_LOCAL=1 npm run server-docker:create -- demo
\`\`\`
`;
}
