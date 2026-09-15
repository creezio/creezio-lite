/**
 * Runner tests plugins (`node --test`) — port TF gold plugin-test-runner.ts (N1).
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { assignPluginEnv, getPluginHostBindings } from "./brand-bindings.js";
import { discoverPlugins } from "./runtime.js";

export type PluginTestResult = {
  ok: boolean;
  pluginId: string;
  files: string[];
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
};

function safeTestFiles(pluginDir: string): {
  files: string[];
  timeoutMs: number;
} {
  const testsDir = path.join(pluginDir, "tests");
  let timeoutMs = 30_000;
  let configured: string[] = [];
  const manifestPath = path.join(pluginDir, "test-manifest.json");
  if (fs.existsSync(manifestPath)) {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      tests?: string[];
      timeoutMs?: number;
    };
    configured = Array.isArray(parsed.tests) ? parsed.tests.map(String) : [];
    if (Number.isFinite(parsed.timeoutMs)) {
      timeoutMs = Math.min(120_000, Math.max(1_000, Number(parsed.timeoutMs)));
    }
  } else if (fs.existsSync(testsDir)) {
    configured = fs
      .readdirSync(testsDir)
      .filter((name) => name.endsWith(".test.mjs"))
      .map((name) => `tests/${name}`);
  }
  const files = configured.map((relative) => {
    if (!/^tests\/[A-Za-z0-9_.-]+\.test\.mjs$/.test(relative)) {
      throw new Error(`chemin de test refusé: ${relative}`);
    }
    const absolute = path.resolve(pluginDir, relative);
    if (
      !absolute.startsWith(`${path.resolve(pluginDir)}${path.sep}`) ||
      !fs.existsSync(absolute)
    ) {
      throw new Error(`test introuvable: ${relative}`);
    }
    return absolute;
  });
  return { files, timeoutMs };
}

export async function runPluginTests(
  pluginId: string,
): Promise<PluginTestResult> {
  const bindings = getPluginHostBindings();
  const plugin = discoverPlugins().find((row) => row.manifest.id === pluginId);
  if (!plugin || plugin.error) {
    throw new Error(plugin?.error || "plugin introuvable");
  }
  const { files, timeoutMs } = safeTestFiles(plugin.dir);
  if (!files.length) {
    return {
      ok: true,
      pluginId,
      files: [],
      exitCode: 0,
      timedOut: false,
      stdout: "Aucun test déclaré.",
      stderr: "",
      durationMs: 0,
    };
  }
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      NODE_ENV: "test",
    };
    assignPluginEnv(env, bindings, "PLUGIN_ID", pluginId);
    const child = spawn(bindings.nodeBinary(), ["--test", ...files], {
      cwd: plugin.dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: Buffer) =>
      (current + chunk.toString("utf8")).slice(-256_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        pluginId,
        files: files.map((file) => path.relative(plugin.dir, file)),
        exitCode,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}
