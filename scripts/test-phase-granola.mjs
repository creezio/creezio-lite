/**
 * Gate : @creezio/granola conforme au patron « module natif hybride »
 * (docs/adr/ADR-module-natif-hybride.md) + contrat webhook Granola
 * (Standard Webhooks — docs.granola.ai/webhooks).
 *
 * Verrouille : exports kit (migrations + signature + client + mount),
 * schéma granola_settings / granola_events / granola_notes, vérification
 * HMAC fail-closed (signature valide / invalide / rejeu), dédup par
 * event_id, sync note via fetch injecté, config masquée, capture du
 * signing_secret par register-webhook (jamais leaké au client HTTP),
 * proxys remote/* + list/patch/delete webhook-endpoints.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages/granola/dist/index.js");

async function loadDist() {
  assert.ok(
    fs.existsSync(DIST),
    "dist @creezio/granola manquant — lancer npm run build -w @creezio/granola",
  );
  return import(pathToFileURL(DIST).href);
}

async function createDb(migrations) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  for (const m of migrations) db.exec(m.sql);
  return db;
}

function call(mount, { method, subPath, body, rawBody, headers, query, db }) {
  return mount.handle({
    req: {
      method,
      path: `/api/v1/modules/granola/${subPath}`,
      body,
      rawBody,
      headers,
      query,
    },
    space: "module",
    mountId: "granola",
    subPath,
    db,
  });
}

/** Fake fetch API Granola : enregistre les appels, sert notes + endpoints. */
function createFakeGranolaApi() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const respond = (status, body) => ({
      status,
      json: async () => body,
    });
    if (url.includes("/v1/webhook-endpoints")) {
      const idMatch = url.match(/\/v1\/webhook-endpoints\/([^/?]+)/);
      const method = init?.method || "GET";
      if (method === "POST") {
        return respond(201, {
          id: "whe_TESTENDPOINT01",
          object: "webhook_endpoint",
          url: JSON.parse(init.body).url,
          scopes: JSON.parse(init.body).scopes,
          enabled: true,
          signing_secret: "whsec_c2VjcmV0LXRlc3QtZ3Jhbm9sYQ==",
        });
      }
      if (method === "PATCH" && idMatch) {
        const patch = init.body ? JSON.parse(init.body) : {};
        return respond(200, {
          id: decodeURIComponent(idMatch[1]),
          object: "webhook_endpoint",
          enabled: patch.enabled ?? true,
          url:
            patch.url ??
            "https://crm.exemple.fr/api/v1/modules/granola/webhook",
          scopes: patch.scopes ?? ["personal", "public"],
          events: patch.events ?? ["note.generated"],
          signing_secret: "whsec_SHOULD_NOT_LEAK",
        });
      }
      if (method === "DELETE" && idMatch) {
        return respond(200, {
          deleted: true,
          id: decodeURIComponent(idMatch[1]),
        });
      }
      if (method === "GET") {
        return respond(200, {
          webhook_endpoints: [
            {
              id: "whe_TESTENDPOINT01",
              url: "https://crm.exemple.fr/api/v1/modules/granola/webhook",
              scopes: ["personal", "public"],
              events: ["note.generated", "note.edited"],
              enabled: true,
              signing_secret: "whsec_SHOULD_NOT_LEAK",
            },
          ],
        });
      }
    }
    const noteMatch = url.match(/\/v1\/notes\/([^/?]+)(\/transcript)?/);
    if (noteMatch && !noteMatch[2]) {
      const id = decodeURIComponent(noteMatch[1]);
      const body = {
        id,
        summary: "La revue s'est bien passée.",
        owner: { name: "Oat", email: "oat@example.com" },
        created_at: "2026-01-27T15:30:00Z",
        updated_at: "2026-01-27T16:00:00Z",
        folder_id: "fld_A",
      };
      if (id !== "not_KEEP") body.title = "Revue budget";
      if (url.includes("include=transcript")) {
        body.transcript = [{ speaker: "Oat", text: "bonjour (inclus)" }];
      }
      return respond(200, body);
    }
    if (noteMatch && noteMatch[2]) {
      const hasCursor = url.includes("cursor=");
      return respond(200, {
        transcript: [{ text: hasCursor ? "suite" : "bonjour" }],
        next_cursor: hasCursor ? null : "cur_2",
        hasMore: !hasCursor,
      });
    }
    if (url.includes("/v1/notes")) {
      return respond(200, { notes: [{ id: "not_A" }], hasMore: false });
    }
    if (url.includes("/v1/folders")) {
      return respond(200, { folders: [] });
    }
    return respond(404, { error: "not_found" });
  };
  return { calls, fetchImpl };
}

const SECRET = "whsec_c2VjcmV0LXRlc3QtZ3Jhbm9sYQ==";

test("granola : exports kit + migrations", async () => {
  const mod = await loadDist();
  assert.equal(typeof mod.granolaMigrations, "function");
  assert.equal(typeof mod.createGranolaMount, "function");
  assert.equal(typeof mod.createGranolaClient, "function");
  assert.equal(typeof mod.verifyGranolaSignature, "function");
  assert.equal(typeof mod.signGranolaPayload, "function");
  assert.equal(typeof mod.mergeGranolaConfig, "function");
  assert.equal(mod.GRANOLA_DEFAULT_API_BASE_URL, "https://public-api.granola.ai");

  const migs = mod.granolaMigrations();
  assert.equal(migs.length, 2);
  assert.equal(migs[0].id, "granola_001_core");
  assert.equal(migs[1].id, "granola_002_note_transcript_folder");
  assert.match(migs[0].sql, /granola_settings/);
  assert.match(migs[0].sql, /granola_events/);
  assert.match(migs[0].sql, /granola_notes/);
  assert.match(migs[1].sql, /transcript_json/);
  assert.match(migs[1].sql, /folder_id/);
});

test("granola : signature Standard Webhooks (valide / invalide / rejeu)", async () => {
  const { verifyGranolaSignature, signGranolaPayload } = await loadDist();
  const rawBody = JSON.stringify({
    event_id: "evt-1",
    event_type: "note.generated",
    note_id: "not_A",
  });
  const nowS = Math.floor(Date.now() / 1000);
  const sig = signGranolaPayload("evt-1", nowS, rawBody, SECRET);
  const headers = {
    "webhook-id": "evt-1",
    "webhook-timestamp": String(nowS),
    "webhook-signature": sig,
  };
  assert.equal(verifyGranolaSignature(headers, rawBody, SECRET).valid, true);
  // Signature falsifiée.
  const bad = verifyGranolaSignature(
    { ...headers, "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    rawBody,
    SECRET,
  );
  assert.equal(bad.valid, false);
  assert.equal(bad.reason, "bad_signature");
  // Corps altéré.
  assert.equal(
    verifyGranolaSignature(headers, rawBody + " ", SECRET).valid,
    false,
  );
  // Rejeu hors tolérance.
  const oldTs = nowS - 3600;
  const oldSig = signGranolaPayload("evt-1", oldTs, rawBody, SECRET);
  const replay = verifyGranolaSignature(
    { ...headers, "webhook-timestamp": String(oldTs), "webhook-signature": oldSig },
    rawBody,
    SECRET,
  );
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, "timestamp_out_of_tolerance");
  // En-têtes manquants.
  assert.equal(
    verifyGranolaSignature({}, rawBody, SECRET).reason,
    "missing_headers",
  );
});

test("granola : mount 503 sans db", async () => {
  const { createGranolaMount } = await loadDist();
  const mount = createGranolaMount();
  assert.equal(mount.dbLayer, "brand");
  assert.ok(mount.accessJustification, "webhook public → justification requise");
  assert.ok(Array.isArray(mount.operations) && mount.operations.length > 0);
  const res = await call(mount, { method: "GET", subPath: "config" });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "db_unavailable");
});

test("granola : config PUT → GET masqué → DELETE", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.granolaMigrations());
  const mount = mod.createGranolaMount();

  const put = await call(mount, {
    method: "PUT",
    subPath: "config",
    db,
    body: {
      apiKey: "grn_1234567890abcdef",
      signingSecret: SECRET,
      publicBaseUrl: "https://crm.exemple.fr",
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.hasOverride, true);
  // Secrets jamais renvoyés en clair.
  assert.notEqual(put.body.config.apiKey, "grn_1234567890abcdef");
  assert.match(put.body.config.apiKey, /…/);

  const get = await call(mount, { method: "GET", subPath: "config", db });
  assert.equal(get.status, 200);
  assert.match(get.body.config.signingSecret, /…/);
  assert.equal(get.body.config.publicBaseUrl, "https://crm.exemple.fr");

  const info = await call(mount, { method: "GET", subPath: "webhook-info", db });
  assert.equal(info.status, 200);
  assert.equal(
    info.body.url,
    "https://crm.exemple.fr/api/v1/modules/granola/webhook",
  );
  assert.equal(info.body.signingSecretConfigured, true);

  const del = await call(mount, { method: "DELETE", subPath: "config", db });
  assert.equal(del.status, 200);
  const after = await call(mount, { method: "GET", subPath: "config", db });
  assert.equal(after.body.hasOverride, false);

  // Body invalide → 400, jamais de throw.
  const bad = await call(mount, {
    method: "PUT",
    subPath: "config",
    db,
    body: "pas un objet",
  });
  assert.equal(bad.status, 400);
});

test("granola : webhook signé → stocké + note synchronisée ; rejet non signé ; dédup", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.granolaMigrations());
  const fake = createFakeGranolaApi();
  const mount = mod.createGranolaMount({
    defaults: {
      apiKey: "grn_test",
      signingSecret: SECRET,
      publicBaseUrl: "https://crm.exemple.fr",
    },
    fetchImpl: fake.fetchImpl,
    awaitWebhookSync: true,
  });

  const payload = {
    event_id: "8f1c2a4e-6b3d-4e8f-9a2b-1c5d7e9f0a3b",
    event_type: "note.generated",
    note_id: "not_1d3tmYTlCICgjy",
    occurred_at: "2026-01-27T15:30:00Z",
  };
  const rawBody = JSON.stringify(payload);
  const nowS = Math.floor(Date.now() / 1000);
  const headers = {
    "webhook-id": payload.event_id,
    "webhook-timestamp": String(nowS),
    "webhook-signature": mod.signGranolaPayload(
      payload.event_id,
      nowS,
      rawBody,
      SECRET,
    ),
  };

  // Signature invalide → 401 fail-closed, rien n'est stocké.
  const rejected = await call(mount, {
    method: "POST",
    subPath: "webhook",
    db,
    body: payload,
    rawBody,
    headers: { ...headers, "webhook-signature": "v1,AAAA" },
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.error, "invalid_signature");

  // Signature valide → stocké verified + note fetchée via l'API.
  const accepted = await call(mount, {
    method: "POST",
    subPath: "webhook",
    db,
    body: payload,
    rawBody,
    headers,
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.verified, true);
  assert.equal(accepted.body.duplicate, false);
  assert.equal(accepted.body.synced, true);

  const events = await call(mount, { method: "GET", subPath: "events", db });
  assert.equal(events.body.items.length, 1);
  assert.equal(events.body.items[0].event_type, "note.generated");
  assert.equal(events.body.items[0].verified, 1);

  const notes = await call(mount, { method: "GET", subPath: "notes", db });
  assert.equal(notes.body.items.length, 1);
  assert.equal(notes.body.items[0].id, "not_1d3tmYTlCICgjy");
  assert.equal(notes.body.items[0].title, "Revue budget");

  const note = await call(mount, {
    method: "GET",
    subPath: "notes/not_1d3tmYTlCICgjy",
    db,
  });
  assert.equal(note.status, 200);
  assert.equal(note.body.note.summary, "La revue s'est bien passée.");

  // Retry Granola (même event_id) → dédupliqué, deliveries incrémenté.
  const retry = await call(mount, {
    method: "POST",
    subPath: "webhook",
    db,
    body: payload,
    rawBody,
    headers,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  const events2 = await call(mount, { method: "GET", subPath: "events", db });
  assert.equal(events2.body.items.length, 1);
  assert.equal(events2.body.items[0].deliveries, 2);

  // Payload sans event_id → 400.
  const bad = await call(mount, {
    method: "POST",
    subPath: "webhook",
    db,
    body: { hello: 1 },
    rawBody: JSON.stringify({ hello: 1 }),
    headers: {
      "webhook-id": "x",
      "webhook-timestamp": String(nowS),
      "webhook-signature": mod.signGranolaPayload(
        "x",
        nowS,
        JSON.stringify({ hello: 1 }),
        SECRET,
      ),
    },
  });
  assert.equal(bad.status, 400);
});

test("granola : register-webhook capture le signing_secret (jamais renvoyé)", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.granolaMigrations());
  const fake = createFakeGranolaApi();
  const mount = mod.createGranolaMount({
    defaults: { apiKey: "grn_test", publicBaseUrl: "https://crm.exemple.fr" },
    fetchImpl: fake.fetchImpl,
  });

  const res = await call(mount, {
    method: "POST",
    subPath: "register-webhook",
    db,
    body: { scopes: ["personal"] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.secretStored, true);
  assert.equal(res.body.endpoint.id, "whe_TESTENDPOINT01");
  // Le secret n'est PAS renvoyé au client HTTP (ni la clé, ni la valeur).
  assert.equal(res.body.endpoint.signing_secret, undefined);
  const clientBody = JSON.stringify(res.body);
  assert.equal(
    clientBody.includes("signing_secret"),
    false,
    "register-webhook ne leak pas signing_secret dans le body HTTP client",
  );
  assert.equal(
    clientBody.includes("whsec_"),
    false,
    "register-webhook ne leak pas une valeur whsec_ au client",
  );
  // …mais il est stocké : la config le montre configuré (masqué).
  const info = await call(mount, { method: "GET", subPath: "webhook-info", db });
  assert.equal(info.body.signingSecretConfigured, true);
  assert.equal(info.body.webhookEndpointId, "whe_TESTENDPOINT01");
  // L'appel API portait bien l'URL webhook du module + Bearer.
  const post = fake.calls.find((c) => c.init.method === "POST");
  assert.match(post.url, /\/v1\/webhook-endpoints$/);
  assert.equal(post.init.headers.authorization, "Bearer grn_test");
  const outgoing = JSON.parse(post.init.body);
  assert.equal(
    outgoing.url,
    "https://crm.exemple.fr/api/v1/modules/granola/webhook",
  );
  assert.equal(
    outgoing.signing_secret,
    undefined,
    "le body envoyé à Granola ne porte pas signing_secret",
  );
});

test("granola : remote webhook-endpoints list / patch / delete (fetch injectable)", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.granolaMigrations());
  const fake = createFakeGranolaApi();
  const mount = mod.createGranolaMount({
    defaults: { apiKey: "grn_test", publicBaseUrl: "https://crm.exemple.fr" },
    fetchImpl: fake.fetchImpl,
  });

  const listed = await call(mount, {
    method: "GET",
    subPath: "remote/webhook-endpoints",
    db,
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.ok, true);
  assert.equal(listed.body.data.webhook_endpoints[0].id, "whe_TESTENDPOINT01");
  assert.equal(
    listed.body.data.webhook_endpoints[0].signing_secret,
    undefined,
    "GET endpoints ne leak pas signing_secret",
  );
  assert.match(fake.calls.at(-1).url, /\/v1\/webhook-endpoints$/);
  assert.equal(fake.calls.at(-1).init.method, "GET");

  const patched = await call(mount, {
    method: "PATCH",
    subPath: "remote/webhook-endpoints/whe_TESTENDPOINT01",
    db,
    body: { enabled: false, signing_secret: "whsec_injected", extra: "drop" },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.ok, true);
  assert.equal(patched.body.data.enabled, false);
  assert.equal(patched.body.data.signing_secret, undefined);
  const patchCall = fake.calls.at(-1);
  assert.match(patchCall.url, /\/v1\/webhook-endpoints\/whe_TESTENDPOINT01$/);
  assert.equal(patchCall.init.method, "PATCH");
  const patchBody = JSON.parse(patchCall.init.body);
  assert.deepEqual(patchBody, { enabled: false });
  assert.equal(patchBody.signing_secret, undefined);
  assert.equal(patchBody.extra, undefined);

  const emptyPatch = await call(mount, {
    method: "PATCH",
    subPath: "remote/webhook-endpoints/whe_TESTENDPOINT01",
    db,
    body: { signing_secret: "whsec_nope" },
  });
  assert.equal(emptyPatch.status, 400);
  assert.equal(emptyPatch.body.error, "invalid_body");

  const deleted = await call(mount, {
    method: "DELETE",
    subPath: "remote/webhook-endpoints/whe_TESTENDPOINT01",
    db,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);
  assert.equal(deleted.body.data.id, "whe_TESTENDPOINT01");
  const delCall = fake.calls.at(-1);
  assert.equal(delCall.init.method, "DELETE");
  assert.match(delCall.url, /\/v1\/webhook-endpoints\/whe_TESTENDPOINT01$/);
});

test("granola : proxys remote/* + clé manquante → 409", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.granolaMigrations());
  const fake = createFakeGranolaApi();

  // Sans clé API → 409 explicite.
  const noKey = mod.createGranolaMount();
  const denied = await call(noKey, { method: "GET", subPath: "remote/notes", db });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "granola_api_key_missing");

  const mount = mod.createGranolaMount({
    defaults: { apiKey: "grn_test" },
    fetchImpl: fake.fetchImpl,
  });
  const notes = await call(mount, {
    method: "GET",
    subPath: "remote/notes",
    db,
    query: { created_after: "2026-01-01T00:00:00Z" },
  });
  assert.equal(notes.status, 200);
  assert.equal(notes.body.data.notes[0].id, "not_A");
  assert.match(
    fake.calls.at(-1).url,
    /\/v1\/notes\?created_after=/,
    "query passthrough",
  );

  const transcript = await call(mount, {
    method: "GET",
    subPath: "remote/notes/not_A/transcript",
    db,
  });
  assert.equal(transcript.status, 200);
  assert.equal(transcript.body.data.transcript[0].text, "bonjour");

  const folders = await call(mount, { method: "GET", subPath: "remote/folders", db });
  assert.equal(folders.status, 200);

  const endpoints = await call(mount, {
    method: "GET",
    subPath: "remote/webhook-endpoints",
    db,
  });
  assert.equal(endpoints.status, 200);
});

test("granola : GET notes/:id/transcript 409 sans clé, 200 avec fetch injectable", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.granolaMigrations());

  const noKey = mod.createGranolaMount();
  const denied = await call(noKey, {
    method: "GET",
    subPath: "notes/not_A/transcript",
    db,
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "granola_api_key_missing");

  const fake = createFakeGranolaApi();
  const mount = mod.createGranolaMount({
    defaults: { apiKey: "grn_test" },
    fetchImpl: fake.fetchImpl,
  });
  const first = await call(mount, {
    method: "GET",
    subPath: "notes/not_A/transcript",
    db,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.data.transcript[0].text, "bonjour");
  assert.equal(first.body.data.next_cursor, "cur_2");
  assert.match(
    fake.calls.at(-1).url,
    /\/v1\/notes\/not_A\/transcript$/,
    "proxy getTranscript sans appel browser",
  );

  const page2 = await call(mount, {
    method: "GET",
    subPath: "notes/not_A/transcript",
    db,
    query: { cursor: "cur_2" },
  });
  assert.equal(page2.status, 200);
  assert.equal(page2.body.data.transcript[0].text, "suite");
  assert.equal(page2.body.data.next_cursor, null);
  assert.match(fake.calls.at(-1).url, /[?&]cursor=cur_2/);
});

test("granola : sync note conserve le titre", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.granolaMigrations());
  const fake = createFakeGranolaApi();
  const mount = mod.createGranolaMount({
    defaults: { apiKey: "grn_test" },
    fetchImpl: fake.fetchImpl,
  });

  const first = await call(mount, {
    method: "POST",
    subPath: "notes/not_KEEP/sync",
    db,
  });
  assert.equal(first.status, 200);
  db.prepare(
    `UPDATE granola_notes SET title = ? WHERE id = ?`,
  ).run("Titre local", "not_KEEP");

  const again = await call(mount, {
    method: "POST",
    subPath: "notes/not_KEEP/sync",
    db,
  });
  assert.equal(again.status, 200);
  const listed = await call(mount, { method: "GET", subPath: "notes", db });
  const row = listed.body.items.find((n) => n.id === "not_KEEP");
  assert.ok(row, "note syncée présente");
  assert.equal(row.title, "Titre local", "titre local conservé si l'API omet title");

  const titled = await call(mount, {
    method: "POST",
    subPath: "notes/not_BUDGET/sync",
    db,
  });
  assert.equal(titled.status, 200);
  const after = await call(mount, {
    method: "GET",
    subPath: "notes/not_BUDGET",
    db,
  });
  assert.equal(after.status, 200);
  assert.equal(after.body.note.title, "Revue budget");
  assert.ok(
    Array.isArray(after.body.note.transcript),
    "transcript persisté via include=transcript",
  );
  assert.equal(after.body.note.folder_id, "fld_A");
});
