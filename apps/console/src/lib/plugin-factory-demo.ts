/**
 * Console ops — fabrique C3 persistée (SQLite Product Hub + plugins dir).
 * Sessions survivent au redémarrage ; scaffold réel (schema/api/mcp).
 */

import fs from "node:fs";
import path from "node:path";
import {
  createConversationalPluginFactory,
  createFsPluginScaffoldAdapters,
  createOptionalLlmPrdDrafter,
  createSqliteProductHubStore,
  type FactorySessionSnapshot,
  type SqliteProductHubStore,
} from "@creezio/product-hub";

function kitRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const marker = path.join(dir, "packages", "product-hub", "package.json");
    if (fs.existsSync(marker)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "../..");
}

export function pluginFactoryDataDir(): string {
  return (
    process.env.CREEZIO_PLUGIN_FACTORY_DATA_DIR ||
    path.join(kitRoot(), "var", "plugin-factory")
  );
}

export function pluginFactoryCoreDbPath(): string {
  return (
    process.env.CREEZIO_PLUGIN_FACTORY_CORE_DB ||
    path.join(pluginFactoryDataDir(), "console-core.db")
  );
}

export function pluginFactoryPluginsDir(): string {
  return (
    process.env.CREEZIO_PLUGIN_FACTORY_PLUGINS_DIR ||
    path.join(pluginFactoryDataDir(), "plugins")
  );
}

/** @deprecated — sessions vivent dans SQLite ; chemin conservé pour compat API. */
export function pluginFactorySessionsPath(): string {
  return pluginFactoryCoreDbPath();
}

type FactoryBundle = {
  factory: ReturnType<typeof createConversationalPluginFactory>;
  store: SqliteProductHubStore;
  pluginsDir: string;
  coreDbPath: string;
};

let bundle: FactoryBundle | null = null;

function getBundle(): FactoryBundle {
  if (bundle) return bundle;
  const coreDbPath = pluginFactoryCoreDbPath();
  const pluginsDir = pluginFactoryPluginsDir();
  fs.mkdirSync(path.dirname(coreDbPath), { recursive: true });
  fs.mkdirSync(pluginsDir, { recursive: true });
  const store = createSqliteProductHubStore({
    coreDbPath,
    conversationPrefix: "console",
  });
  const fsAdapters = createFsPluginScaffoldAdapters(pluginsDir);
  const factory = createConversationalPluginFactory({
    store,
    draftPrd: createOptionalLlmPrdDrafter(),
    scaffoldPlugin: (i) => fsAdapters.scaffoldPlugin(i),
    writePluginFiles: (id, files) => fsAdapters.writePluginFiles(id, files),
    installRuntime: () => ({ dbOpened: true }),
  });
  bundle = { factory, store, pluginsDir, coreDbPath };
  return bundle;
}

export function listFactorySessionsSnapshot(): {
  updatedAt: string;
  sessions: FactorySessionSnapshot[];
  filePath: string;
  coreDbPath: string;
  pluginsDir: string;
  persisted: true;
} {
  const { factory, pluginsDir, coreDbPath } = getBundle();
  return {
    updatedAt: new Date().toISOString(),
    sessions: factory.listSessions(),
    filePath: coreDbPath,
    coreDbPath,
    pluginsDir,
    persisted: true,
  };
}

export async function runFactoryDemo(input: {
  text: string;
  name?: string;
  approve?: boolean;
  materialize?: boolean;
}): Promise<{
  session: FactorySessionSnapshot;
  materialize?: unknown;
  pluginsDir: string;
  coreDbPath: string;
}> {
  const { factory, pluginsDir, coreDbPath } = getBundle();
  let session = await factory.submitIntention({
    text: input.text,
    name: input.name,
  });

  if (session.phase === "clarification_required" && session.openClarification) {
    session = await factory.answerClarifications({
      productId: session.productId,
      clarificationId: session.openClarification.id,
      answers: {
        users: "équipe ops console",
        data_source: "APIs natives demobrand",
        ui_kind: "single",
      },
    });
  }

  if (input.approve !== false && session.phase === "awaiting_approval") {
    session = factory.approvePrd({
      productId: session.productId,
      userId: "console-ops",
    });
  }

  let materialize: unknown;
  if (input.materialize !== false && session.phase === "ready_to_materialize") {
    const result = await factory.materialize({
      productId: session.productId,
      actor: { isOwner: true, orgId: "org-console", userId: "console-ops" },
      pluginId: session.suggestedPluginId || undefined,
    });
    materialize = result;
    if (result.ok) session = result.session;
  }

  return { session, materialize, pluginsDir, coreDbPath };
}
