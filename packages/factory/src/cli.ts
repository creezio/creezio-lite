/**
 * CLI `creezio` — factory OS + BrandSpec.
 *
 * Usage:
 *   creezio new-app --name DemoBrand --id demobrand --domain demobrand.creez.io
 *   creezio new-app --from-prd docs/experiences/tempoflow3/PRD-PRODUIT.md --out /tmp/tf3
 *   creezio brand init|doctor|apply|smoke …
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldNewApp, type NewAppOptions } from "./scaffold.js";
import {
  assertProductModel,
  blankAppModel,
  parseProductPrd,
  safeBrandId,
  type ProductModel,
} from "./product-model.js";
import { printBrandHelp, runBrandCli } from "./brand-cli.js";
import {
  printServerDockerHelp,
  runServerDockerCli,
} from "./server-docker-cli.js";

export type CliArgs = {
  command: string;
  name?: string;
  id?: string;
  domain?: string;
  out?: string;
  envPrefix?: string;
  feedToken?: string;
  force?: boolean;
  sandbox?: boolean;
  help?: boolean;
  fromPrd?: string;
  /** Dossier icônes marque (client.png / server.png [/ tray-icon.png]). */
  iconsDir?: string;
  /** URL serveur pré-provisionnée dans le picker client join-only. */
  defaultServerUrl?: string;
  /** Dossier du repo admin dédié (défaut <out>-admin). */
  adminOut?: string;
  /** `--push` : créer + pousser les 2 repos GitHub (opt-in ; défaut = non). */
  push?: boolean;
  /** `--no-push` : défaut (redondant). */
  noPush?: boolean;
  /** Org/owner GitHub des repos créés (défaut creezio). */
  githubOrg?: string;
  /**
   * Pin `@creezio/*` sur le worktree kit pour `npm install` (gates CI,
   * PR de release). Sinon env `CREEZIO_LINK_KIT=1`.
   */
  linkKit?: boolean;
  /** Args restants pour sous-commandes (brand … / server-docker …). */
  rest?: string[];
};

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { command: "", sandbox: true };
  const rest = [...argv];
  const first = rest[0] || "";
  if (first === "--help" || first === "-h") {
    out.help = true;
    return out;
  }
  out.command = rest.shift() || "";

  if (
    out.command === "brand" ||
    out.command === "server-docker" ||
    out.command === "upgrade"
  ) {
    out.rest = rest;
    if (rest.includes("--help") || rest.includes("-h")) out.help = true;
    return out;
  }

  while (rest.length) {
    const a = rest.shift()!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--force") out.force = true;
    else if (a === "--no-sandbox") out.sandbox = false;
    else if (a === "--sandbox") out.sandbox = true;
    else if (a.startsWith("--name=")) out.name = a.slice("--name=".length);
    else if (a === "--name") out.name = rest.shift();
    else if (a.startsWith("--id=")) out.id = a.slice("--id=".length);
    else if (a === "--id") out.id = rest.shift();
    else if (a.startsWith("--domain=")) out.domain = a.slice("--domain=".length);
    else if (a === "--domain") out.domain = rest.shift();
    else if (a.startsWith("--out=")) out.out = a.slice("--out=".length);
    else if (a === "--out") out.out = rest.shift();
    else if (a.startsWith("--env-prefix="))
      out.envPrefix = a.slice("--env-prefix=".length);
    else if (a === "--env-prefix") out.envPrefix = rest.shift();
    else if (a.startsWith("--feed-token="))
      out.feedToken = a.slice("--feed-token=".length);
    else if (a === "--feed-token") out.feedToken = rest.shift();
    else if (a.startsWith("--from-prd="))
      out.fromPrd = a.slice("--from-prd=".length);
    else if (a === "--from-prd") out.fromPrd = rest.shift();
    else if (a.startsWith("--icons-dir="))
      out.iconsDir = a.slice("--icons-dir=".length);
    else if (a === "--icons-dir") out.iconsDir = rest.shift();
    else if (a.startsWith("--default-server-url="))
      out.defaultServerUrl = a.slice("--default-server-url=".length);
    else if (a === "--default-server-url") out.defaultServerUrl = rest.shift();
    else if (a.startsWith("--admin-out="))
      out.adminOut = a.slice("--admin-out=".length);
    else if (a === "--admin-out") out.adminOut = rest.shift();
    else if (a === "--push") out.push = true;
    else if (a === "--no-push") out.noPush = true;
    else if (a === "--link-kit") out.linkKit = true;
    else if (a.startsWith("--github-org="))
      out.githubOrg = a.slice("--github-org=".length);
    else if (a === "--github-org") out.githubOrg = rest.shift();
    else throw new Error(`Argument inconnu: ${a}`);
  }
  return out;
}

function printHelp(): void {
  console.log(`creezio — factory kit Creezio

Usage:
  creezio brand create --id <id> --name <Name> --domain <host> [--out <dir>]
  creezio new-app --from-prd <prd.md> [--out <dir>] [overrides]
  creezio new-app --name <ProductName> --id <brandId> --domain <host> [options]
  creezio demo-app …   (DÉPRÉCIÉ — exit 1 : utiliser brand create)
  creezio brand init|doctor|apply|smoke …
  creezio server-docker create|start|stop|rm|logs|ls|admin|build|up|down|ps|proof --brand-root <app>
  creezio upgrade [--brand-root <marque>] [--dry-run] [--no-install]

Happy path (recommandé) :
  creezio brand create --id acme --name Acme --domain acme.local
  → spec + monorepo + <id>-admin locaux, registre vide, mount interactive-demo,
    zéro module notes. Repos GitHub : ajouter --push (token requis).
    Puis : creezio brand module init <id> --app .

Mode produit (legacy TempoFlow3) :
  --from-prd      Brief / PRD markdown non technique
                  Dérive name / id / domain ; génère métier + wiring OS mince
                  Exige ## Entités ou vertical: chr — jamais de fallback notes

BrandSpec (agent créateur) :
  creezio brand create --id <id> --name <Name> --domain <host>
  creezio brand init --id <id> --name <Name> --domain <host>
  creezio brand doctor --spec <brand-spec>
  creezio brand apply --spec <brand-spec> --out <app> --force
  creezio brand smoke --app <app>

Serveur Docker headless (multi-instances, sans Electron) :
  creezio server-docker build|up|down|proof --brand-root <marque>
  Doc : docker/server/README.md

Montée de version d'un repo marque (kit → marque, P3.a) :
  creezio upgrade --brand-root <marque> --dry-run
  → chaîne de codemods d'architecture (idempotence prouvée), bump @creezio/*
    de TOUS les manifests + lockfiles, rematérialisation os-ui, doctor.

Overrides optionnels avec --from-prd :
  --name, --id, --domain, --out, --env-prefix, --feed-token, --sandbox/--no-sandbox, --force, --link-kit
  --icons-dir   Dossier marque : client.png + server.png (+ tray-icon.png)
                (sinon brand-spec/icons/ si présent ; sinon placeholder 1×1)
  --default-server-url  URL pré-remplie dans le picker du client join-only
                (installateur cabinet — l'humain confirme au premier lancement)

Mode technique (squelette OS vide) :
  --name, --id, --domain, --out, --env-prefix, --feed-token, --sandbox, --force, --link-kit
  --icons-dir, -h, --help

Factory 2 repos (marque + admin flotte) :
  --admin-out <dir>   Dossier du repo admin dédié (défaut <out>-admin)
  --push              Créer + pousser les 2 repos GitHub privés (opt-in ;
                      exige GITHUB_TOKEN / CREEZIO_GITHUB_TOKEN / .github-token)
  --no-push           Défaut (redondant) : aucun appel GitHub, même si un
                      token est présent dans l'environnement
  --github-org <org>  Org GitHub (défaut creezio)
  --link-kit          Installer @creezio/* depuis le worktree kit (file:),
                      pas le registre — requis en CI / PR de release
                      (équivalent : CREEZIO_LINK_KIT=1)

Exemples:
  creezio new-app --from-prd docs/experiences/tempoflow3/PRD-PRODUIT.md --out /tmp/tempoflow3 \\
    --icons-dir /opt/docker/tempoflow2/crm/resources/icons
  creezio brand apply --spec apps/tempoflow3/brand-spec --out apps/tempoflow3 --force
  creezio server-docker proof --brand-root /opt/docker/tempoflow3
`);
}

function kitRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

function loadProductModel(args: CliArgs, root: string): ProductModel {
  const prdPath = path.resolve(root, args.fromPrd!);
  if (!fs.existsSync(prdPath)) {
    const abs = path.resolve(args.fromPrd!);
    if (!fs.existsSync(abs)) {
      throw new Error(`PRD introuvable: ${args.fromPrd}`);
    }
    return finalizeModel(parseProductPrd(fs.readFileSync(abs, "utf8"), {
      sourcePath: abs,
      brandId: args.id,
      brandName: args.name,
    }), args);
  }
  return finalizeModel(
    parseProductPrd(fs.readFileSync(prdPath, "utf8"), {
      sourcePath: prdPath,
      brandId: args.id,
      brandName: args.name,
    }),
    args,
  );
}

function finalizeModel(model: ProductModel, args: CliArgs): ProductModel {
  if (args.id) model.brandId = safeBrandId(args.id);
  if (args.name) model.brandName = args.name.trim();
  if (args.domain) model.domain = args.domain.trim();
  assertProductModel(model);
  return model;
}

/** Factory 2-repos : délègue à maybePushBrandRepos (opt-in --push). */
async function maybeCreateGithubRepos(
  args: CliArgs,
  result: import("./scaffold.js").ScaffoldResult,
): Promise<void> {
  const { maybePushBrandRepos } = await import("./github-repos.js");
  const results = await maybePushBrandRepos({
    outDir: result.outDir,
    adminDir: result.adminDir,
    brandId: result.manifest.brandId,
    productName: result.manifest.client.productName,
    push: args.push,
    noPush: args.noPush,
    org: args.githubOrg,
    log: (line) => console.log(`  github       ${line}`),
  });
  for (const r of results || []) {
    console.log(
      `  github       ${r.url} (${r.created ? "créé" : "existant"}${r.pushed ? ", push main" : ""})`,
    );
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.command === "brand") {
    const rest = args.rest || [];
    if (
      args.help ||
      rest[0] === "--help" ||
      rest[0] === "-h" ||
      rest.length === 0
    ) {
      printBrandHelp();
      if (rest.length === 0 && !args.help) process.exit(1);
      return;
    }
    await runBrandCli(rest);
    return;
  }

  if (args.command === "server-docker") {
    const rest = args.rest || [];
    if (args.help || rest[0] === "--help" || rest[0] === "-h") {
      printServerDockerHelp();
      return;
    }
    await runServerDockerCli(rest);
    return;
  }

  if (args.command === "upgrade") {
    const { runUpgradeCli, printUpgradeHelp } = await import("./upgrade-cli.js");
    if (args.help) {
      printUpgradeHelp();
      return;
    }
    await runUpgradeCli(args.rest || []);
    return;
  }

  if (args.help || !args.command) {
    printHelp();
    if (!args.command) process.exit(args.help ? 0 : 1);
    return;
  }

  if (args.command === "demo-app") {
    console.error(
      "creezio demo-app est déprécié (plus de module notes par défaut).",
    );
    console.error("Utiliser : creezio brand create --id <id> --name <Name> --domain <host>");
    process.exit(1);
  }

  if (args.command !== "new-app") {
    throw new Error(
      `Commande inconnue: ${args.command} (new-app | brand | server-docker | upgrade). demo-app est déprécié — utiliser creezio brand create.`,
    );
  }

  const root = kitRoot();
  let productModel: ProductModel | undefined;
  let brandId: string;
  let productName: string;
  let domain: string;

  if (args.fromPrd) {
    productModel = loadProductModel(args, root);
    brandId = productModel.brandId;
    productName = productModel.brandName;
    domain = args.domain?.trim() || productModel.domain;
  } else {
    if (!args.name || !args.id || !args.domain) {
      printHelp();
      throw new Error(
        "Soit --from-prd <file>, soit --name + --id + --domain sont requis",
      );
    }
    brandId = args.id;
    productName = args.name;
    domain = args.domain;
    // Même chrome OS que brand create (RequireSession + dashboard), zéro métier.
    const shell = blankAppModel({
      brandId,
      brandName: productName,
      domain,
    });
    shell.platformNeeds = { ...shell.platformNeeds, onboarding: true };
    productModel = shell;
  }

  const outDir = path.resolve(
    args.out || path.join(root, "apps", brandId.trim().toLowerCase()),
  );

  if (args.linkKit) process.env.CREEZIO_LINK_KIT = "1";

  const opts: NewAppOptions = {
    brandId,
    productName,
    domain,
    outDir,
    envPrefix: args.envPrefix,
    feedToken: args.feedToken,
    sandbox: args.sandbox !== false,
    force: Boolean(args.force),
    kitRoot: root,
    iconsDir: args.iconsDir ? path.resolve(args.iconsDir) : undefined,
    productModel,
    defaultServerUrl: args.defaultServerUrl,
    adminOut: args.adminOut ? path.resolve(args.adminOut) : undefined,
  };

  const result = scaffoldNewApp(opts);
  console.log(`✓ AppManifest ${result.manifest.brandId}`);
  if (result.productModel) {
    console.log(`  from-prd     ${result.productModel.sourcePrdPath || args.fromPrd}`);
    console.log(
      `  entities     ${result.productModel.entities.map((e) => e.id).join(", ")}`,
    );
    console.log(
      `  pages        ${result.productModel.pages.map((p) => p.path).join(", ")}`,
    );
  }
  console.log(`  client GUID  ${result.manifest.client.nsisGuid}`);
  console.log(`  server GUID  ${result.manifest.server.nsisGuid}`);
  console.log(`  feed client  ${result.manifest.client.feedUrl}`);
  console.log(`  out          ${result.outDir}`);
  console.log(`  admin repo   ${result.adminDir}`);
  console.log(`  files        ${result.writtenFiles.length}`);
  for (const f of result.writtenFiles) {
    console.log(`    + ${path.relative(result.outDir, f)}`);
  }

  // Vendor + package-lock AVANT tout (push ou pas) — Docker prêt out-of-the-box.
  const { prepareBrandDistribution } = await import(
    "./prepare-brand-distribution.js"
  );
  prepareBrandDistribution(result.outDir, {
    kitRoot: root,
    linkKit: args.linkKit,
    log: (line) => console.log(`  dist         ${line}`),
  });
  if (args.linkKit || process.env.CREEZIO_LINK_KIT === "1") {
    console.log(`  link-kit     ${root}`);
  }

  await maybeCreateGithubRepos(args, result);
  console.log("");
  console.log("Suite:");
  console.log(`  cd ${result.outDir}`);
  if (result.productModel) {
    console.log(`  npm run test:metier-parcours`);
    console.log(`  npm run test:first-run-auth`);
  }
  console.log(
    `  npm ci                                 # clone hôte : layout node_modules (= Docker)`,
  );
  console.log(
    `  CREEZIO_TUNNEL_LOCAL=1 npm run server-docker:create -- demo   # local loopback`,
  );
  console.log(
    `  npm run server-docker:create -- acme -- --profile prod         # VPS hostname + owner`,
  );
  console.log("");
  console.log(
    "ℹ Modèle pull : le kit ne connaît pas ses consommateurs. L'app tire le",
  );
  console.log(
    "  kit quand elle le décide : npm update \"@creezio/*\" (distribution npm,",
  );
  console.log(
    "  docs/NPM-DISTRIBUTION.md du kit).",
  );
}
