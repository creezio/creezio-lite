#!/usr/bin/env node
/**
 * Gate OS — surface `/api/v1/email` montée par app-runtime (Worker inbound).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("email.surface — mount + handlesPath", async () => {
  const mod = await import(
    path.join(root, "packages/app-runtime/dist/mount-brand-email-surface.js")
  );
  assert.equal(typeof mod.mountBrandEmailSurface, "function");
  assert.equal(typeof mod.emailSurfaceHandlesPath, "function");
  assert.equal(mod.emailSurfaceHandlesPath("/api/v1/email"), true);
  assert.equal(mod.emailSurfaceHandlesPath("/api/v1/email/inbound"), true);
  assert.equal(mod.emailSurfaceHandlesPath("/api/v1/email/meta"), true);
  assert.equal(mod.emailSurfaceHandlesPath("/api/v1/platform/platform-mails"), false);

  const prevDisabled = process.env.AUTH_DISABLED;
  process.env.AUTH_DISABLED = "1";
  try {
    const { app } = mod.mountBrandEmailSurface({
      getStore: () => null,
    });
    const meta = await app.request("http://local/api/v1/email/meta");
    assert.equal(meta.status, 200);
    const json = await meta.json();
    assert.equal(json.ready, false);
  } finally {
    if (prevDisabled === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prevDisabled;
  }

  // Sans session ni AUTH_DISABLED : inbox refusée (inbound reste hors garde session).
  {
    delete process.env.AUTH_DISABLED;
    const { app } = mod.mountBrandEmailSurface({ getStore: () => null });
    const denied = await app.request("http://local/api/v1/email/meta");
    assert.equal(denied.status, 401);
    const body = await denied.json();
    assert.equal(body.error, "Non authentifié");
  }

  const listenSrc = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/listen-brand-os-http.ts"),
    "utf8",
  );
  assert.match(listenSrc, /emailSurfaceHandlesPath/);
  assert.match(listenSrc, /mountBrandEmailSurface/);
  const emailSrc = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/mount-brand-email-surface.ts"),
    "utf8",
  );
  assert.match(emailSrc, /Non authentifié/);
  assert.match(emailSrc, /inbound/);
});