#!/usr/bin/env node
/**
 * Gate D7 — garde anti-doublon des PR de propagate (`propagate-pr-guard`).
 * Helper pur + mock gh (zéro réseau). Ancré dans propagate-brands.mjs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  bumpBranchName,
  bumpPrTitle,
  pinSpec,
  manifestAtTargetPin,
  decodeGithubFileContent,
  decidePropagateSkip,
  evaluatePropagateGuard,
  interpretCreatePullResponse,
} = await import(new URL("./lib/propagate-pr-guard.mjs", import.meta.url).href);

const VERSION = "0.24.1";
const BRAND = "acme";
const BRANCH = bumpBranchName(VERSION);
const TITLE = bumpPrTitle(VERSION, BRAND);

function pinManifest(spec = `^${VERSION}`) {
  return { dependencies: { "@creezio/platform-core": spec } };
}

function mockGh(routes) {
  const calls = [];
  return {
    calls,
    async request(method, url) {
      calls.push({ method, url });
      const hit = routes.find(
        (r) => r.method === method && (r.url === url || (r.match && r.match(url))),
      );
      if (!hit) return { status: 404, json: { message: "Not Found" } };
      return { status: hit.status, json: hit.json, link: hit.link };
    },
  };
}

test("titre / branche / pin helpers", () => {
  assert.equal(BRANCH, "creezio/kit-bump-0.24.1");
  assert.equal(TITLE, "chore(deps): bump @creezio/* → 0.24.1 [acme]");
  assert.equal(pinSpec(VERSION), "^0.24.1");
  assert.equal(manifestAtTargetPin(pinManifest("^0.24.1"), VERSION), true);
  assert.equal(manifestAtTargetPin(pinManifest("0.24.1"), VERSION), true);
  assert.equal(manifestAtTargetPin(pinManifest("^0.23.0"), VERSION), false);
  assert.equal(manifestAtTargetPin({ dependencies: {} }, VERSION), false);
  const encoded = Buffer.from(JSON.stringify(pinManifest()), "utf8").toString("base64");
  assert.deepEqual(decodeGithubFileContent({ content: encoded, encoding: "base64" }), pinManifest());
});

test("decidePropagateSkip : même titre / même head / pin main / pin PR", () => {
  const base = { version: VERSION, brandId: BRAND, branch: BRANCH, defaultBranch: "main" };
  assert.equal(decidePropagateSkip(base).skip, false);

  const sameTitle = decidePropagateSkip({
    ...base,
    openPrs: [{ number: 72, title: TITLE, html_url: "https://example.test/72", head: { ref: "other" } }],
  });
  assert.equal(sameTitle.skip, true);
  assert.match(sameTitle.reason, /même titre/);

  const sameHead = decidePropagateSkip({
    ...base,
    openPrs: [{ number: 8, title: "autre", html_url: "https://example.test/8", head: { ref: BRANCH } }],
  });
  assert.equal(sameHead.skip, true);
  assert.match(sameHead.reason, /même head/);

  const mainPin = decidePropagateSkip({
    ...base,
    defaultBranchManifest: pinManifest(),
  });
  assert.equal(mainPin.skip, true);
  assert.match(mainPin.reason, /main déjà au pin \^0\.24\.1/);

  const prPin = decidePropagateSkip({
    ...base,
    openPrs: [{ number: 9, title: "wip", head: { ref: "feat" } }],
    openPrManifests: [
      { pr: { number: 9, html_url: "https://example.test/9" }, manifest: pinManifest("0.24.1") },
    ],
  });
  assert.equal(prPin.skip, true);
  assert.match(prPin.reason, /déjà au pin/);
});

test("evaluatePropagateGuard : mock GET pulls + package.json", async () => {
  const encodedMain = Buffer.from(JSON.stringify(pinManifest("^0.23.0")), "utf8").toString("base64");
  const encodedPr = Buffer.from(JSON.stringify(pinManifest()), "utf8").toString("base64");
  const gh = mockGh([
    {
      method: "GET",
      match: (u) => u.startsWith("/repos/creezio/acme/pulls"),
      status: 200,
      json: [{ number: 4, title: "wip", html_url: "https://example.test/4", head: { ref: "wip" } }],
    },
    {
      method: "GET",
      url: "/repos/creezio/acme/contents/package.json?ref=main",
      status: 200,
      json: { content: encodedMain, encoding: "base64" },
    },
    {
      method: "GET",
      url: "/repos/creezio/acme/contents/package.json?ref=wip",
      status: 200,
      json: { content: encodedPr, encoding: "base64" },
    },
  ]);
  const decision = await evaluatePropagateGuard(gh, {
    repo: "creezio/acme",
    version: VERSION,
    brandId: BRAND,
    branch: BRANCH,
    defaultBranch: "main",
  });
  assert.equal(decision.skip, true);
  assert.match(decision.reason, /PR #4 déjà au pin/);
});

test("evaluatePropagateGuard : aucune PR / main pas au pin → ouvrir", async () => {
  const encoded = Buffer.from(JSON.stringify(pinManifest("^0.23.0")), "utf8").toString("base64");
  const gh = mockGh([
    { method: "GET", match: (u) => u.includes("/pulls"), status: 200, json: [] },
    {
      method: "GET",
      match: (u) => u.includes("package.json"),
      status: 200,
      json: { content: encoded, encoding: "base64" },
    },
  ]);
  const decision = await evaluatePropagateGuard(gh, {
    repo: "creezio/acme",
    version: VERSION,
    brandId: BRAND,
    branch: BRANCH,
    defaultBranch: "main",
  });
  assert.equal(decision.skip, false);
});

test("interpretCreatePullResponse : 201 / 422 / autre", () => {
  assert.deepEqual(
    interpretCreatePullResponse(201, { html_url: "https://example.test/pr" }),
    { kind: "created", url: "https://example.test/pr" },
  );
  const skip = interpretCreatePullResponse(422, {
    message: "Validation Failed",
    errors: [{ message: "A pull request already exists" }],
  });
  assert.equal(skip.kind, "skip");
  assert.match(skip.reason, /HTTP 422/);
  const err = interpretCreatePullResponse(500, { message: "boom" });
  assert.equal(err.kind, "error");
  assert.match(err.reason, /500/);
});

test("propagate-brands.mjs consomme la garde (titre/head/pin + 422)", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/propagate-brands.mjs"), "utf8");
  assert.match(src, /propagate-pr-guard\.mjs/);
  assert.match(src, /evaluatePropagateGuard/);
  assert.match(src, /interpretCreatePullResponse/);
  assert.match(src, /HTTP 422|kind === "skip"/);
  assert.doesNotMatch(src, /function bumpManifests/);
});
