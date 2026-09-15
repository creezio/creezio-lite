#!/usr/bin/env node
/**
 * Gate app-runtime — façade exports + composeBrandOs smoke (sans apps/tempoflow3).
 * Extract P1.2 depuis archive/tf3-probe-65b9273.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAppManifest } from "../packages/brand-config/dist/index.js";
import {
  applyBrandModuleAuth,
  composeBrandOs,
  createBrandModuleRegistry,
  startBrandDesktop,
  startBrandKernelHarness,
} from "../packages/app-runtime/dist/index.js";
import { applyModuleAssistantSources } from "../packages/assistant/dist/index.js";
import { composeOnboardingFromModules } from "../packages/onboarding/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("AR1 package app-runtime exporté", () => {
  const idx = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/dist/index.js"),
    "utf8",
  );
  assert.match(idx, /startBrandDesktop/);
  assert.match(idx, /startBrandKernelHarness/);
  assert.match(idx, /composeBrandOs/);
  assert.equal(typeof startBrandDesktop, "function");
  assert.equal(typeof startBrandKernelHarness, "function");
  assert.equal(typeof composeBrandOs, "function");
});

test("AR2 composeBrandOs assemble host stack (sandbox)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ar-compose-"));
  const electronDir = path.join(tmp, "electron");
  fs.mkdirSync(electronDir, { recursive: true });
  const resourcesRoot = path.join(
    ROOT,
    "packages/host-runtime/resources",
  );
  const manifest = createAppManifest({
    brandId: "acmeprobe",
    productName: "Acme Probe",
    domain: "acmeprobe.local",
    sandbox: true,
  });
  const osHandle = composeBrandOs({
    manifest,
    userDataDir: tmp,
    isPackaged: false,
    resourcesRoot,
    electronDirname: electronDir,
  });
  assert.ok(osHandle.hostRuntime);
  assert.ok(osHandle.hostStack);
  assert.equal(osHandle.status().brandId, "acmeprobe");
  assert.equal(osHandle.status().ok, true);
  osHandle.close();
});

test("AR3b SessionProvider SoT /me only — pas de fallback ownerPermissions", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/auth/ui/session-provider.tsx"),
    "utf8",
  );
  assert.match(src, /Array\.isArray\(data\.permissions\)/);
  assert.doesNotMatch(src, /\? \[\.\.\.ownerPermissions\]/);
});

test("AR3 ADR BrandSpec/app-runtime présent", () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, "docs/adr/ADR-brand-spec-app-runtime.md")),
  );
});

test("AR4 contrat module volet 2 : assistantSources + onboarding (F3.4)", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/module-contract.ts"),
    "utf8",
  );
  assert.match(src, /assistantSources\?:/);
  assert.match(src, /assistantSourcesJustification\?:/);
  assert.match(src, /onboarding\?:/);
  assert.match(src, /collectAssistantSources/);
  assert.match(src, /collectOnboardingContent/);
  assert.match(src, /BrandModuleAssistantSource/);
  assert.match(src, /composeOnboardingFromModules/);
  assert.doesNotMatch(src, /ARCHITECTURE_VERSION\s*=/);
  assert.equal(typeof createBrandModuleRegistry, "function");
  assert.equal(typeof applyModuleAssistantSources, "function");
  assert.equal(typeof composeOnboardingFromModules, "function");
});

test("AR5 collecteurs assistant/onboarding + consommation réelle", () => {
  const registry = createBrandModuleRegistry([
    {
      id: "articles",
      assistantSources: [
        {
          kind: "entity",
          entityKind: "articles",
          titleFields: ["nom"],
          type: "articles",
          urlWhenId: "/articles/{id}",
          urlWhenSearch: "/articles?q={q}",
        },
        {
          kind: "context",
          id: "articles-overview",
          title: "Articles",
          body: "Le module articles liste le catalogue.",
        },
        {
          kind: "tool",
          name: "lookup_article",
          description: "Retrouver un article par id",
          parameters: { type: "object", properties: { id: { type: "string" } } },
        },
      ],
      onboarding: {
        steps: [
          { id: "articles", label: "Articles", interstitialTitle: "Articles" },
        ],
        texts: { helper: "Présentation articles" },
      },
    },
    {
      id: "internal",
      assistantSourcesJustification: "écritures internes — pas de contexte LLM",
      onboarding: {
        steps: [{ id: "articles", label: "Doublon ignoré" }],
      },
    },
  ]);

  const sources = registry.collectAssistantSources();
  assert.equal(sources.length, 3);
  assert.equal(sources.filter((s) => s.kind === "entity").length, 1);
  const applied = applyModuleAssistantSources(sources);
  assert.equal(applied.entityRules.length, 1);
  assert.equal(applied.entityRules[0].kind, "articles");
  assert.equal(applied.toolDefinitions.length, 1);
  assert.equal(applied.toolDefinitions[0].function.name, "lookup_article");
  assert.match(applied.contextSection, /Contexte modules/);
  assert.match(applied.contextSection, /catalogue/);

  const content = registry.collectOnboardingContent();
  assert.equal(content.steps.length, 1, "dédup onboarding par id : premier gagne");
  assert.equal(content.steps[0].label, "Articles");
  assert.equal(content.texts?.helper, "Présentation articles");

  const composed = composeOnboardingFromModules([
    {
      moduleId: "articles",
      onboarding: { steps: [{ id: "articles", label: "Articles" }] },
    },
  ]);
  assert.equal(composed.steps[0].id, "articles");
});

test("AR6 collectNavPermissions / collectPermissionGroups depuis navItems", () => {
  const { collectNavPermissions, collectPermissionGroups } =
    createBrandModuleRegistry([
      {
        id: "alpha",
        navItems: [
          {
            id: "brand.alpha",
            label: "Alpha",
            href: "/alpha",
            order: 10,
            permission: "nav.alpha",
          },
        ],
      },
      {
        id: "beta",
        navItems: [
          {
            id: "brand.beta-a",
            label: "Beta A",
            href: "/beta-a",
            order: 20,
            permission: "nav.beta",
          },
          {
            id: "brand.beta-b",
            label: "Beta B",
            href: "/beta-b",
            order: 21,
            permission: "nav.beta",
          },
        ],
      },
      { id: "gamma", navItems: [] },
    ]);
  assert.deepEqual(collectNavPermissions(), ["nav.alpha", "nav.beta"]);
  const groups = collectPermissionGroups();
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.id, "alpha");
  assert.equal(groups[1]?.id, "beta");
  assert.equal(groups[1]?.permissions.length, 1);
});

test("AR7 applyBrandModuleAuth câble ownerPermissions + groupes si AC on", async () => {
  const { getAuthConfig, resetAuthConfigForTests } = await import(
    "@creezio/auth"
  );
  const {
    configureAccessControl,
    getAccessControlConfig,
    resetAccessControlForTests,
  } = await import("@creezio/access-control");
  resetAuthConfigForTests();
  resetAccessControlForTests();
  applyBrandModuleAuth({
    cookieName: "ar7_session",
    ownerPermissions: ["nav.alpha"],
    permissionGroups: [
      { id: "alpha", label: "Alpha", permissions: [{ id: "nav.alpha", label: "Alpha" }] },
    ],
  });
  assert.deepEqual(getAuthConfig().ownerPermissions, ["nav.alpha"]);
  assert.equal(getAccessControlConfig(), null, "AC absent → pas d'activation forcée");

  configureAccessControl({
    roles: [{ id: "staff", label: "Staff", defaultPermissions: [] }],
    defaultRole: "staff",
    permissionGroups: [
      { id: "os", label: "OS", permissions: [{ id: "nav.os", label: "OS" }] },
    ],
  });
  applyBrandModuleAuth({
    cookieName: "ar7_session",
    ownerPermissions: ["nav.alpha", "nav.beta"],
    permissionGroups: [
      { id: "alpha", label: "Alpha", permissions: [{ id: "nav.alpha", label: "Alpha" }] },
    ],
  });
  assert.deepEqual(getAuthConfig().ownerPermissions, ["nav.alpha", "nav.beta"]);
  const ac = getAccessControlConfig();
  assert.ok(ac?.permissionGroups?.some((g) => g.id === "os"));
  assert.ok(ac?.permissionGroups?.some((g) => g.id === "alpha"));
  resetAuthConfigForTests();
  resetAccessControlForTests();
});
