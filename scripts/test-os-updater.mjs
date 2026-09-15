#!/usr/bin/env node
/**
 * Gate OS — reduceur updater (port TF2 test:updater), sans Electron.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialUpdateStatus,
  reduceUpdateEvent,
} from "../packages/platform-core/dist/index.js";
import {
  getUpdaterStatus,
  reduceUpdateEvent as shellReduce,
} from "../packages/electron-shell/dist/index.js";

test("updater.initial — disabled par défaut", () => {
  const st = initialUpdateStatus("1.0.0");
  assert.equal(st.state, "disabled");
  assert.equal(st.currentVersion, "1.0.0");
  assert.equal(st.updateAvailable, false);
});

test("updater.reduce — checking → available → progress → ready", () => {
  let st = initialUpdateStatus("1.0.0");
  st = reduceUpdateEvent(st, { type: "idle" });
  assert.equal(st.state, "idle");
  st = reduceUpdateEvent(st, { type: "checking" });
  assert.equal(st.state, "checking");
  st = reduceUpdateEvent(st, { type: "available", version: "1.1.0" });
  assert.equal(st.state, "available");
  assert.equal(st.availableVersion, "1.1.0");
  assert.equal(st.updateAvailable, true);
  st = reduceUpdateEvent(st, {
    type: "progress",
    percent: 42,
    bytesPerSecond: 1000,
    transferred: 4200,
    total: 10000,
  });
  assert.equal(st.state, "downloading");
  assert.equal(st.percent, 42);
  st = reduceUpdateEvent(st, { type: "downloaded", version: "1.1.0" });
  assert.equal(st.state, "ready");
  assert.equal(st.percent, 100);
});

test("updater.reduce — not-available / error / disabled", () => {
  let st = initialUpdateStatus("2.0.0");
  st = reduceUpdateEvent(st, { type: "checking" });
  st = reduceUpdateEvent(st, { type: "not-available" });
  assert.equal(st.state, "not-available");
  assert.equal(st.updateAvailable, false);
  st = reduceUpdateEvent(st, { type: "error", message: "network" });
  assert.equal(st.state, "error");
  assert.equal(st.error, "network");
  st = reduceUpdateEvent(st, { type: "disabled", reason: "dev" });
  assert.equal(st.state, "disabled");
  assert.equal(st.error, "dev");
});

test("updater.shell — re-export + getUpdaterStatus", () => {
  assert.equal(typeof shellReduce, "function");
  const status = getUpdaterStatus();
  assert.ok(status && typeof status.state === "string");
  const next = shellReduce(status, { type: "checking" });
  assert.equal(next.state, "checking");
});
