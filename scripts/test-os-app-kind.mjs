#!/usr/bin/env node
/**
 * appKind client/server — résolution kit (équivalent TF2 test:app-kind).
 * Manifeste sonde = demobrand (toujours dans le monorepo kit).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveAppKind,
  bootBehaviorFor,
  appKindEnvValue,
  userDataDirForAppKind,
} from "../packages/platform-core/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = path.join(ROOT, "apps/demobrand");

test("app-kind resolve client / server / legacy + bootBehavior", async () => {
  assert.equal(resolveAppKind({ env: "client" }), "client");
  assert.equal(resolveAppKind({ env: "server" }), "server");
  assert.equal(resolveAppKind({ env: "" }), "legacy");

  const serverBoot = bootBehaviorFor("server", { mode: "host" });
  assert.equal(serverBoot.allowLocalStack, true);
  assert.equal(serverBoot.forceLocalProfile, true);
  assert.equal(serverBoot.cockpitPath, "/server-cockpit");

  const clientBoot = bootBehaviorFor("client", { mode: "host" });
  assert.ok(clientBoot);

  const build = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.electron.json",
    ],
    {
      encoding: "utf8",
      cwd: DEMO,
      env: {
        ...process.env,
        CREEZIO_KIT_ROOT: ROOT,
        CREEZIO_ROOT: ROOT, // legacy compat (Q8)
        NODE_PATH: path.join(ROOT, "node_modules"),
      },
    },
  );
  assert.equal(build.status, 0, build.stderr);

  const manifestMod = await import(
    pathToFileURL(path.join(DEMO, "build/electron/app-manifest.js")).href,
  );
  const manifestKey = Object.keys(manifestMod).find((k) =>
    k.endsWith("Manifest"),
  );
  const m = manifestMod[manifestKey];
  assert.equal(appKindEnvValue(m, {}), "");
  const udServer = userDataDirForAppKind(m, "server", "/tmp/ud-base");
  const udClient = userDataDirForAppKind(m, "client", "/tmp/ud-base");
  assert.ok(udServer);
  assert.ok(udClient);
  assert.notEqual(udServer, udClient);
  assert.ok(
    String(udServer).includes(m.server.userDataSegment) ||
      String(udServer).includes("Serveur") ||
      String(udServer) !== "/tmp/ud-base",
    `userData server: ${udServer}`,
  );
});
