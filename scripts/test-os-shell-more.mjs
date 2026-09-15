/**
 * Extensions shell kit — fonctions réellement exportées par @creezio/platform-core.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "packages/platform-core/dist/index.js");

test("shell-more: parseProfileArgv (exports kit)", async () => {
  const mod = await import(pathToFileURL(dist).href);
  assert.equal(typeof mod.parseProfileArgv, "function");
  assert.equal(typeof mod.profileArgFor, "function");
  assert.equal(typeof mod.sanitizeProfileSegment, "function");

  const prefix = `--${demobrandManifest.envPrefix.toLowerCase()}-profile=`;
  const parsed = mod.parseProfileArgv(
    ["node", "app", `${prefix}server`],
    demobrandManifest,
  );
  assert.equal(parsed.mode, "server");

  const ai = mod.parseProfileArgv(
    ["node", "app", `${prefix}ai:agent-1`],
    demobrandManifest,
  );
  assert.equal(ai.mode, "ai");
  assert.equal(ai.aiUserId, "agent-1");

  const aiArg = mod.profileArgFor(
    { mode: "ai", aiUserId: "agent-1" },
    demobrandManifest,
  );
  assert.ok(aiArg);
  assert.match(aiArg, /ai:agent-1$/);

  assert.equal(mod.sanitizeProfileSegment("A B!"), "a-b");
});

test("shell-more: recovery key generate/verify/wrap", async () => {
  const mod = await import(pathToFileURL(dist).href);
  assert.equal(typeof mod.generateRecoveryKey, "function");
  assert.equal(typeof mod.createRecoveryVerifier, "function");
  assert.equal(typeof mod.verifyRecoveryKey, "function");
  assert.equal(typeof mod.wrapSecretsWithRecoveryKey, "function");
  assert.equal(typeof mod.unwrapSecretsWithRecoveryKey, "function");

  const key = mod.generateRecoveryKey();
  assert.equal(typeof key, "string");
  assert.ok(key.length > 8);
  const verifier = mod.createRecoveryVerifier(key);
  assert.equal(mod.verifyRecoveryKey(key, verifier), true);
  assert.equal(
    mod.verifyRecoveryKey("WRONG-KEY-0000-0000-0000-0000-0000-0000", verifier),
    false,
  );

  const wrapped = mod.wrapSecretsWithRecoveryKey(key, {
    authUser: "owner",
    authPassword: "secret",
    authSecret: "jwt-secret",
  });
  const unwrapped = mod.unwrapSecretsWithRecoveryKey(key, wrapped);
  assert.equal(unwrapped.authUser, "owner");
  assert.equal(unwrapped.authPassword, "secret");
});

test("shell-more: tunnel urls + factory reset helpers", async () => {
  const mod = await import(pathToFileURL(dist).href);
  assert.equal(typeof mod.buildTunnelPublicUrls, "function");
  assert.equal(typeof mod.deriveTunnelServiceUrl, "function");
  assert.equal(typeof mod.factoryResetTargets, "function");

  const urls = mod.buildTunnelPublicUrls("demo.example.com");
  assert.equal(urls.crm, "https://demo.example.com");
  assert.match(urls.n8n, /^https:\/\//);
  assert.match(urls.hermes, /^https:\/\//);

  const ctx = {
    manifest: demobrandManifest,
    userDataRoot: "/tmp/creezio-shell-more-userdata",
    isPackaged: true,
    resourcesRoot: "/tmp/creezio-shell-more-resources",
  };
  const targets = mod.factoryResetTargets(ctx);
  assert.ok(Array.isArray(targets));
  assert.ok(targets.length >= 5);
});
