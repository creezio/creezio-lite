import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type InitBrandSpecOptions = {
  outDir: string;
  brandId: string;
  brandName: string;
  domain: string;
  tagline?: string;
  /** Vertical métier — champ libre (presets Meili résolus par la factory). */
  vertical?: string;
  force?: boolean;
  /**
   * Parcours produit `/onboarding`. Défaut `true` (marques réelles).
   * `false` pour apps sans étapes (post-setup → home).
   */
  onboardingEnabled?: boolean;
};

function kitTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/ → ../templates
  return path.resolve(here, "../templates");
}

function writeFile(filePath: string, body: string, force: boolean): boolean {
  if (fs.existsSync(filePath) && !force) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
  return true;
}

function copyTemplate(
  name: string,
  dest: string,
  force: boolean,
  vars: Record<string, string>,
): boolean {
  const src = path.join(kitTemplatesDir(), name);
  let body: string;
  if (fs.existsSync(src)) {
    body = fs.readFileSync(src, "utf8");
  } else {
    body = FALLBACK_TEMPLATES[name] || "";
  }
  for (const [k, v] of Object.entries(vars)) {
    body = body.split(`{{${k}}}`).join(v);
  }
  return writeFile(dest, body, force);
}

const FALLBACK_TEMPLATES: Record<string, string> = {
  "brand.yaml": `brandId: {{brandId}}
brandName: {{brandName}}
domain: {{domain}}
tagline: {{tagline}}
vertical: {{vertical}}
sandbox: true
# Gates de module colocalisées (modules/<id>/gate.mjs — DOC-STANDARD-MODULE) :
# exigé par la gate kit module-docs pour toute nouvelle marque.
moduleGates: colocated

platform:
  auth: true
  desktop: true
  pluginApi: true
  chat: true
  sync: false
  meili: true
  mcp: true
  onboarding: {{onboardingEnabled}}

meili:
  enabled: true
  feedPreset: {{meiliPreset}}

mcp:
  enabled: true
  allowUnauthenticated: true
  spaces:
    - module
    - plugin

onboarding:
  enabled: {{onboardingEnabled}}
  slugPlaceholder: mon-espace
  requireOpenaiKey: false
  afterCompleteHref: {{afterCompleteHref}}
`,
  "product.md": `# {{brandName}}

{{tagline}}

## Utilisateurs

- Opérateurs métier du domaine {{vertical}}

## Parcours cœur

1. Se connecter
2. Consulter / créer les entités métier
3. Enchaîner le flux principal

## Entités (à préciser via interview)

- (à remplir)

## Plateforme

Desktop Client + Serveur Creezio, recherche Meili optionnelle, MCP.
`,
  "AGENTS.md": `# AGENTS — BrandSpec {{brandId}}

## Mission agent créateur

Remplir ce dossier \`brand-spec/\` via l'interview produit, puis :

\`\`\`bash
creezio brand doctor --spec .
creezio brand apply --spec . --out ../
creezio brand smoke --app ../
\`\`\`

## Règles

1. Métier seulement ici — jamais de launcher OS / sidecar JSON.
2. Modules = \`modules/<id>/\` avec \`prd.md\` (+ schema/api/ui si besoin).
3. Runtime = \`@creezio/app-runtime\` (\`startBrandDesktop\`) — pas de jumeau.
4. Si un besoin OS manque → gap kit creezio, pas de copie dans la marque.

Voir \`docs/agents/CREATE-BRAND.md\` à la racine du kit.
`,
  "interview.schema.json": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "BrandInterview",
  "type": "object",
  "required": ["brandName", "domain", "tagline", "users", "entities", "flows"],
  "properties": {
    "brandName": { "type": "string", "minLength": 2 },
    "domain": { "type": "string", "minLength": 3 },
    "tagline": { "type": "string" },
    "vertical": { "type": "string" },
    "users": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1
    },
    "entities": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label"],
        "properties": {
          "id": { "type": "string" },
          "label": { "type": "string" },
          "fields": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "flows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label", "steps"],
        "properties": {
          "id": { "type": "string" },
          "label": { "type": "string" },
          "steps": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "platform": {
      "type": "object",
      "properties": {
        "meili": { "type": "boolean" },
        "mcp": { "type": "boolean" },
        "chat": { "type": "boolean" },
        "onboarding": { "type": "boolean" }
      }
    }
  }
}
`,
  "platform/onboarding.yaml": `enabled: {{onboardingEnabled}}
slugPlaceholder: mon-espace
requireOpenaiKey: false
afterCompleteHref: {{afterCompleteHref}}
stepLabels:
  - Compte
  - Récupération
  - Tunnel
  - OpenAI
`,
  "platform/meili.yaml": `enabled: true
feedPreset: {{meiliPreset}}
`,
  "platform/mcp.yaml": `enabled: true
allowUnauthenticated: true
spaces:
  - module
  - plugin
`,
  // Standard module (5 fichiers : 4 md + gate.mjs) — DOC-STANDARD-MODULE.md.
  "modules/_template/prd.md": `# Module {{moduleId}} — <titre>

## Vision

(à remplir — pourquoi ce module existe, pour qui)

## Utilisateurs & parcours

(à remplir)

## Capacités (fonctionnel)

(à remplir — liste des capacités observables)

## Modèle de données

(schémas complets : colonnes, types, contraintes, défauts — copie du SQL des
migrations)

## API

(ops déclarées : méthode, chemin, rôles — CRUD EntitySpec auto + extraRoutes
cataloguées ; codes d'erreur)

## UI

(pages + composants du kit graphique utilisés — voir DOC-STANDARD-UI.md ;
home = page réelle à \`/dashboard\`, jamais de page à \`/\` — conventions OS
de DOC-STANDARD-MODULE.md)

## Tools MCP

(générés depuis les ops \`module.<mountId>.<op.id>\` — « Aucun » sinon)

## Logique métier non triviale

(formules, scores, algorithmes décrits en clair — « Aucune » sinon)

## Seeds & données initiales

Aucun

## Cas limites & règles de gestion

(à remplir)

## Hors périmètre

(à remplir)
`,
  "modules/_template/interview.md": `# Interview module {{moduleId}}

Questionnaire d'architecture REMPLI — SoT des décisions du module
(standard kit docs/DOC-STANDARD-MODULE.md).

## Conventions OS non négociables

Une interview ne peut PAS contredire ces conventions dures du kit
(section « Conventions OS non négociables » de DOC-STANDARD-MODULE.md) :

- **Home = \`/dashboard\`** : la page d'accueil réelle de la marque vit à
  \`/dashboard\` (le workspace kit canonise tout href \`/\` → \`/dashboard\`).
  Ne JAMAIS spécifier « accueil à \`/\` ».
- **\`/\` = pure redirection factory** (\`app/page.tsx\`) — jamais de contenu.
- **Nav « accueil »** → \`href: "/dashboard"\`, jamais \`href: "/"\`.
- **Routes réservées OS** : ne pas revendiquer les routes matérialisées par
  \`@creezio/os-ui\` (\`/login\`, \`/setup\`, \`/onboarding\`, \`/taches\`,
  \`/mails\`, \`/parametres\`, \`/collaborateurs\`, \`/configuration\`,
  \`/support\`, \`/admin/*\`…) ni \`/site/*\` (onglets sites externes,
  fullscreen).

## 1. Identité & pages

- id : \`{{moduleId}}\`
- titre :
- routes UI : (jamais \`/\` — voir Conventions OS ci-dessus)
- entrée(s) de nav (id, label, href, order) :
- permission nav : (format \`nav.<slug>\` ; absente = visible par tous)

## 2. Données & migrations

- tables (schéma complet) :
- index :
- IDs de migration : \`mod_{{moduleId}}_00N_<slug>\` — jamais renuméroter une
  migration appliquée ; migrations cross-module interdites.

## 3. API

- EntitySpec \`createEntityApiMount\` (défaut CRUD = ops auto) ou mount
  manuscrit **avec \`operations[]\`** (1 capacité = 1 op, justifier) :
- hooks / extraRoutes (chaque extraRoutes = une op déclarée) :
- wiring : \`server/src/electron/modules/{{moduleId}}.ts\` (BrandModuleDef)
- démo interactive (**obligatoire**, ≥ 1 scénario valide) : champ
  \`demo: { scenarios: DemoScenario[] }\` du BrandModuleDef — scénarios du
  tour produit du module, agrégés par \`collectDemoScenarios()\` (registre)
  en défauts du mount \`interactive-demo\`. Inclure
  \`genericOsTourScenario({ productName })\` (id \`os-tour\` partagé).
  Une app Creezio sans démo interactive est invalide :

## 4. UI, nav & permissions — kit graphique imposé

Pour CHAQUE page : composants du kit utilisés (voir DOC-STANDARD-UI.md).
Pas de style ad hoc, pas de lib UI tierce, pas de fork des primitives.

### Page /{{moduleId}}

- gabarit :
- liste :
- formulaires :

## 5. Tools MCP & policies

- ops du module → tools générés \`module.<mountId>.<op.id>\` (rôles,
  mcpPublishDefault). \`mcpTools\` n'existe plus. SoT = \`operations[]\`.

## 6. Rôles & permissions

## 7. Meili / n8n / plugins

Aucun

## 8. Seeds & onboarding

Aucun

## 9. Gates de validation

- gate : \`modules/{{moduleId}}/gate.mjs\` (colocalisée, découverte par
  \`scripts/run-module-gates.mjs\`) — prouve : migration appliquée,
  CRUD HTTP, cas métier des hooks, tools MCP répondants.

## 10. i18n

- libellés UI en français (convention marque)
`,
  "modules/_template/TODO.md": `# TODO — {{moduleId}}

Format normé (parsé par la gate module-docs) :
\`### [todo|in-progress|blocked|done] <ID> — titre\`.
Claim : passage \`[todo]\` → \`[in-progress]\` + ligne
\`- claim: <agent> <YYYY-MM-DD>\` dans le même commit que la première modif.

## Milestone M1 — squelette

### [todo] {{moduleTodoPrefix}}-1 — Implémenter le module
- priorite: P1
- depends: aucune
- fichiers: server/src/electron/modules/{{moduleId}}.ts, modules/{{moduleId}}/gate.mjs
- criteres:
  - [ ] migration appliquée
  - [ ] gate modules/{{moduleId}}/gate.mjs verte (npm run test:module -- {{moduleId}})
`,
  "modules/_template/CHANGELOG.md": `# CHANGELOG — {{moduleId}}

Une entrée datée par livraison (merge sur main), la plus récente en haut.
Format : \`## YYYY-MM-DD — <ID> — titre\` + ligne \`- gate: <preuve>\`.
`,
};

/**
 * Fichiers markdown du standard module (docs/DOC-STANDARD-MODULE.md).
 * Le 5ᵉ fichier obligatoire, `gate.mjs` (gate colocalisée), est généré par
 * la factory (`renderModuleGateStub`) — pas un template markdown.
 */
export const MODULE_SPEC_FILES = [
  "prd.md",
  "interview.md",
  "TODO.md",
  "CHANGELOG.md",
] as const;

/**
 * Templates bruts des 4 markdown (placeholders `{{moduleId}}` intacts) —
 * pour poser `modules/_template/` dans un spec (brand-spec ou admin-spec).
 */
export function moduleTemplateFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of MODULE_SPEC_FILES) {
    const tplName = `modules/_template/${name}`;
    const src = path.join(kitTemplatesDir(), tplName);
    out[name] = fs.existsSync(src)
      ? fs.readFileSync(src, "utf8")
      : FALLBACK_TEMPLATES[tplName] || "";
  }
  return out;
}

/**
 * Rend les fichiers spec markdown d'un module concret (templates
 * `modules/_template` avec variables substituées) — utilisé par
 * `creezio brand module init` (qui y ajoute la gate.mjs colocalisée).
 */
export function renderModuleSpecFiles(
  moduleId: string,
): Record<string, string> {
  const prefix =
    moduleId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "MOD";
  const vars: Record<string, string> = {
    moduleId,
    moduleTodoPrefix: prefix,
  };
  const out: Record<string, string> = {};
  for (const name of MODULE_SPEC_FILES) {
    const tplName = `modules/_template/${name}`;
    const src = path.join(kitTemplatesDir(), tplName);
    let body = fs.existsSync(src)
      ? fs.readFileSync(src, "utf8")
      : FALLBACK_TEMPLATES[tplName] || "";
    for (const [k, v] of Object.entries(vars)) {
      body = body.split(`{{${k}}}`).join(v);
    }
    out[name] = body;
  }
  return out;
}

/**
 * Initialise un dossier brand-spec/ pour une nouvelle marque.
 */
export function initBrandSpec(opts: InitBrandSpecOptions): {
  outDir: string;
  written: string[];
} {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const force = Boolean(opts.force);
  const vertical = opts.vertical || "generic";
  const onboardingEnabled = opts.onboardingEnabled !== false;
  const vars = {
    brandId: opts.brandId,
    brandName: opts.brandName,
    domain: opts.domain,
    tagline: opts.tagline || `${opts.brandName} — métier sur OS Creezio`,
    vertical,
    // Preset = id du registre factory (le vertical lui-même) — plus de
    // valeur `<vertical>-catalog` câblée dans le contrat OS.
    meiliPreset: vertical === "generic" ? "none" : vertical,
    onboardingEnabled: onboardingEnabled ? "true" : "false",
    afterCompleteHref: onboardingEnabled ? "/onboarding" : "/",
    // NB: pas de moduleId ici — les placeholders {{moduleId}} des fichiers
    // modules/_template/* restent intacts (substitués par `brand module init`).
  };

  const written: string[] = [];
  const files: Array<[string, string]> = [
    ["brand.yaml", "brand.yaml"],
    ["product.md", "product.md"],
    ["AGENTS.md", "AGENTS.md"],
    ["interview.schema.json", "interview.schema.json"],
    ["platform/onboarding.yaml", "platform/onboarding.yaml"],
    ["platform/meili.yaml", "platform/meili.yaml"],
    ["platform/mcp.yaml", "platform/mcp.yaml"],
    ["modules/_template/prd.md", "modules/_template/prd.md"],
    ["modules/_template/interview.md", "modules/_template/interview.md"],
    ["modules/_template/TODO.md", "modules/_template/TODO.md"],
    ["modules/_template/CHANGELOG.md", "modules/_template/CHANGELOG.md"],
  ];

  for (const [tpl, rel] of files) {
    const dest = path.join(outDir, rel);
    if (copyTemplate(tpl, dest, force, vars)) written.push(dest);
  }

  // databases placeholder
  const dbReadme = path.join(outDir, "databases", "README.md");
  if (
    writeFile(
      dbReadme,
      `# Databases — ${opts.brandId}\n\nSchémas SQL brand optionnels (sinon générés via apply).\n`,
      force,
    )
  ) {
    written.push(dbReadme);
  }

  return { outDir, written };
}
