/**
 * Main Electron — déclaration marque + sandbox H2 via bootKernel.
 * Orchestration OS = @creezio/app-runtime (P&P natif).
 * Opt-out shell : CREEZIO_DESKTOP_SHELL=window
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startBrandDesktop } from "@creezio/app-runtime";
import { demobrandManifest as manifest } from "./app-manifest.js";
import { verticalSlot } from "./vertical-slot.js";
import { createDemobrandSandbox } from "./sandbox-runtime.js";
import { setDemobrandProductHubStore } from "./product-hub-stub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

startBrandDesktop({
  manifest,
  electronDirname: __dirname,
  bootKernel: (opts) => {
    const sandbox = createDemobrandSandbox({
      userDataRoot: opts.userDataDir,
    });
    setDemobrandProductHubStore(sandbox.productHub);
    return {
      api: sandbox.api,
      runtime: sandbox.runtime,
      close: () => sandbox.close(),
    };
  },
  navItems: verticalSlot.items,
  desktopShell:
    process.env.CREEZIO_DESKTOP_SHELL === "window" ? "window" : "runtime",
  // Sandbox H2 gère déjà plugins/product-hub ; host-stack plugins suit le
  // défaut kit (ON — kill-switch CREEZIO_PLUGINS=0).
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
