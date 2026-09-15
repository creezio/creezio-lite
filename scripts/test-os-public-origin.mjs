#!/usr/bin/env node
/**
 * Gate OS — public-origin / cookies Secure (port TF2 test:public-origin).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configureShellUiBrand,
  isLoopbackHost,
  resolveCookieSecure,
  resolvePublicOrigin,
} from "../packages/shell-ui/dist/index.js";

configureShellUiBrand({
  desktopApiGlobal: "demoDesktop",
  publicHostSuffix: "tempoflow.fr",
  titlebarDragClass: "titlebar-drag",
  titlebarNoDragClass: "titlebar-no-drag",
  apiKeyPrefix: "demo_live_",
  productName: "Demo",
});

function headers(map) {
  return {
    get(name) {
      const v = map[name.toLowerCase()];
      return v == null ? null : String(v);
    },
  };
}

function loginLocation(hdrs, nextPath, env = {}) {
  const { origin } = resolvePublicOrigin(hdrs, {
    fallbackUrl: "http://127.0.0.1:18790/",
    appPublicUrl: env.APP_PUBLIC_URL ?? null,
    appBaseUrl: env.APP_BASE_URL ?? "http://127.0.0.1:18790",
  });
  const url = new URL("/login", origin);
  if (nextPath) url.searchParams.set("next", nextPath);
  return url.toString();
}

test("public-origin.isLoopbackHost", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("127.0.0.1:18790"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("localhost:18790"), true);
  assert.equal(isLoopbackHost("[::1]:18790"), true);
  assert.equal(isLoopbackHost("demo.tempoflow.fr"), false);
});

test("public-origin.tunnel X-Forwarded → https public", () => {
  const loc = loginLocation(
    headers({
      host: "localhost:18790",
      "x-forwarded-host": "demo.tempoflow.fr",
      "x-forwarded-proto": "https",
      "cf-connecting-ip": "1.2.3.4",
    }),
    "/",
    { APP_BASE_URL: "http://127.0.0.1:18790" },
  );
  assert.equal(loc, "https://demo.tempoflow.fr/login?next=%2F");
  assert.doesNotMatch(loc, /localhost|127\.0\.0\.1/i);
});

test("public-origin.host public", () => {
  const r = resolvePublicOrigin(
    headers({
      host: "demo.tempoflow.fr",
      "x-forwarded-proto": "https",
    }),
    { appBaseUrl: "http://127.0.0.1:18790" },
  );
  assert.equal(r.origin, "https://demo.tempoflow.fr");
  assert.equal(r.source, "host");
});

test("public-origin.loopback + CF + APP_PUBLIC_URL", () => {
  const loc = loginLocation(
    headers({
      host: "127.0.0.1:18790",
      "x-forwarded-proto": "https",
      "cf-ray": "abc",
    }),
    "/dashboard",
    {
      APP_PUBLIC_URL: "https://demo.tempoflow.fr",
      APP_BASE_URL: "http://127.0.0.1:18790",
    },
  );
  assert.equal(loc, "https://demo.tempoflow.fr/login?next=%2Fdashboard");
});

test("public-origin.electron local sans tunnel", () => {
  const loc = loginLocation(
    headers({ host: "127.0.0.1:18790" }),
    "/",
    {
      APP_PUBLIC_URL: "https://demo.tempoflow.fr",
      APP_BASE_URL: "http://127.0.0.1:18790",
    },
  );
  assert.match(loc, /^http:\/\/127\.0\.0\.1:18790\/login/);
  assert.doesNotMatch(loc, /^https:\/\/demo\./);
});

test("public-origin.cookies Secure", () => {
  assert.equal(
    resolveCookieSecure(
      headers({
        host: "demo.tempoflow.fr",
        "x-forwarded-proto": "https",
      }),
    ),
    true,
  );
  assert.equal(
    resolveCookieSecure(headers({ host: "127.0.0.1:18790" }), {
      appBaseUrl: "http://127.0.0.1:18790",
    }),
    false,
  );
});
