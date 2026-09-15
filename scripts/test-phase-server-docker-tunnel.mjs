/**
 * Gate — create server-docker fail-closed (tunnel public obligatoire)
 * + mapping slug réservé → `<brand>-<slug>`.
 *
 * Contrat 0.10.0 : CREEZIO_CF_API_TOKEN / _ACCOUNT_ID / _ZONE_ID
 * (plus de provisioner VPS). Aucun secret réel : valeurs fictives uniquement.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { RESERVED_SLUGS } = await import(
  pathToFileURL(path.join(root, "packages/platform-core/dist/tunnel-cf.js")).href
);

const dist = path.join(root, "packages/factory/dist/server-docker-tunnel.js");
assert.ok(
  fs.existsSync(dist),
  "packages/factory/dist/server-docker-tunnel.js absent — npm run build -w @creezio/factory",
);
const {
  RESERVED_SLUGS_FALLBACK,
  applyAdminPublicTunnelDefaults,
  deriveCreateTunnelSlug,
  formatMissingProvisionerError,
  resolveCreateTunnelPolicy,
  resolveMigrateStackPlan,
} = await import(pathToFileURL(dist).href);

const FAKE_CF = {
  CREEZIO_CF_API_TOKEN: "test-cf-token-not-a-secret",
  CREEZIO_CF_ACCOUNT_ID: "acct-test",
  CREEZIO_CF_ZONE_ID: "zone-test",
};

test("RESERVED_SLUGS_FALLBACK factory = SoT platform-core (demo inclus)", () => {
  assert.ok(RESERVED_SLUGS.has("demo"), "demo est réservé côté platform-core");
  assert.deepEqual(
    [...RESERVED_SLUGS].sort(),
    [...RESERVED_SLUGS_FALLBACK].sort(),
    "drift RESERVED_SLUGS tunnel-cf.ts ↔ factory fallback",
  );
});

test("create sans contrat CF + LOCAL unset : échec actionnable (pas de loopback)", () => {
  assert.throws(
    () =>
      resolveCreateTunnelPolicy({
        instanceName: "resto1",
        brandId: "foove2",
        env: {},
        reservedSlugs: RESERVED_SLUGS,
      }),
    (err) => {
      const msg = String(err?.message || err);
      assert.match(msg, /CREEZIO_CF_API_TOKEN/);
      assert.match(msg, /CREEZIO_CF_ACCOUNT_ID/);
      assert.match(msg, /CREEZIO_CF_ZONE_ID/);
      assert.match(msg, /crm\.foove\.io/);
      assert.match(msg, /cf\.env/);
      assert.match(msg, /CREEZIO_TUNNEL_LOCAL=1/);
      assert.doesNotMatch(msg, /CREEZIO_TUNNEL_PROVISION_URL/);
      assert.doesNotMatch(msg, /gh[po]_[A-Za-z0-9]{20,}/);
      return true;
    },
  );
  const text = formatMissingProvisionerError();
  assert.match(text, /loopback-only/);
});

test("create --profile prod ignore LOCAL=1 et exige le contrat CF", () => {
  assert.throws(
    () =>
      resolveCreateTunnelPolicy({
        instanceName: "resto1",
        brandId: "foove2",
        profile: "prod",
        env: { CREEZIO_TUNNEL_LOCAL: "1" },
        reservedSlugs: RESERVED_SLUGS,
      }),
    /CREEZIO_CF_API_TOKEN/,
  );
});

test("create LOCAL=1 sans profile : loopback autorisé (dev)", () => {
  const p = resolveCreateTunnelPolicy({
    instanceName: "demo",
    brandId: "foove2",
    env: { CREEZIO_TUNNEL_LOCAL: "1" },
    reservedSlugs: RESERVED_SLUGS,
  });
  assert.equal(p.mode, "local");
  assert.equal(p.local, true);
});

test("slug réservé demo → foove2-demo (explicite, écriture env)", () => {
  const mapped = deriveCreateTunnelSlug({
    instanceName: "demo",
    brandId: "foove2",
    reservedSlugs: RESERVED_SLUGS,
  });
  assert.equal(mapped.slug, "foove2-demo");
  assert.equal(mapped.derived, true);
  assert.equal(mapped.from, "demo");

  const p = resolveCreateTunnelPolicy({
    instanceName: "demo",
    brandId: "foove2",
    profile: "prod",
    env: FAKE_CF,
    reservedSlugs: RESERVED_SLUGS,
  });
  assert.equal(p.mode, "public");
  assert.equal(p.slug, "foove2-demo");
  assert.equal(p.derived, true);
  assert.equal(p.from, "demo");
});

test("slug déjà préfixé (foove2-demo) n'est pas re-dérivé", () => {
  const mapped = deriveCreateTunnelSlug({
    instanceName: "demo",
    brandId: "foove2",
    explicitSlug: "foove2-demo",
    reservedSlugs: RESERVED_SLUGS,
  });
  assert.equal(mapped.slug, "foove2-demo");
  assert.equal(mapped.derived, false);
});

test("slug libre (acme) inchangé", () => {
  const mapped = deriveCreateTunnelSlug({
    instanceName: "acme",
    brandId: "foove2",
    reservedSlugs: RESERVED_SLUGS,
  });
  assert.equal(mapped.slug, "acme");
  assert.equal(mapped.derived, false);
});

test("--no-stack en mode public : échec (pas de cf.env)", () => {
  assert.throws(
    () =>
      resolveCreateTunnelPolicy({
        instanceName: "acme",
        brandId: "foove2",
        env: FAKE_CF,
        reservedSlugs: RESERVED_SLUGS,
        noStack: true,
      }),
    /--no-stack/,
  );
});

test("migrate-stack : in-process sans cf.env + contrat CF → attach-cf", () => {
  assert.equal(
    resolveMigrateStackPlan({
      isStack: true,
      hasSidecar: false,
      hasCfEnv: false,
      hasCfContract: true,
    }),
    "attach-cf",
  );
  assert.equal(
    resolveMigrateStackPlan({
      isStack: true,
      hasSidecar: false,
      hasCfEnv: true,
      hasCfContract: true,
    }),
    "noop-inprocess",
  );
  assert.equal(
    resolveMigrateStackPlan({
      isStack: true,
      hasSidecar: false,
      hasCfEnv: false,
      hasCfContract: false,
    }),
    "noop-inprocess",
  );
  assert.equal(
    resolveMigrateStackPlan({
      isStack: true,
      hasSidecar: true,
      hasCfEnv: false,
      hasCfContract: true,
    }),
    "sidecar-migrate",
  );
  assert.equal(
    resolveMigrateStackPlan({
      isStack: true,
      hasSidecar: false,
      hasCfEnv: true,
      hasCfContract: true,
      needsHostnameSync: true,
    }),
    "sync-cf",
  );
});

test("admin : DOMAIN=lp + zone → admin.{zone} + EXTRA=lp.{zone}", () => {
  const r = applyAdminPublicTunnelDefaults({
    brandId: "tempoflowadmin",
    env: {
      CREEZIO_CF_ZONE_NAME: "tempoflow.fr",
      CREEZIO_DOMAIN: "lp.tempoflow.fr",
      CREEZIO_TUNNEL_SLUG: "tempoflowadmin-lp",
    },
  });
  assert.equal(r.applied, true);
  assert.equal(r.env.CREEZIO_DOMAIN, "admin.tempoflow.fr");
  assert.equal(r.env.CREEZIO_TUNNEL_EXTRA_HOSTNAMES, "lp.tempoflow.fr");
  assert.equal(r.env.CREEZIO_TUNNEL_SLUG, "tempoflowadmin-lp");
});

test("admin : create vierge pose admin+lp ; resto inchangé", () => {
  const admin = applyAdminPublicTunnelDefaults({
    brandId: "acmeadmin",
    env: { CREEZIO_CF_ZONE_NAME: "acme.example" },
  });
  assert.equal(admin.applied, true);
  assert.equal(admin.env.CREEZIO_DOMAIN, "admin.acme.example");
  assert.equal(admin.env.CREEZIO_TUNNEL_EXTRA_HOSTNAMES, "lp.acme.example");
  const resto = applyAdminPublicTunnelDefaults({
    brandId: "tempoflow3",
    env: {
      CREEZIO_CF_ZONE_NAME: "tempoflow.fr",
      CREEZIO_DOMAIN: "resto-lyon.tempoflow.fr",
    },
  });
  assert.equal(resto.applied, false);
  assert.equal(resto.env.CREEZIO_DOMAIN, "resto-lyon.tempoflow.fr");
  assert.equal(resto.env.CREEZIO_TUNNEL_EXTRA_HOSTNAMES, undefined);
});

test("CLI create câble la politique CF (plus de skip silencieux ni provisioner)", () => {
  const cli = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.match(cli, /resolveCreateTunnelPolicy/);
  assert.match(cli, /resolveMigrateStackPlan/);
  assert.match(cli, /applyAdminPublicTunnelDefaults/);
  assert.match(cli, /sync-cf/);
  assert.match(cli, /loadReservedSlugs/);
  assert.match(cli, /formatDerivedSlugLog/);
  assert.match(cli, /CREATE_TUNNEL_ENV_KEYS/);
  assert.match(cli, /CREEZIO_CF_API_TOKEN/);
  assert.match(cli, /cf\.env/);
  assert.doesNotMatch(cli, /CREEZIO_TUNNEL_PROVISION_URL\s*=/);
  assert.doesNotMatch(cli, /provisionerCall/);
  assert.doesNotMatch(
    cli,
    /if \(provUrl && provToken\) \{\s*const slug = \(extraEnv\.CREEZIO_TUNNEL_SLUG/,
    "l'ancien skip tunnel si URL absente ne doit plus exister",
  );
});
