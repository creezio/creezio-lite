/**
 * Gate crash-reporter kit — upload configurable + brandId + pending queue.
 * + early-boot logger (fichier dans les 100 ms, fallback exe/tmpdir).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("crash-reporter expose configure + pending + brandId", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/host-runtime/src/crash-reporter.ts"),
    "utf8",
  );
  assert.match(src, /configureCrashReporter/);
  assert.match(src, /flushPendingCrashReports/);
  assert.match(src, /brandId/);
  assert.match(src, /crash-reports/);
  assert.match(src, /pending/);
  assert.match(src, /CREEZIO_CRASH_ENDPOINT/);
});

test("startBrandDesktop configure crash tôt + early-log", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/start-brand-desktop.ts"),
    "utf8",
  );
  assert.match(src, /configureCrashReporter/);
  assert.match(src, /initCrashReporter/);
  assert.match(src, /installGlobalHandlers/);
  assert.match(src, /crashEndpoint/);
  assert.match(src, /CRASH_ENDPOINT/);
  assert.match(src, /initEarlyBootLogger/);
  assert.match(src, /showErrorBox/);
  assert.match(src, /ensureLogsDir/);
});

test("boot-failure dialog mentionne crash-reports", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
    ),
    "utf8",
  );
  assert.match(src, /boot-failure/);
  assert.match(src, /crashReportsDir|crash-reports/);
  assert.match(src, /crashLogHint/);
});

test("prepareDesktopBoot ancre install/data + logs/", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/electron-shell/src/boot.ts"),
    "utf8",
  );
  assert.match(src, /ensureLogsDir/);
  assert.match(src, /resolvePackagedDataDir/);
  assert.match(src, /installDataLayout/);
});

test("startBrandDesktop ancre userData install-dir avant crash-reporter", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/start-brand-desktop.ts"),
    "utf8",
  );
  assert.match(src, /anchorPackagedUserData|resolvePackagedDataDir/);
  assert.match(src, /guessPackagedDataDir/);
});

test("platform-core resolvePackagedDataDir = install/data", () => {
  const coreCjs = path.join(root, "packages/platform-core/dist-cjs/index.js");
  assert.ok(fs.existsSync(coreCjs), coreCjs);
  const core = require(coreCjs);
  const exe = path.join("/opt/fake/TempoFlow-Server", "TempoFlow-Server.exe");
  const dir = core.resolvePackagedDataDir({
    execPath: exe,
    isPackaged: true,
  });
  assert.equal(dir, path.join("/opt/fake/TempoFlow-Server", "data"));
  assert.equal(
    core.resolvePackagedDataDir({ execPath: exe, isPackaged: false }),
    null,
  );
  const appImageDir = core.resolvePackagedDataDir({
    execPath: "/tmp/.mount_xyz/AppRun",
    isPackaged: true,
    env: { APPIMAGE: "/home/u/TempoFlow-Server.AppImage" },
  });
  assert.equal(appImageDir, path.join("/home/u", "data"));

  const fakeInstall = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-inst-"));
  fs.mkdirSync(path.join(fakeInstall, "resources"));
  const fakeExe = path.join(fakeInstall, "TempoFlow-Server.exe");
  fs.writeFileSync(fakeExe, "");
  const guessed = core.guessPackagedDataDir({ execPath: fakeExe });
  assert.equal(guessed, path.join(fakeInstall, "data"));
});

test("initEarlyBootLogger crée le fichier log en <100ms", () => {
  const hostCjs = path.join(root, "packages/host-runtime/dist-cjs/index.js");
  assert.ok(fs.existsSync(hostCjs), `dist-cjs manquant: ${hostCjs}`);
  const host = require(hostCjs);
  assert.equal(typeof host.initEarlyBootLogger, "function");
  assert.equal(typeof host.ensureLogsDir, "function");

  const fakeExeDir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-early-exe-"));
  const fakeExe = path.join(fakeExeDir, "TempoFlow-Server.exe");
  fs.writeFileSync(fakeExe, "");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-early-ud-"));

  const t0 = Date.now();
  const result = host.initEarlyBootLogger({
    basename: "tempoflow3-main",
    userDataDir: userData,
    exePath: fakeExe,
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 100, `early log trop lent: ${elapsed}ms`);
  assert.equal(result.source, "userData");
  assert.ok(result.logFile);
  assert.ok(fs.existsSync(result.logFile), result.logFile);
  const body = fs.readFileSync(result.logFile, "utf8");
  assert.match(body, /\[early\].*source=userData/);

  // Sans userData → fallback exe
  const exeOnly = host.initEarlyBootLogger({
    basename: "tempoflow3-main",
    exePath: fakeExe,
  });
  assert.equal(exeOnly.source, "exe");
  assert.ok(fs.existsSync(exeOnly.logFile));
});
