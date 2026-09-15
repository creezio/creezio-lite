#!/usr/bin/env node
/**
 * Phase P — @creezio/onboarding (setup + moteur, hors shell-ui).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUTO_ADVANCE_MS_DEFAULT,
  INTERSTITIAL_MS_DEFAULT,
  ONBOARDING_PACKAGE,
  SLUG_RE,
  buildCompleteSetupPayload,
  clampStep,
  computeInitialStep,
  nextStepIndex,
  prevStepIndex,
  shouldShowInterstitial,
  validateAccountStep,
  validateOpenaiStep,
  validateRecoveryStep,
  validateSlugStep,
  setupWizardConfigFromSpec,
} from "../packages/onboarding/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");

const BRANDS = [
  { name: "tempoflow2", dir: "tempoflow2/crm" },
  { name: "certivan-app", dir: "certivan-app/crm" },
  { name: "fidu", dir: "fidu/crm" },
];

const ENGINE_TWINS = [
  "src/components/setup/setup-wizard.tsx",
  "src/components/onboarding/onboarding-wizard.tsx",
  "src/components/onboarding/onboarding-shell.tsx",
  "src/components/onboarding/micro.tsx",
  "src/components/onboarding/step-interstitial.tsx",
];

const PACKAGE_UI = [
  "packages/onboarding/ui/index.ts",
  "packages/onboarding/ui/setup/setup-wizard.tsx",
  "packages/onboarding/ui/onboarding/onboarding-wizard.tsx",
  "packages/onboarding/ui/onboarding/onboarding-shell.tsx",
  "packages/onboarding/ui/onboarding/micro.tsx",
  "packages/onboarding/ui/onboarding/interstitial.tsx",
  "packages/onboarding/ui/onboarding/onboarding.css",
  "packages/onboarding/README.md",
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "dist-cjs") {
        continue;
      }
      out.push(...walk(p));
    } else out.push(p);
  }
  return out;
}

test("P.1 package scaffold + exports", () => {
  assert.equal(ONBOARDING_PACKAGE, "@creezio/onboarding");
  for (const rel of PACKAGE_UI) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  assert.ok(
    fs.existsSync(path.join(root, "packages/onboarding/ui/onboarding/define.ts")),
    "define.ts helper DX",
  );
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/onboarding/package.json"), "utf8"),
  );
  assert.equal(pkg.name, "@creezio/onboarding");
  assert.ok(pkg.exports["."]);
  assert.ok(pkg.exports["./ui"]);
  assert.ok(
    pkg.exports["./ui/onboarding/onboarding.css"],
    "export CSS onboarding",
  );
  assert.equal(pkg.dependencies["@creezio/shell-ui"], "0.1.0");
  assert.ok(fs.existsSync(path.join(root, "packages/onboarding/dist/index.js")));
});

test("P.2 pas sous shell-ui + dep one-way", () => {
  const shellPkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/shell-ui/package.json"), "utf8"),
  );
  assert.equal(shellPkg.dependencies?.["@creezio/onboarding"], undefined);
  assert.equal(shellPkg.devDependencies?.["@creezio/onboarding"], undefined);

  const badShell = walk(path.join(root, "packages/shell-ui")).filter((p) =>
    /onboarding|setup-wizard/i.test(path.relative(root, p)),
  );
  assert.equal(badShell.length, 0, `shell-ui ne doit pas contenir onboarding: ${badShell}`);

  for (const f of walk(path.join(root, "packages/shell-ui"))) {
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    const s = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(s, /@creezio\/onboarding/);
  }
});

test("P.3 zéro hardcode desktop marque + zéro métier dans package", () => {
  const dirs = [
    path.join(root, "packages/onboarding/src"),
    path.join(root, "packages/onboarding/ui"),
  ];
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      if (!/\.(ts|tsx|css|md)$/.test(f)) continue;
      const s = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(
        s,
        /tempoflowDesktop|certivanDesktop|fiduDesktop/,
        path.relative(root, f),
      );
      if (f.endsWith(".md")) continue; // README : exemples métier docs only
      assert.doesNotMatch(
        s,
        /\b(restaurant|cabinet|VASP|achats|atelier)\b/i,
        `métier interdit: ${path.relative(root, f)}`,
      );
      assert.doesNotMatch(
        s,
        /\b(TempoFlow|Certivan|Fidu|OnbRestaurant)\b/,
        `marque interdite: ${path.relative(root, f)}`,
      );
      assert.doesNotMatch(s, /paperclipApi|startPaperclip|Paperclip/);
    }
  }
  const setup = fs.readFileSync(
    path.join(root, "packages/onboarding/ui/setup/setup-wizard.tsx"),
    "utf8",
  );
  assert.match(setup, /getShellDesktopApi/);
  assert.match(setup, /getShellUiBrand/);
  assert.match(setup, /createHttpSetupDesktopApi|\/api\/v1\/os\/setup/);
  assert.match(setup, /DEFAULT_AFTER_SETUP_HREF/);
  assert.doesNotMatch(
    setup,
    /afterCompleteHref = config\.afterCompleteHref \?\? ["']\/onboarding["']/,
    "SetupWizard ne doit plus sortir sur /onboarding par défaut",
  );
  const httpSetup = fs.readFileSync(
    path.join(root, "packages/onboarding/ui/setup/http-setup-api.ts"),
    "utf8",
  );
  assert.match(httpSetup, /\/api\/v1\/os\/setup/);
  assert.match(httpSetup, /probeHttpSetupAvailable/);

  // TempoPose : alias deprecated uniquement — aucun usage runtime interne
  const uiFiles = walk(path.join(root, "packages/onboarding/ui")).filter((f) =>
    /\.(ts|tsx)$/.test(f),
  );
  for (const f of uiFiles) {
    const s = fs.readFileSync(f, "utf8");
    const rel = path.relative(root, f);
    if (rel.endsWith("types.ts") || rel.endsWith("index.ts") || rel.endsWith("onboarding-shell.tsx")) {
      if (s.includes("TempoPose")) {
        assert.match(s, /@deprecated/, `TempoPose sans @deprecated: ${rel}`);
      }
      continue;
    }
    assert.doesNotMatch(s, /TempoPose/, `usage interne TempoPose: ${rel}`);
  }
});

test("P.4 setup validation + completeSetup payload", () => {
  assert.equal(
    validateAccountStep({ username: "a", password: "123456", password2: "123456" }),
    "Choisissez un identifiant (min. 2 caractères).",
  );
  assert.equal(
    validateAccountStep({ username: "ab", password: "12345", password2: "12345" }),
    "Mot de passe trop court (min. 6 caractères).",
  );
  assert.equal(
    validateAccountStep({ username: "ab", password: "123456", password2: "x" }),
    "Les mots de passe ne correspondent pas.",
  );
  assert.equal(
    validateAccountStep({ username: "ab", password: "123456", password2: "123456" }),
    null,
  );
  assert.equal(
    validateRecoveryStep({ recoveryKey: "k", recoveryAck: false }),
    "Cochez la case pour confirmer que vous avez noté la clé.",
  );
  assert.ok(SLUG_RE.test("mon-espace"));
  assert.equal(
    validateSlugStep({ slug: "-bad", slugOk: null, slugReason: null }),
    "Slug invalide.",
  );
  assert.equal(validateOpenaiStep("", true), "Collez votre clé OpenAI (sk-…).");
  assert.equal(validateOpenaiStep("", false), null);

  const payload = buildCompleteSetupPayload({
    username: "  chef  ",
    password: "secret1",
    openaiKey: "  sk-test  ",
    slug: "Mon-Resto",
    recoveryKey: "rk-1",
    stayLoggedIn: true,
  });
  assert.deepEqual(payload, {
    username: "chef",
    password: "secret1",
    openaiKey: "sk-test",
    slug: "mon-resto",
    recoveryKey: "rk-1",
    stayLoggedIn: true,
  });
});

test("P.4b setupWizardConfigFromSpec — off → home, on → /onboarding", () => {
  assert.deepEqual(setupWizardConfigFromSpec(null), {
    afterCompleteHref: "/",
  });
  assert.deepEqual(setupWizardConfigFromSpec({ enabled: false }), {
    afterCompleteHref: "/",
  });
  const on = setupWizardConfigFromSpec({
    enabled: true,
    slugPlaceholder: "mon-espace",
  });
  assert.equal(on.afterCompleteHref, "/onboarding");
  assert.equal(on.slugPlaceholder, "mon-espace");
});

test("P.5 moteur: initial / advance / interstitial (3 et 8 steps)", () => {
  assert.equal(INTERSTITIAL_MS_DEFAULT, 2100);
  assert.equal(AUTO_ADVANCE_MS_DEFAULT, 320);

  assert.equal(computeInitialStep({ stepCount: 3, editMode: true }), 2);
  assert.equal(computeInitialStep({ stepCount: 8, editMode: true }), 7);
  assert.equal(computeInitialStep({ stepCount: 8, persistedStep: 3 }), 3);
  assert.equal(computeInitialStep({ stepCount: 3, startStep: 99 }), 2);
  assert.equal(clampStep(-1, 3), 0);
  assert.equal(nextStepIndex(0, 3), 1);
  assert.equal(nextStepIndex(7, 8), 7);
  assert.equal(prevStepIndex(0), 0);
  assert.equal(prevStepIndex(4), 3);

  assert.equal(
    shouldShowInterstitial({
      targetIndex: 1,
      interstitialsEnabled: true,
      hasTitle: true,
    }),
    true,
  );
  assert.equal(
    shouldShowInterstitial({
      targetIndex: 1,
      interstitialsEnabled: false,
      hasTitle: true,
    }),
    false,
  );
  assert.equal(
    shouldShowInterstitial({
      targetIndex: 0,
      interstitialsEnabled: true,
      hasTitle: true,
    }),
    false,
  );

  // shapes parcours (labels only — registry marque)
  const short = ["Bienvenue", "Atelier", "Récap"];
  const long = [
    "Bienvenue",
    "Établissement",
    "Achats",
    "Fournisseurs",
    "Objectifs",
    "Contraintes",
    "Préférences",
    "Récapitulatif",
  ];
  assert.equal(short.length, 3);
  assert.equal(long.length, 8);
  assert.equal(computeInitialStep({ stepCount: short.length }), 0);
  assert.equal(computeInitialStep({ stepCount: long.length, editMode: true }), 7);
});

test("P.6 workspace wiring + package publié npm", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(rootPkg.scripts.build, /@creezio\/onboarding/);
  assert.match(rootPkg.scripts["build:packages"], /@creezio\/onboarding/);
  assert.match(rootPkg.scripts.test, /test-phase-p-onboarding/);

  // Distribution npm : le package est publié (plus de sync-list vendor).
  const onb = JSON.parse(
    fs.readFileSync(path.join(root, "packages/onboarding/package.json"), "utf8"),
  );
  assert.equal(
    onb.publishConfig?.registry,
    "https://registry.npmjs.org",
    "onboarding non publiable npm",
  );

  const cjs = fs.readFileSync(path.join(root, "scripts/build-cjs.mjs"), "utf8");
  assert.match(cjs, /"onboarding"/);
});

test("P.7 PHASE doc implemented + UI exports stables", () => {
  const phase = fs.readFileSync(
    path.join(root, "docs/archive/PHASE-P-ONBOARDING.md"),
    "utf8",
  );
  assert.match(phase, /implémenté|implemented/i);
  assert.match(phase, /@creezio\/onboarding/);
  assert.doesNotMatch(phase, /Paperclip|paperclipApi/);

  const ui = fs.readFileSync(
    path.join(root, "packages/onboarding/ui/index.ts"),
    "utf8",
  );
  for (const sym of [
    "SetupWizard",
    "OnboardingWizard",
    "Stepper",
    "useMicro",
    "MicroScreen",
    "BigInput",
    "BigOption",
    "AUTO_ADVANCE_MS",
    "INTERSTITIAL_MS",
    "configureOnboardingUi",
    "defineOnboardingSteps",
    "createOnboardingHostProps",
    "CompanionPose",
  ]) {
    assert.match(ui, new RegExp(sym));
  }

  const readme = fs.readFileSync(
    path.join(root, "packages/onboarding/README.md"),
    "utf8",
  );
  assert.match(readme, /Ce que le kit FOURNIT/i);
  assert.match(readme, /Ce que la marque DOIT fournir/i);
  assert.match(readme, /ne doit JAMAIS contenir/i);
  assert.match(readme, /defineOnboardingSteps/);
  assert.match(readme, /CompanionPose/);
});

test("P.8 cutover marques: 0 jumeau setup/moteur", () => {
  for (const b of BRANDS) {
    const crm = path.join(dockerRoot, b.dir);
    if (!fs.existsSync(crm)) {
      assert.fail(`marque absente: ${crm}`);
    }
    for (const rel of ENGINE_TWINS) {
      const p = path.join(crm, rel);
      assert.ok(!fs.existsSync(p), `jumeau encore présent: ${b.name} ${rel}`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(crm, "package.json"), "utf8"));
    assert.ok(
      pkg.dependencies?.["@creezio/onboarding"] ||
        pkg.devDependencies?.["@creezio/onboarding"],
      `${b.name} doit dépendre de @creezio/onboarding`,
    );
    const setupPage = fs.readFileSync(
      path.join(crm, "src/app/setup/page.tsx"),
      "utf8",
    );
    assert.match(setupPage, /@creezio\/onboarding/);
    assert.doesNotMatch(setupPage, /@\/components\/setup\/setup-wizard/);

    const onbHost = path.join(crm, "src/components/onboarding/onboarding-host.tsx");
    assert.ok(fs.existsSync(onbHost), `${b.name} onboarding-host.tsx`);
    const host = fs.readFileSync(onbHost, "utf8");
    assert.match(host, /OnboardingWizard/);
    assert.match(host, /@creezio\/onboarding/);
  }
});
