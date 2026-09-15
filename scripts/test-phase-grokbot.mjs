/**
 * Gate : @creezio/grokbot conforme au patron « module natif hybride »
 * (docs/adr/ADR-module-natif-hybride.md) + contrat API Cursor Cloud
 * Agents v1 (cursor.com/docs/cloud-agent/api/endpoints).
 *
 * Verrouille : exports kit (migrations + client + mount), schéma
 * grokbot_settings / grokbot_agents, token masqué (jamais en clair),
 * création d'agent (normalisation prompt/repo/modèle + Bearer), miroir
 * local, runs (follow-up, cancel, unarchive), cache repositories
 * (rate limit, refresh, 429), usage / artifacts passthrough, split UI
 * launch/usage vs runs (poll ciblé agent ouvert, pas GET /repositories).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages/grokbot/dist/index.js");

async function loadDist() {
  assert.ok(
    fs.existsSync(DIST),
    "dist @creezio/grokbot manquant — lancer npm run build -w @creezio/grokbot",
  );
  return import(pathToFileURL(DIST).href);
}

async function createDb(migrations) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  for (const m of migrations) db.exec(m.sql);
  return db;
}

function call(mount, { method, subPath, body, query, db }) {
  return mount.handle({
    req: {
      method,
      path: `/api/v1/modules/grokbot/${subPath}`,
      body,
      query,
    },
    space: "module",
    mountId: "grokbot",
    subPath,
    db,
  });
}

const AGENT_ID = "bc-00000000-0000-0000-0000-000000000001";
const RUN_ID = "run-00000000-0000-0000-0000-000000000001";

/** Fake fetch API Cursor : enregistre les appels, sert la surface v1. */
function createFakeCursorApi() {
  const calls = [];
  let busy = false;
  let reposStatus = 200;
  const agent = {
    id: AGENT_ID,
    name: "Ajouter un README",
    status: "ACTIVE",
    env: { type: "cloud" },
    repos: [{ url: "https://github.com/exemple/depot", startingRef: "main" }],
    url: `https://cursor.com/agents/${AGENT_ID}`,
    createdAt: "2026-04-13T18:30:00.000Z",
    updatedAt: "2026-04-13T18:30:00.000Z",
    latestRunId: RUN_ID,
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const respond = (status, body) => ({ status, json: async () => body });
    const u = new URL(url);
    const p = u.pathname;
    if (p === "/v1/me") {
      return respond(200, {
        apiKeyName: "Clé test",
        userEmail: "dev@exemple.fr",
        userId: 42,
      });
    }
    if (p === "/v1/models") {
      return respond(200, { items: [{ id: "composer-2", displayName: "Composer 2" }] });
    }
    if (p === "/v1/repositories") {
      if (reposStatus !== 200) {
        return respond(reposStatus, { error: "rate_limited" });
      }
      return respond(200, {
        items: [
          {
            url: "https://github.com/exemple/depot",
            owner: "exemple",
            name: "depot",
          },
        ],
      });
    }
    if (p === "/v1/agents" && init.method === "POST") {
      return respond(200, {
        agent,
        run: { id: RUN_ID, agentId: AGENT_ID, status: "CREATING" },
      });
    }
    if (p === "/v1/agents" && init.method === "GET") {
      return respond(200, { items: [agent] });
    }
    if (p === `/v1/agents/${AGENT_ID}` && init.method === "GET") {
      return respond(200, agent);
    }
    if (p === `/v1/agents/${AGENT_ID}/runs` && init.method === "POST") {
      if (busy) {
        return respond(409, { error: "agent_busy" });
      }
      busy = true;
      return respond(200, {
        run: { id: "run-2", agentId: AGENT_ID, status: "CREATING" },
      });
    }
    if (p === `/v1/agents/${AGENT_ID}/runs` && init.method === "GET") {
      return respond(200, {
        items: [{ id: RUN_ID, agentId: AGENT_ID, status: "RUNNING" }],
      });
    }
    if (p === `/v1/agents/${AGENT_ID}/runs/${RUN_ID}` && init.method === "GET") {
      return respond(200, {
        id: RUN_ID,
        agentId: AGENT_ID,
        status: "FINISHED",
        durationMs: 12357,
        result: "README ajouté.",
        git: {
          branches: [
            {
              repoUrl: "github.com/exemple/depot",
              branch: "cursor/add-readme-a1b2",
              prUrl: "https://github.com/exemple/depot/pull/123",
            },
          ],
        },
      });
    }
    if (p === `/v1/agents/${AGENT_ID}/runs/${RUN_ID}/cancel`) {
      busy = false;
      return respond(200, { id: RUN_ID });
    }
    if (p === `/v1/agents/${AGENT_ID}/usage`) {
      return respond(200, {
        totalUsage: { totalTokens: 76390 },
        runs: [{ id: RUN_ID, usage: { totalTokens: 76390 } }],
      });
    }
    if (p === `/v1/agents/${AGENT_ID}/artifacts` ) {
      return respond(200, {
        items: [{ path: "artifacts/capture.png", sizeBytes: 12345 }],
      });
    }
    if (p === `/v1/agents/${AGENT_ID}/artifacts/download`) {
      return respond(200, {
        url: "https://exemple-s3/presigned",
        expiresAt: "2026-04-13T19:00:00.000Z",
      });
    }
    if (p === `/v1/agents/${AGENT_ID}/archive`) {
      return respond(200, { id: AGENT_ID });
    }
    if (p === `/v1/agents/${AGENT_ID}/unarchive`) {
      return respond(200, { id: AGENT_ID });
    }
    return respond(404, { error: "not_found" });
  };
  return {
    calls,
    fetchImpl,
    setBusy: (v) => (busy = v),
    setReposStatus: (s) => {
      reposStatus = s;
    },
  };
}

test("grokbot : exports kit + migrations", async () => {
  const mod = await loadDist();
  assert.equal(typeof mod.grokbotMigrations, "function");
  assert.equal(typeof mod.createGrokbotMount, "function");
  assert.equal(typeof mod.createCursorAgentsClient, "function");
  assert.equal(typeof mod.mergeGrokbotConfig, "function");
  assert.equal(mod.GROKBOT_DEFAULT_API_BASE_URL, "https://api.cursor.com");

  const migs = mod.grokbotMigrations();
  assert.equal(migs.length, 1);
  assert.equal(migs[0].id, "grokbot_001_core");
  assert.match(migs[0].sql, /grokbot_settings/);
  assert.match(migs[0].sql, /grokbot_agents/);
});

test("grokbot : mount 503 sans db + options permission", async () => {
  const { createGrokbotMount } = await loadDist();
  const mount = createGrokbotMount();
  assert.equal(mount.dbLayer, "brand");
  assert.ok(mount.accessJustification, "sans permission → justification");
  assert.ok(Array.isArray(mount.operations) && mount.operations.length > 0);
  const res = await call(mount, { method: "GET", subPath: "config" });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "db_unavailable");

  const guarded = createGrokbotMount({ permission: "nav.grokbot" });
  assert.equal(guarded.permission, "nav.grokbot");
  assert.equal(guarded.accessJustification, undefined);
});

test("grokbot : config PUT → token masqué → status connecté", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.grokbotMigrations());
  const fake = createFakeCursorApi();
  const mount = mod.createGrokbotMount({ fetchImpl: fake.fetchImpl });

  // Sans token : status = non connecté (200, pas d'erreur).
  const s0 = await call(mount, { method: "GET", subPath: "status", db });
  assert.equal(s0.status, 200);
  assert.equal(s0.body.connected, false);

  const put = await call(mount, {
    method: "PUT",
    subPath: "config",
    db,
    body: { apiKey: "key_1234567890secret", defaultRepoUrl: "https://github.com/exemple/depot" },
  });
  assert.equal(put.status, 200);
  // Token jamais renvoyé en clair.
  assert.notEqual(put.body.config.apiKey, "key_1234567890secret");
  assert.match(put.body.config.apiKey, /…/);

  const status = await call(mount, { method: "GET", subPath: "status", db });
  assert.equal(status.body.connected, true);
  assert.equal(status.body.userEmail, "dev@exemple.fr");
  // L'appel amont portait le Bearer.
  assert.equal(
    fake.calls.at(-1).init.headers.authorization,
    "Bearer key_1234567890secret",
  );

  // Agents sans token (DB vierge) → miroir local avec warning (pas de crash).
  const emptyDb = await createDb(mod.grokbotMigrations());
  const noKey = mod.createGrokbotMount();
  const list = await call(noKey, { method: "GET", subPath: "agents", db: emptyDb });
  assert.equal(list.status, 200);
  assert.equal(list.body.source, "local");
  assert.equal(list.body.warning, "cursor_api_key_missing");
});

test("grokbot : create agent → miroir local → runs / cancel / usage / artifacts", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.grokbotMigrations());
  const fake = createFakeCursorApi();
  const mount = mod.createGrokbotMount({
    defaults: { apiKey: "key_test", defaultModelId: "composer-2" },
    fetchImpl: fake.fetchImpl,
  });

  // Prompt requis.
  const bad = await call(mount, { method: "POST", subPath: "agents", db, body: {} });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "prompt_text_required");

  // Forme plate { text, repoUrl } normalisée vers l'API v1.
  const created = await call(mount, {
    method: "POST",
    subPath: "agents",
    db,
    body: {
      text: "Ajouter un README",
      repoUrl: "https://github.com/exemple/depot",
      ref: "main",
      autoCreatePR: true,
      mode: "plan",
    },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.agent.id, AGENT_ID);
  assert.equal(created.body.run.status, "CREATING");
  const createCall = fake.calls.find(
    (c) => c.init.method === "POST" && c.url.endsWith("/v1/agents"),
  );
  const sent = JSON.parse(createCall.init.body);
  assert.equal(sent.prompt.text, "Ajouter un README");
  assert.deepEqual(sent.repos, [
    { url: "https://github.com/exemple/depot", startingRef: "main" },
  ]);
  assert.equal(sent.model.id, "composer-2", "defaultModelId appliqué");
  assert.equal(sent.autoCreatePR, true);
  assert.equal(sent.mode, "plan");

  // Miroir local : prompt conservé.
  const local = await call(mount, {
    method: "GET",
    subPath: "agents",
    db,
    query: { source: "local" },
  });
  assert.equal(local.body.items.length, 1);
  assert.equal(local.body.items[0].id, AGENT_ID);
  assert.equal(local.body.items[0].prompt, "Ajouter un README");

  // Liste distante : upsert sans perdre le prompt (COALESCE).
  const remote = await call(mount, { method: "GET", subPath: "agents", db });
  assert.equal(remote.body.source, "remote");
  const local2 = await call(mount, {
    method: "GET",
    subPath: "agents",
    db,
    query: { source: "local" },
  });
  assert.equal(local2.body.items[0].prompt, "Ajouter un README");

  // Follow-up run.
  const run = await call(mount, {
    method: "POST",
    subPath: `agents/${AGENT_ID}/runs`,
    db,
    body: { text: "Ajoute aussi la section dépannage" },
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.data.run.id, "run-2");

  // Agent occupé → 409 agent_busy passthrough.
  const busy = await call(mount, {
    method: "POST",
    subPath: `agents/${AGENT_ID}/runs`,
    db,
    body: { text: "encore" },
  });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error, "cursor_api_error");
  assert.equal(busy.body.detail.error, "agent_busy");

  // Get run terminal (résultat + branches).
  const gotRun = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/runs/${RUN_ID}`,
    db,
  });
  assert.equal(gotRun.body.data.status, "FINISHED");
  assert.equal(gotRun.body.data.result, "README ajouté.");

  // Cancel.
  const cancel = await call(mount, {
    method: "POST",
    subPath: `agents/${AGENT_ID}/runs/${RUN_ID}/cancel`,
    db,
  });
  assert.equal(cancel.status, 200);

  // Usage + artifacts + download présigné.
  const usage = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/usage`,
    db,
  });
  assert.equal(usage.body.data.totalUsage.totalTokens, 76390);
  const artifacts = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/artifacts`,
    db,
  });
  assert.equal(artifacts.body.data.items[0].path, "artifacts/capture.png");
  const dl = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/artifacts/download`,
    db,
    query: { path: "artifacts/capture.png" },
  });
  assert.equal(dl.body.data.url, "https://exemple-s3/presigned");

  // Archive → statut local mis à jour.
  const archive = await call(mount, {
    method: "POST",
    subPath: `agents/${AGENT_ID}/archive`,
    db,
  });
  assert.equal(archive.status, 200);
  const local3 = await call(mount, {
    method: "GET",
    subPath: "agents",
    db,
    query: { source: "local" },
  });
  assert.equal(local3.body.items[0].status, "ARCHIVED");
});

test("grokbot : cache repositories (rate limit amont 1 req/min)", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.grokbotMigrations());
  const fake = createFakeCursorApi();
  const mount = mod.createGrokbotMount({
    defaults: { apiKey: "key_test" },
    fetchImpl: fake.fetchImpl,
  });

  const r1 = await call(mount, { method: "GET", subPath: "repositories", db });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.cached, false);
  assert.equal(r1.body.data.items[0].owner, "exemple");
  assert.equal(r1.body.data.items[0].name, "depot");
  const upstreamCalls = () =>
    fake.calls.filter((c) => c.url.includes("/v1/repositories")).length;
  assert.equal(upstreamCalls(), 1);

  // Deuxième appel : servi depuis le cache DB, zéro appel amont.
  const r2 = await call(mount, { method: "GET", subPath: "repositories", db });
  assert.equal(r2.body.cached, true);
  assert.equal(r2.body.data.items[0].url, "https://github.com/exemple/depot");
  assert.equal(upstreamCalls(), 1);

  // ?refresh=1 force l'appel amont.
  const r3 = await call(mount, {
    method: "GET",
    subPath: "repositories",
    db,
    query: { refresh: "1" },
  });
  assert.equal(r3.body.cached, false);
  assert.equal(upstreamCalls(), 2);

  // Amont 429 + cache : on sert le cache (stale), sans perdre la liste.
  fake.setReposStatus(429);
  const r4 = await call(mount, {
    method: "GET",
    subPath: "repositories",
    db,
    query: { refresh: "1" },
  });
  assert.equal(r4.status, 200);
  assert.equal(r4.body.cached, true);
  assert.equal(r4.body.stale, true);
  assert.equal(r4.body.data.items[0].name, "depot");
});

test("grokbot : GET repositories 429 sans cache = passthrough", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.grokbotMigrations());
  const fake = createFakeCursorApi();
  fake.setReposStatus(429);
  const mount = mod.createGrokbotMount({
    defaults: { apiKey: "key_test" },
    fetchImpl: fake.fetchImpl,
  });
  const res = await call(mount, { method: "GET", subPath: "repositories", db });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, "cursor_api_error");
});

test("grokbot : GET usage / artifacts / download passthrough mock", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.grokbotMigrations());
  const fake = createFakeCursorApi();
  const mount = mod.createGrokbotMount({
    defaults: { apiKey: "key_test" },
    fetchImpl: fake.fetchImpl,
  });

  const usage = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/usage`,
    db,
  });
  assert.equal(usage.status, 200);
  assert.equal(usage.body.ok, true);
  assert.equal(usage.body.data.totalUsage.totalTokens, 76390);
  assert.equal(usage.body.data.runs[0].id, RUN_ID);

  const artifacts = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/artifacts`,
    db,
  });
  assert.equal(artifacts.status, 200);
  assert.equal(artifacts.body.data.items[0].path, "artifacts/capture.png");
  assert.equal(artifacts.body.data.items[0].sizeBytes, 12345);

  const dl = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/artifacts/download`,
    db,
    query: { path: "artifacts/capture.png" },
  });
  assert.equal(dl.status, 200);
  assert.equal(dl.body.data.url, "https://exemple-s3/presigned");
  const dlCall = fake.calls.find((c) => c.url.includes("/artifacts/download"));
  assert.ok(dlCall.url.includes("path=artifacts%2Fcapture.png"));
  assert.ok(
    !JSON.stringify(dl.body).includes("key_test"),
    "le token Cursor ne doit pas fuiter dans le body download",
  );

  const missingPath = await call(mount, {
    method: "GET",
    subPath: `agents/${AGENT_ID}/artifacts/download`,
    db,
  });
  assert.equal(missingPath.status, 400);
  assert.equal(missingPath.body.error, "path_required");
});

test("grokbot : POST unarchive + POST cancel (mock)", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.grokbotMigrations());
  const fake = createFakeCursorApi();
  const mount = mod.createGrokbotMount({
    defaults: { apiKey: "key_test" },
    fetchImpl: fake.fetchImpl,
  });

  const created = await call(mount, {
    method: "POST",
    subPath: "agents",
    db,
    body: { text: "Ajouter un README", repoUrl: "https://github.com/exemple/depot" },
  });
  assert.equal(created.status, 200);

  const archive = await call(mount, {
    method: "POST",
    subPath: `agents/${AGENT_ID}/archive`,
    db,
  });
  assert.equal(archive.status, 200);
  const afterArchive = await call(mount, {
    method: "GET",
    subPath: "agents",
    db,
    query: { source: "local" },
  });
  assert.equal(afterArchive.body.items[0].status, "ARCHIVED");

  const unarchive = await call(mount, {
    method: "POST",
    subPath: `agents/${AGENT_ID}/unarchive`,
    db,
  });
  assert.equal(unarchive.status, 200);
  assert.equal(unarchive.body.ok, true);
  assert.equal(unarchive.body.id, AGENT_ID);
  const unarchiveCall = fake.calls.find((c) =>
    String(c.url).includes(`/v1/agents/${AGENT_ID}/unarchive`),
  );
  assert.ok(unarchiveCall, "POST unarchive doit atteindre l'amont");
  assert.equal(unarchiveCall.init.method, "POST");
  const afterUnarchive = await call(mount, {
    method: "GET",
    subPath: "agents",
    db,
    query: { source: "local" },
  });
  assert.equal(afterUnarchive.body.items[0].status, "IDLE");

  const cancel = await call(mount, {
    method: "POST",
    subPath: `agents/${AGENT_ID}/runs/${RUN_ID}/cancel`,
    db,
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.ok, true);
  const cancelCall = fake.calls.find((c) =>
    String(c.url).includes(`/v1/agents/${AGENT_ID}/runs/${RUN_ID}/cancel`),
  );
  assert.ok(cancelCall, "POST cancel doit atteindre l'amont");
  assert.equal(cancelCall.init.method, "POST");
  assert.ok(
    !JSON.stringify(cancel.body).includes("key_test"),
    "le token Cursor ne doit pas fuiter dans le body cancel",
  );
});

test("grokbot : UI split launch/usage vs runs — pas de poll repositories", () => {
  const ui = path.join(ROOT, "packages/grokbot/ui");
  const read = (name) => fs.readFileSync(path.join(ui, name), "utf8");
  const strip = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const client = read("grokbot-client.tsx");
  const launch = read("grokbot-launch-form.tsx");
  const usage = read("grokbot-usage-artifacts.tsx");
  const runs = read("grokbot-agent-runs.tsx");
  const clientCode = strip(client);
  const runsCode = strip(runs);

  assert.match(client, /GrokbotLaunchForm/);
  assert.match(client, /GrokbotUsageArtifacts/);
  assert.match(client, /GrokbotAgentRuns/);

  assert.match(launch, /SelectItem/);
  assert.match(launch, /Textarea/);
  assert.doesNotMatch(launch, /<select[\s>]/);
  assert.doesNotMatch(launch, /<textarea[\s>]/);
  assert.match(launch, /\/repositories/);
  assert.match(launch, /refresh=1/);
  assert.match(launch, /from "sonner"/);
  assert.match(launch, /mode/);
  assert.match(launch, /Rafraîchir les repos/);

  assert.match(usage, /\/usage/);
  assert.match(usage, /\/artifacts/);
  assert.match(usage, /artifacts\/download/);
  assert.match(usage, /from "sonner"/);

  assert.doesNotMatch(clientCode, /fetch\([^)]*\/repositories/);
  assert.doesNotMatch(runsCode, /fetch\([^)]*\/repositories/);
  assert.doesNotMatch(runsCode, /fetch\([^)]*\/models/);
  assert.doesNotMatch(clientCode, /fetch\([^)]*\/models/);

  assert.match(runs, /AlertDialog/);
  assert.match(runs, /Skeleton/);
  assert.match(runs, /Textarea/);
  assert.match(runs, /asChild/);
  assert.match(runs, /unarchive|Désarchiver|onUnarchive/);
  assert.doesNotMatch(runsCode, /<textarea[\s>]/);

  assert.match(client, /GrokbotAgentList/);
  assert.match(client, /LIVE_POLL_MS/);
  assert.match(client, /IDLE_POLL_MS/);
  assert.match(client, /agents\/\$\{encodeURIComponent\(agentId\)\}/);
  assert.match(client, /n'est pas enregistré sur ce serveur/);
  assert.match(client, /cursor_api_key_missing/);
  assert.match(client, /cursor_api_error/);
  assert.doesNotMatch(client, /EventSource|text\/event-stream|\/stream/);
  assert.doesNotMatch(runs, /EventSource|text\/event-stream|\/stream/);

  for (const src of [client, launch, usage, runs].map(strip)) {
    assert.doesNotMatch(src, /api\.cursor\.com/);
    assert.doesNotMatch(src, /Authorization:\s*Bearer/);
  }
});
