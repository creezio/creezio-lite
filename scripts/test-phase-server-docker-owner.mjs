/**
 * Gate — create server-docker fail-closed (owner first-run obligatoire en VPS)
 *
 * Aucun secret : e-mail / mot de passe fictifs uniquement.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dist = path.join(root, "packages/factory/dist/server-docker-owner.js");
assert.ok(
  fs.existsSync(dist),
  "packages/factory/dist/server-docker-owner.js absent — npm run build -w @creezio/factory",
);
const {
  CREATE_OWNER_ENV_KEYS,
  E2E_OWNER_ENV_KEYS,
  formatInvalidOwnerError,
  formatMissingOwnerError,
  formatOwnerLoginLog,
  redactSecret,
  resolveCreateOwnerPolicy,
  resolveEnsureOwnerCreds,
  defaultE2eEmail,
  applyFirstRunOwner,
  assertInteractiveDemoScenarios,
  formatMissingDemoError,
} = await import(pathToFileURL(dist).href);

test("CREATE_OWNER_ENV_KEYS = contrat canonique (pas E2E_OWNER_*)", () => {
  assert.deepEqual([...CREATE_OWNER_ENV_KEYS], [
    "CREEZIO_OWNER_EMAIL",
    "CREEZIO_OWNER_PASSWORD",
  ]);
  assert.deepEqual([...E2E_OWNER_ENV_KEYS], [
    "CREEZIO_E2E_EMAIL",
    "CREEZIO_E2E_PASSWORD",
  ]);
  assert.equal(defaultE2eEmail("resto-marseille", "tempoflow3"), "owner@resto-marseille.tempoflow.local");
});

test("ensure-owner : paires owner/e2e, partiel = erreur, sans echo password", () => {
  const empty = resolveEnsureOwnerCreds({});
  assert.equal(empty.owner, null);
  assert.equal(empty.e2e, null);
  assert.throws(
    () => resolveEnsureOwnerCreds({ CREEZIO_E2E_EMAIL: "e2e@acme.example" }),
    /ensemble/,
  );
  try {
    resolveEnsureOwnerCreds({
      CREEZIO_E2E_EMAIL: "e2e@acme.example",
      CREEZIO_E2E_PASSWORD: "short",
    });
    assert.fail("attendu throw e2e password court");
  } catch (err) {
    const msg = String(err?.message || err);
    assert.match(msg, /min\. 6/);
    assert.doesNotMatch(msg, /short/);
  }
  const both = resolveEnsureOwnerCreds({
    CREEZIO_OWNER_EMAIL: "owner@acme.example",
    CREEZIO_OWNER_PASSWORD: "secret-os",
    CREEZIO_E2E_EMAIL: "e2e@acme.example",
    CREEZIO_E2E_PASSWORD: "secret-e2e",
  });
  assert.equal(both.owner?.email, "owner@acme.example");
  assert.equal(both.e2e?.email, "e2e@acme.example");
});

test("create VPS sans owner : échec actionnable (pas d'instance « OK »)", () => {
  assert.throws(
    () =>
      resolveCreateOwnerPolicy({
        local: false,
        env: {},
      }),
    (err) => {
      const msg = String(err?.message || err);
      assert.match(msg, /CREEZIO_OWNER_EMAIL/);
      assert.match(msg, /CREEZIO_OWNER_PASSWORD/);
      assert.match(msg, /\/api\/v1\/os\/setup/);
      assert.match(msg, /Runtime Secrets|E2E_OWNER_/);
      assert.match(msg, /CREEZIO_TUNNEL_LOCAL=1/);
      assert.doesNotMatch(msg, /gh[po]_[A-Za-z0-9]{20,}/);
      assert.doesNotMatch(msg, /Nw7oyc45|password=/i);
      return true;
    },
  );
  const text = formatMissingOwnerError();
  assert.match(text, /sans compte owner/);
});

test("create LOCAL=1 sans owner : skip (dev machine)", () => {
  const p = resolveCreateOwnerPolicy({
    local: true,
    env: {},
  });
  assert.equal(p.mode, "skip");
  assert.equal(p.reason, "local-optional");
});

test("create LOCAL=1 avec owner valide : create", () => {
  const p = resolveCreateOwnerPolicy({
    local: true,
    env: {
      CREEZIO_OWNER_EMAIL: "owner@demo.local",
      CREEZIO_OWNER_PASSWORD: "secret-os",
    },
  });
  assert.equal(p.mode, "create");
  assert.equal(p.email, "owner@demo.local");
  assert.equal(p.password, "secret-os");
});

test("partiel (email sans password) : échec même en LOCAL", () => {
  assert.throws(
    () =>
      resolveCreateOwnerPolicy({
        local: true,
        env: { CREEZIO_OWNER_EMAIL: "owner@demo.local" },
      }),
    /ensemble/,
  );
  assert.throws(
    () =>
      resolveCreateOwnerPolicy({
        local: false,
        env: { CREEZIO_OWNER_PASSWORD: "secret-os" },
      }),
    /ensemble/,
  );
});

test("e-mail invalide / password trop court : échec sans echo du secret", () => {
  assert.throws(
    () =>
      resolveCreateOwnerPolicy({
        local: false,
        env: {
          CREEZIO_OWNER_EMAIL: "pas-un-email",
          CREEZIO_OWNER_PASSWORD: "secret-os",
        },
      }),
    /e-mail/,
  );
  try {
    resolveCreateOwnerPolicy({
      local: false,
      env: {
        CREEZIO_OWNER_EMAIL: "owner@demo.local",
        CREEZIO_OWNER_PASSWORD: "short",
      },
    });
    assert.fail("attendu throw password court");
  } catch (err) {
    const msg = String(err?.message || err);
    assert.match(msg, /min\. 6/);
    assert.doesNotMatch(msg, /short/);
  }
  assert.match(formatInvalidOwnerError("password"), /min\. 6/);
});

test("log login : e-mail seulement, jamais le mot de passe", () => {
  const line = formatOwnerLoginLog("owner@acme.example");
  assert.equal(line, "login : owner@acme.example");
  assert.doesNotMatch(line, /PASSWORD|secret|mot de passe/i);
});

test("redactSecret retire le mot de passe d'un message d'erreur", () => {
  assert.equal(
    redactSecret("échec body password=SuperSecret-99", "SuperSecret-99"),
    "échec body password=***",
  );
});

test("applyFirstRunOwner : setup + login, sans echo du password", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", body: init?.body });
    if (String(url).endsWith("/api/v1/os/setup") && !init?.method) {
      return {
        status: 200,
        json: async () => ({ ok: true, setupComplete: false, username: null }),
      };
    }
    if (String(url).endsWith("/api/v1/os/setup")) {
      return {
        status: 200,
        json: async () => ({ ok: true, setupComplete: true, username: "owner@acme.example" }),
      };
    }
    if (String(url).endsWith("/api/v1/auth/login")) {
      return { status: 200, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  const r = await applyFirstRunOwner({
    baseUrl: "http://127.0.0.1:18791",
    email: "owner@acme.example",
    password: "NeverLog-This-Password",
    fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(r.username, "owner@acme.example");
  assert.equal(calls.length, 3);
  assert.match(String(calls[1].body), /NeverLog-This-Password/);
  assert.match(String(calls[2].body), /"email":"owner@acme.example"/);
});

test("applyFirstRunOwner : setup déjà complet d'un autre user → refus", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/v1/os/setup")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          setupComplete: true,
          username: "deja@la.example",
        }),
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  await assert.rejects(
    () =>
      applyFirstRunOwner({
        baseUrl: "http://127.0.0.1:9",
        email: "nouveau@la.example",
        password: "NeverLog-This-Password",
        fetchImpl,
      }),
    (err) => {
      const msg = String(err?.message || err);
      assert.match(msg, /deja@la\.example/);
      assert.doesNotMatch(msg, /NeverLog-This-Password/);
      return true;
    },
  );
});

test("assertInteractiveDemoScenarios : ≥ 1 scénario après login, 0 = échec", async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/api/v1/auth/login") && init?.method === "POST") {
      return {
        status: 200,
        headers: {
          getSetCookie: () => ["probebrand_session=tok; Path=/"],
          get: () => null,
        },
        json: async () => ({ ok: true }),
        text: async () => "",
      };
    }
    if (String(url).endsWith("/interactive-demo/scenarios")) {
      return {
        status: 200,
        json: async () => ({ ok: true, scenarios: [{ id: "os-tour" }] }),
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const r = await assertInteractiveDemoScenarios({
    baseUrl: "http://127.0.0.1:18791",
    email: "owner@acme.example",
    password: "NeverLog-This-Password",
    fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
});

test("assertInteractiveDemoScenarios : 0 scénario / 404 = échec sans echo du password", async () => {
  const empty = async (url, init) => {
    if (String(url).endsWith("/api/v1/auth/login") && init?.method === "POST") {
      return {
        status: 200,
        headers: { getSetCookie: () => ["s=1"], get: () => null },
        json: async () => ({ ok: true }),
        text: async () => "",
      };
    }
    if (String(url).endsWith("/interactive-demo/scenarios")) {
      return { status: 200, json: async () => ({ ok: true, scenarios: [] }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  await assert.rejects(
    () =>
      assertInteractiveDemoScenarios({
        baseUrl: "http://127.0.0.1:9",
        email: "owner@acme.example",
        password: "NeverLog-This-Password",
        fetchImpl: empty,
      }),
    (err) => {
      const msg = String(err?.message || err);
      assert.match(msg, /0 scénario|sans démo interactive/);
      assert.doesNotMatch(msg, /NeverLog-This-Password/);
      return true;
    },
  );
  const missing = async (url, init) => {
    if (String(url).endsWith("/api/v1/auth/login") && init?.method === "POST") {
      return {
        status: 200,
        headers: { getSetCookie: () => ["s=1"], get: () => null },
        json: async () => ({ ok: true }),
        text: async () => "",
      };
    }
    if (String(url).endsWith("/interactive-demo/scenarios")) {
      return { status: 404, json: async () => ({ error: "not_found" }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  await assert.rejects(
    () =>
      assertInteractiveDemoScenarios({
        baseUrl: "http://127.0.0.1:9",
        email: "owner@acme.example",
        password: "NeverLog-This-Password",
        fetchImpl: missing,
      }),
    /404|mount/,
  );
  assert.match(formatMissingDemoError("x"), /invalide/);
});

test("CLI create câble la politique owner (fail-closed + setup, pas le password en log)", () => {
  const cli = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.match(cli, /resolveCreateOwnerPolicy/);
  assert.match(cli, /applyFirstRunOwner/);
  assert.match(cli, /assertInteractiveDemoScenarios/);
  assert.match(cli, /formatOwnerLoginLog/);
  assert.match(cli, /CREATE_OWNER_ENV_KEYS/);
  assert.match(cli, /CREEZIO_OWNER_EMAIL/);
  assert.match(cli, /persistOwnerSecrets/);
  assert.match(cli, /ensure-owner/);
  assert.match(cli, /CREEZIO_E2E_\*/);
  assert.match(cli, /E2E_OWNER_ENV_KEYS/);
  const ownerSrc = fs.readFileSync(
    path.join(root, "packages/factory/src/server-docker-owner.ts"),
    "utf8",
  );
  assert.match(ownerSrc, /creezio_platform_users/);
  assert.match(ownerSrc, /migrateBrandCredentialsToKit/);
  assert.doesNotMatch(
    cli,
    /console\.log\([^)]*ownerPolicy\.password/,
    "le mot de passe owner ne doit jamais être loggé",
  );
  assert.doesNotMatch(cli, /E2E_OWNER_EMAIL/);
});
