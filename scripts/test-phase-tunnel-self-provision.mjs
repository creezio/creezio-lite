#!/usr/bin/env node
/**
 * Gate — auto-provisioning Cloudflare Tunnel par l'instance (0.10.0).
 *
 * fetch CF MOCKÉ (aucun appel réseau réel). Prouve le contrat du client
 * platform-core (tunnel-cf / tunnel-cf-client) :
 *
 *  1. verifyCfApiToken : account token via GET /accounts/{id}/tokens/verify,
 *     user token via GET /user/tokens/verify (fallback) ;
 *  2. création : POST cfd_tunnel (config_src cloudflare) → token → PUT
 *     configurations → upsert DNS → MX/SPF email ;
 *  3. idempotence store existant : GET 200 → réutilisation (aucun POST
 *     tunnel), DNS déjà à la bonne cible → aucun POST/PUT DNS ;
 *  4. 404 → recréation : GET tunnel 404 → POST nouveau tunnel → le CNAME
 *     existant est MIS À JOUR (PUT dns_records/{id}) vers le nouvel id ;
 *  5. DNS specs flat/nested selon D2 (CREEZIO_CF_UNIVERSAL_SSL) + ingress
 *     services 127.0.0.1 (cloudflared in-process, modèle unique) ;
 *  6. D1 : hostnames supplémentaires dans l'ingress ET les DNS du même
 *     tunnel ; aucune règle agent posée/préservée sur le tunnel instance ;
 *  7. erreurs API : CfApiError (status + message), getCfTunnel null sur
 *     404, relance sur 500 ;
 *  8. deprovisionCfSlug : DNS instance + tunnel instance (jamais agent.*) ;
 * 10. T7 — tunnel DÉDIÉ agent (`ensureCfAgentTunnel`) : création
 *     `creezio-agent-<slug>` (ingress agent seul, pas d'embeds/email),
 *     `dns:false` (bascule différée), idempotence, 404 → recréation,
 *     bascule CNAME + `removeCfTunnelAgentRule` + `deprovisionCfAgentTunnel`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "packages/platform-core/dist");

const {
  agentTunnelCfName,
  buildAgentTunnelIngressRules,
  buildTunnelIngressRules,
  tunnelDnsRecordSpecs,
  tunnelDeprovisionDnsHosts,
  agentTunnelDeprovisionDnsHosts,
  tunnelAgentHostname,
  slugCheckLocal,
} = await import(path.join(CORE, "tunnel-cf.js"));
const {
  cfApi,
  CfApiError,
  verifyCfApiToken,
  resolveCfZoneName,
  getCfTunnel,
  ensureCfTunnel,
  ensureCfAgentTunnel,
  ensureCfAgentTunnelDns,
  removeCfTunnelAgentRule,
  ensureCfCnameRecord,
  deprovisionCfSlug,
  deprovisionCfAgentTunnel,
  getCfTunnelConfig,
  putCfTunnelIngress,
  resolveCfTunnelEnv,
  missingCfTunnelEnvKeys,
} = await import(path.join(CORE, "tunnel-cf-client.js"));

const ENV = {
  apiToken: "cf-gate-token",
  accountId: "acc-gate",
  zoneId: "zone-gate",
  zoneName: "gate.test",
};

// Hygiène : le mode de hostnames se résout via l'env du process — la gate
// doit être déterministe quel que soit l'environnement du runner.
delete process.env.CREEZIO_CF_UNIVERSAL_SSL;

/* ── Mock stateful de l'API Cloudflare v4 ── */

function startCfMock(opts = {}) {
  const state = {
    tunnels: new Map(), // id → { id, name, config }
    dns: new Map(), // id → { id, type, name, content, proxied }
    seqTunnel: 0,
    seqDns: 0,
    calls: [], // { method, path, body }
    accountTokenOk: opts.accountTokenOk !== false,
  };
  const json = (result, status = 200) =>
    new Response(JSON.stringify({ success: status < 400, result }), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fail = (status, message) =>
    new Response(
      JSON.stringify({ success: false, errors: [{ message }], result: null }),
      { status, headers: { "content-type": "application/json" } },
    );

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const p = u.pathname.replace(/^\/client\/v4/, "");
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, path: p, body });
    assert.equal(
      init.headers?.Authorization,
      `Bearer ${ENV.apiToken}`,
      "Bearer token propagé",
    );

    let m;
    if ((m = p.match(/^\/accounts\/[^/]+\/tokens\/verify$/))) {
      return state.accountTokenOk
        ? json({ id: "tok-account-1" })
        : fail(403, "not authorized on account");
    }
    if (p === "/user/tokens/verify") return json({ id: "tok-user-1" });
    if ((m = p.match(/^\/zones\/([^/]+)$/)) && method === "GET") {
      return json({ id: m[1], name: ENV.zoneName });
    }
    if ((m = p.match(/^\/accounts\/[^/]+\/cfd_tunnel$/)) && method === "POST") {
      const id = `t-${++state.seqTunnel}`;
      state.tunnels.set(id, { id, name: body?.name, config: null });
      return json({ id, name: body?.name, token: `tok-${id}` });
    }
    if ((m = p.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)$/))) {
      const t = state.tunnels.get(m[1]);
      if (method === "GET") {
        return t ? json({ id: t.id, name: t.name }) : fail(404, "not found");
      }
      if (method === "DELETE") {
        if (!t) return fail(404, "not found");
        state.tunnels.delete(m[1]);
        return json({ id: m[1] });
      }
    }
    if (
      (m = p.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/connections$/)) &&
      method === "DELETE"
    ) {
      return json({ deleted: true });
    }
    if (
      (m = p.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/configurations$/))
    ) {
      const t = state.tunnels.get(m[1]);
      if (!t) return fail(404, "not found");
      if (method === "PUT") {
        t.config = body?.config || null;
        return json({ config: t.config });
      }
      if (method === "GET") {
        return t.config
          ? json({ config: t.config })
          : fail(404, "no config");
      }
    }
    if ((m = p.match(/^\/zones\/[^/]+\/dns_records$/))) {
      if (method === "GET") {
        const name = u.searchParams.get("name") || "";
        const type = u.searchParams.get("type") || "";
        const found = [...state.dns.values()].filter(
          (r) => r.name === name && (!type || r.type === type),
        );
        return json(found);
      }
      if (method === "POST") {
        const id = `dns-${++state.seqDns}`;
        state.dns.set(id, { id, ...body });
        return json({ id, ...body });
      }
    }
    if ((m = p.match(/^\/zones\/[^/]+\/dns_records\/([^/]+)$/))) {
      const rec = state.dns.get(m[1]);
      if (!rec) return fail(404, "not found");
      if (method === "PUT") {
        state.dns.set(m[1], { ...rec, ...body });
        return json(state.dns.get(m[1]));
      }
      if (method === "DELETE") {
        state.dns.delete(m[1]);
        return json({ id: m[1] });
      }
    }
    return fail(400, `route inconnue du mock: ${method} ${p}`);
  };
  return {
    state,
    calls: state.calls,
    restore: () => {
      globalThis.fetch = prevFetch;
    },
  };
}

const callsTo = (calls, method, re) =>
  calls.filter((c) => c.method === method && re.test(c.path));

/* ── 1. verify token : account vs user ── */

test("verifyCfApiToken : account token puis fallback user token", async () => {
  let mock = startCfMock({ accountTokenOk: true });
  try {
    const r = await verifyCfApiToken(ENV);
    assert.deepEqual(r, { ok: true, kind: "account", id: "tok-account-1" });
  } finally {
    mock.restore();
  }
  mock = startCfMock({ accountTokenOk: false });
  try {
    const r = await verifyCfApiToken(ENV);
    assert.deepEqual(r, { ok: true, kind: "user", id: "tok-user-1" });
    assert.ok(
      callsTo(mock.calls, "GET", /\/user\/tokens\/verify/).length === 1,
      "fallback user endpoint",
    );
  } finally {
    mock.restore();
  }
});

/* ── 2. création complète ── */

test("ensureCfTunnel : création (POST tunnel → PUT ingress → DNS → email)", async () => {
  const mock = startCfMock();
  try {
    const r = await ensureCfTunnel(ENV, { slug: "resto-a" });
    assert.equal(r.ok, true);
    assert.equal(r.hostname, "resto-a.gate.test");
    assert.equal(r.tunnelId, "t-1");
    assert.equal(r.tunnelToken, "tok-t-1");
    assert.equal(r.recreated, true, "créé à ce tour");
    assert.equal(r.publicUrl, "https://resto-a.gate.test");
    assert.equal(r.emailDomain, "resto-a.mail.gate.test");
    // POST tunnel avec config_src cloudflare (config pilotée par API).
    const posts = callsTo(mock.calls, "POST", /\/cfd_tunnel$/);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.config_src, "cloudflare");
    assert.equal(posts[0].body.name, "creezio-server-resto-a");
    // PUT configurations : ingress 127.0.0.1 (in-process), mode flat défaut.
    const puts = callsTo(mock.calls, "PUT", /\/configurations$/);
    assert.equal(puts.length, 1);
    const ingress = puts[0].body.config.ingress;
    assert.deepEqual(
      ingress.map((x) => [x.hostname || null, x.service]),
      [
        ["resto-a.gate.test", "http://127.0.0.1:18791"],
        ["n8n-resto-a.gate.test", "http://127.0.0.1:15678"],
        ["hermes-resto-a.gate.test", "http://127.0.0.1:18797"],
        [null, "http_status:404"],
      ],
    );
    // DNS : 3 CNAME créés (crm + n8n + hermes flat) → cible cfargotunnel.
    const cnames = [...mock.state.dns.values()].filter(
      (x) => x.type === "CNAME",
    );
    assert.deepEqual(
      cnames.map((x) => x.name).sort(),
      [
        "hermes-resto-a.gate.test",
        "n8n-resto-a.gate.test",
        "resto-a.gate.test",
      ],
    );
    for (const c of cnames) {
      assert.equal(c.content, "t-1.cfargotunnel.com");
      assert.equal(c.proxied, true);
    }
    // Email : 3 MX + 1 SPF TXT sur resto-a.mail.gate.test.
    const mx = [...mock.state.dns.values()].filter((x) => x.type === "MX");
    assert.equal(mx.length, 3);
    assert.ok(
      [...mock.state.dns.values()].some(
        (x) => x.type === "TXT" && /v=spf1/.test(x.content),
      ),
    );
  } finally {
    mock.restore();
  }
});

/* ── 3. idempotence store existant ── */

test("ensureCfTunnel : store existant + GET 200 → réutilisation, DNS no-op", async () => {
  const mock = startCfMock();
  try {
    const first = await ensureCfTunnel(ENV, { slug: "resto-b" });
    mock.calls.length = 0;
    const second = await ensureCfTunnel(ENV, {
      slug: "resto-b",
      stored: { tunnelId: first.tunnelId, tunnelToken: first.tunnelToken },
    });
    assert.equal(second.tunnelId, first.tunnelId, "tunnel réutilisé");
    assert.equal(second.recreated, false);
    assert.equal(
      callsTo(mock.calls, "POST", /\/cfd_tunnel$/).length,
      0,
      "aucun POST tunnel",
    );
    // Ingress ré-assuré (PUT configurations) — idempotent côté CF.
    assert.equal(callsTo(mock.calls, "PUT", /\/configurations$/).length, 1);
    // DNS déjà à la bonne cible → aucune écriture DNS.
    assert.equal(
      mock.calls.filter(
        (c) => /\/dns_records/.test(c.path) && c.method !== "GET",
      ).length,
      0,
      "aucun POST/PUT/DELETE DNS (upsert no-op)",
    );
  } finally {
    mock.restore();
  }
});

/* ── 4. 404 → recréation + CNAME mis à jour ── */

test("ensureCfTunnel : tunnel 404 côté CF → recréation, CNAME suit le nouvel id", async () => {
  const mock = startCfMock();
  try {
    const first = await ensureCfTunnel(ENV, { slug: "resto-c" });
    // Le tunnel disparaît côté Cloudflare (ou /data wipé puis store restauré).
    mock.state.tunnels.delete(first.tunnelId);
    mock.calls.length = 0;
    const second = await ensureCfTunnel(ENV, {
      slug: "resto-c",
      stored: { tunnelId: first.tunnelId, tunnelToken: first.tunnelToken },
    });
    assert.notEqual(second.tunnelId, first.tunnelId, "nouveau tunnel");
    assert.equal(second.recreated, true);
    assert.equal(callsTo(mock.calls, "POST", /\/cfd_tunnel$/).length, 1);
    // Les CNAME existants sont MIS À JOUR (PUT) vers le nouvel id — jamais
    // d'échec « enregistrement existe déjà ».
    const dnsPuts = callsTo(mock.calls, "PUT", /\/dns_records\/dns-/);
    assert.equal(dnsPuts.length, 3, "crm + n8n + hermes mis à jour");
    for (const c of [...mock.state.dns.values()].filter(
      (x) => x.type === "CNAME",
    )) {
      assert.equal(c.content, `${second.tunnelId}.cfargotunnel.com`);
    }
  } finally {
    mock.restore();
  }
});

/* ── 5. D2 : specs DNS + ingress flat vs nested ── */

test("D2 : hostnames services flat (défaut) vs nested (UNIVERSAL_SSL)", () => {
  const ports = { crmPort: 18791, n8nPort: 15678, hermesPort: 18797 };
  const flat = buildTunnelIngressRules("x.gate.test", ports, {
    hostMode: "flat",
  });
  assert.deepEqual(
    flat.slice(0, 3).map((r) => r.hostname),
    ["x.gate.test", "n8n-x.gate.test", "hermes-x.gate.test"],
  );
  const nested = buildTunnelIngressRules("x.gate.test", ports, {
    hostMode: "nested",
  });
  assert.deepEqual(
    nested.slice(0, 3).map((r) => r.hostname),
    ["x.gate.test", "n8n.x.gate.test", "hermes.x.gate.test"],
  );
  // DNS : flat = 3 CNAME explicites ; nested = CNAME + wildcard *.{slug}.
  const flatDns = tunnelDnsRecordSpecs("x", "x.gate.test", "gate.test", {
    hostMode: "flat",
  });
  assert.deepEqual(
    flatDns.records.map((r) => r.qName).sort(),
    ["hermes-x.gate.test", "n8n-x.gate.test", "x.gate.test"],
  );
  const nestedDns = tunnelDnsRecordSpecs("x", "x.gate.test", "gate.test", {
    hostMode: "nested",
  });
  assert.deepEqual(
    nestedDns.records.map((r) => r.qName).sort(),
    ["*.x.gate.test", "x.gate.test"],
  );
  assert.equal(tunnelAgentHostname("x.gate.test", "flat"), "agent-x.gate.test");
  assert.equal(tunnelAgentHostname("x.gate.test", "nested"), "agent.x.gate.test");
});

/* ── 6. D1 : multi-hostnames — aucune règle agent sur le tunnel instance ── */

test("D1 : extra hostnames dans ingress+DNS ; l'ensure instance ne repose JAMAIS une règle agent", async () => {
  const mock = startCfMock();
  try {
    mock.state.tunnels.set("t-9", {
      id: "t-9",
      name: "creezio-server-winhub-admin",
      config: {
        ingress: [
          { hostname: "app.winhub.fr", service: "http://127.0.0.1:18791" },
          {
            hostname: "agent-app.winhub.fr",
            service: "http://host.docker.internal:18810",
          },
          { service: "http_status:404" },
        ],
      },
    });
    const r = await ensureCfTunnel(ENV, {
      slug: "winhub-admin",
      domain: "app.winhub.fr",
      extraHostnames: ["console.winhub.fr"],
      stored: { tunnelId: "t-9", tunnelToken: "tok-t-9" },
    });
    assert.equal(r.recreated, false);
    const put = callsTo(mock.calls, "PUT", /\/configurations$/).at(-1);
    const hosts = put.body.config.ingress.map((x) => x.hostname || null);
    assert.deepEqual(hosts, [
      "app.winhub.fr",
      "n8n-app.winhub.fr",
      "hermes-app.winhub.fr",
      "console.winhub.fr",
      null,
    ]);
    assert.ok(
      !put.body.config.ingress.some((x) => x.hostname === "agent-app.winhub.fr"),
      "règle agent absente du PUT ingress instance",
    );
    const crmService = put.body.config.ingress.find(
      (x) => x.hostname === "console.winhub.fr",
    );
    assert.equal(crmService.service, "http://127.0.0.1:18791");
    const names = [...mock.state.dns.values()]
      .filter((x) => x.type === "CNAME")
      .map((x) => x.name);
    assert.ok(names.includes("app.winhub.fr"));
    assert.ok(names.includes("console.winhub.fr"));
    assert.ok(
      !names.includes("agent-app.winhub.fr"),
      "ensureCfTunnel ne crée pas de CNAME agent",
    );
  } finally {
    mock.restore();
  }
});

/* ── 7. erreurs API ── */

test("erreurs API : CfApiError status/message, getCfTunnel 404→null, 500→throw", async () => {
  const mock = startCfMock();
  try {
    await assert.rejects(
      cfApi(ENV, "GET", "/accounts/acc-gate/cfd_tunnel/t-absent"),
      (err) => {
        assert.ok(err instanceof CfApiError);
        assert.equal(err.status, 404);
        assert.match(err.message, /not found/);
        return true;
      },
    );
    assert.equal(await getCfTunnel(ENV, "t-absent"), null, "404 → null");
    // 500 sur une route non prévue du mock → relancé (pas de null silencieux).
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ success: false, errors: [{ message: "boom" }] }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    await assert.rejects(getCfTunnel(ENV, "t-x"), (err) => {
      assert.ok(err instanceof CfApiError);
      assert.equal(err.status, 500);
      return true;
    });
  } finally {
    mock.restore();
  }
});

/* ── 8. deprovision ── */

test("deprovisionCfSlug : DNS (nested+flat+mail+extras) + tunnel supprimés", async () => {
  const mock = startCfMock();
  try {
    const r = await ensureCfTunnel(ENV, {
      slug: "resto-d",
      extraHostnames: ["booking.gate.test"],
    });
    mock.calls.length = 0;
    const out = await deprovisionCfSlug(ENV, {
      slug: "resto-d",
      tunnelId: r.tunnelId,
      extraHostnames: ["booking.gate.test"],
    });
    assert.equal(out.ok, true);
    assert.equal(out.removed.tunnel, r.tunnelId);
    assert.equal(mock.state.tunnels.size, 0, "tunnel supprimé");
    assert.equal(mock.state.dns.size, 0, "tous les DNS nettoyés");
    // Connexions coupées avant le DELETE tunnel (sinon 409 côté CF).
    const delConn = callsTo(mock.calls, "DELETE", /\/connections$/);
    const delTunnel = callsTo(mock.calls, "DELETE", /\/cfd_tunnel\/t-[^/]+$/);
    assert.equal(delConn.length, 1);
    assert.equal(delTunnel.length, 1);
    const hosts = tunnelDeprovisionDnsHosts(
      "resto-d",
      "resto-d.gate.test",
      "gate.test",
      ["booking.gate.test"],
    );
    for (const h of [
      "resto-d.gate.test",
      "*.resto-d.gate.test",
      "resto-d.mail.gate.test",
      "n8n-resto-d.gate.test",
      "n8n.resto-d.gate.test",
      "booking.gate.test",
    ]) {
      assert.ok(hosts.includes(h), `host de nettoyage ${h}`);
    }
    assert.ok(
      !hosts.includes("agent-resto-d.gate.test"),
      "deprovision instance ne liste PAS agent-*",
    );
    assert.ok(
      !hosts.includes("agent.resto-d.gate.test"),
      "deprovision instance ne liste PAS agent.*",
    );
  } finally {
    mock.restore();
  }
});

test("ensureCfCnameRecord : A hérité (NPM) → DELETE + POST CNAME tunnel", async () => {
  const mock = startCfMock();
  try {
    mock.state.dns.set("dns-a", {
      id: "dns-a",
      type: "A",
      name: "admin.gate.test",
      content: "1.2.3.4",
      proxied: true,
    });
    const r = await ensureCfCnameRecord(ENV, {
      name: "admin.gate.test",
      target: "t-99.cfargotunnel.com",
      comment: "Creezio server test",
    });
    assert.equal(r, "updated");
    const recs = [...mock.state.dns.values()].filter(
      (x) => x.name === "admin.gate.test",
    );
    assert.equal(recs.length, 1);
    assert.equal(recs[0].type, "CNAME");
    assert.equal(recs[0].content, "t-99.cfargotunnel.com");
    assert.equal(recs[0].proxied, true);
    assert.equal(callsTo(mock.calls, "DELETE", /dns_records\/dns-a/).length, 1);
  } finally {
    mock.restore();
  }
});

/* ── 10. T7 : tunnel DÉDIÉ agent ── */

test("ensureCfAgentTunnel : création dédiée (nom creezio-agent-*, ingress agent seul, DNS)", async () => {
  const mock = startCfMock();
  try {
    const r = await ensureCfAgentTunnel(ENV, {
      slug: "resto-e",
      serverHostname: "resto-e.gate.test",
      agentPort: 18810,
    });
    assert.equal(r.ok, true);
    assert.equal(r.recreated, true);
    assert.equal(r.hostname, "agent-resto-e.gate.test", "flat par défaut");
    assert.equal(r.agentUrl, "https://agent-resto-e.gate.test");
    // Tunnel PROPRE à l'agent — nom CF distinct du préfixe serveur.
    const posts = callsTo(mock.calls, "POST", /\/cfd_tunnel$/);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.name, "creezio-agent-resto-e");
    assert.equal(posts[0].body.config_src, "cloudflare");
    assert.equal(agentTunnelCfName("resto-e"), "creezio-agent-resto-e");
    // Ingress : UN service agent (origin loopback — connecteur network host)
    // + 404. Jamais d'embeds n8n/hermes ni de règle CRM.
    const puts = callsTo(mock.calls, "PUT", /\/configurations$/);
    assert.equal(puts.length, 1);
    assert.deepEqual(
      puts[0].body.config.ingress.map((x) => [x.hostname || null, x.service]),
      [
        ["agent-resto-e.gate.test", "http://127.0.0.1:18810"],
        [null, "http_status:404"],
      ],
    );
    // DNS : le CNAME agent seul — aucun MX/SPF (pas d'email agent).
    const dns = [...mock.state.dns.values()];
    assert.equal(dns.length, 1);
    assert.equal(dns[0].type, "CNAME");
    assert.equal(dns[0].name, "agent-resto-e.gate.test");
    assert.equal(dns[0].content, `${r.tunnelId}.cfargotunnel.com`);
    // Helper pur : mêmes règles.
    assert.deepEqual(
      buildAgentTunnelIngressRules("agent-x.gate.test", 18810).map((x) => [
        x.hostname || null,
        x.service,
      ]),
      [
        ["agent-x.gate.test", "http://127.0.0.1:18810"],
        [null, "http_status:404"],
      ],
    );
  } finally {
    mock.restore();
  }
});

test("ensureCfAgentTunnel : dns:false → aucune écriture DNS (bascule différée) ; idempotence stored", async () => {
  const mock = startCfMock();
  try {
    const first = await ensureCfAgentTunnel(ENV, {
      slug: "resto-f",
      serverHostname: "resto-f.gate.test",
      agentPort: 18810,
      dns: false,
    });
    assert.equal(
      mock.calls.filter((c) => /\/dns_records/.test(c.path)).length,
      0,
      "dns:false = zéro appel DNS — l'appelant bascule après le démarrage du connecteur",
    );
    // Bascule séparée (après container up) : upsert idempotent.
    const created = await ensureCfAgentTunnelDns(ENV, {
      hostname: first.hostname,
      tunnelId: first.tunnelId,
      slug: "resto-f",
    });
    assert.equal(created, "created");
    mock.calls.length = 0;
    // Ré-enroll : tunnel réutilisé (aucun POST), recreated=false, DNS no-op.
    const second = await ensureCfAgentTunnel(ENV, {
      slug: "resto-f",
      serverHostname: "resto-f.gate.test",
      agentPort: 18810,
      stored: { tunnelId: first.tunnelId, tunnelToken: first.tunnelToken },
    });
    assert.equal(second.tunnelId, first.tunnelId);
    assert.equal(second.recreated, false);
    assert.equal(callsTo(mock.calls, "POST", /\/cfd_tunnel$/).length, 0);
    assert.equal(
      mock.calls.filter(
        (c) => /\/dns_records/.test(c.path) && c.method !== "GET",
      ).length,
      0,
      "CNAME déjà à la bonne cible → aucun write DNS",
    );
  } finally {
    mock.restore();
  }
});

test("ensureCfAgentTunnel : tunnel 404 côté CF → recréation, CNAME agent suit le nouvel id", async () => {
  const mock = startCfMock();
  try {
    const first = await ensureCfAgentTunnel(ENV, {
      slug: "resto-g",
      serverHostname: "resto-g.gate.test",
      agentPort: 18810,
    });
    mock.state.tunnels.delete(first.tunnelId);
    mock.calls.length = 0;
    const second = await ensureCfAgentTunnel(ENV, {
      slug: "resto-g",
      serverHostname: "resto-g.gate.test",
      agentPort: 18810,
      stored: { tunnelId: first.tunnelId, tunnelToken: first.tunnelToken },
    });
    assert.notEqual(second.tunnelId, first.tunnelId);
    assert.equal(second.recreated, true);
    assert.equal(callsTo(mock.calls, "PUT", /\/dns_records\/dns-/).length, 1);
    const cname = [...mock.state.dns.values()].find(
      (x) => x.name === "agent-resto-g.gate.test",
    );
    assert.equal(cname.content, `${second.tunnelId}.cfargotunnel.com`);
  } finally {
    mock.restore();
  }
});

test("T7 : CNAME agent re-pointé + règle résiduelle retirée ; ensure instance ne la repose pas", async () => {
  const mock = startCfMock();
  try {
    const server = await ensureCfTunnel(ENV, { slug: "resto-h" });
    const agentHost = "agent-resto-h.gate.test";
    // Reste historique (plus aucun chemin code ne pose cette règle).
    const current = (await getCfTunnelConfig(ENV, server.tunnelId)) || [];
    const leftover = current.filter((r) => r.service !== "http_status:404");
    leftover.push({
      hostname: agentHost,
      service: "http://host.docker.internal:18810",
    });
    leftover.push({ service: "http_status:404" });
    await putCfTunnelIngress(ENV, server.tunnelId, leftover);
    await ensureCfCnameRecord(ENV, {
      name: agentHost,
      target: `${server.tunnelId}.cfargotunnel.com`,
    });
    const legacyCname = [...mock.state.dns.values()].find(
      (x) => x.name === agentHost,
    );
    assert.equal(legacyCname.content, `${server.tunnelId}.cfargotunnel.com`);
    mock.calls.length = 0;

    const dedicated = await ensureCfAgentTunnel(ENV, {
      slug: "resto-h",
      serverHostname: "resto-h.gate.test",
      agentPort: 18810,
      dns: false,
    });
    assert.notEqual(dedicated.tunnelId, server.tunnelId);
    const dns = await ensureCfAgentTunnelDns(ENV, {
      hostname: dedicated.hostname,
      tunnelId: dedicated.tunnelId,
      slug: "resto-h",
    });
    assert.equal(dns, "updated", "CNAME agent MIS À JOUR vers le tunnel dédié");
    const cname = [...mock.state.dns.values()].find((x) => x.name === agentHost);
    assert.equal(cname.content, `${dedicated.tunnelId}.cfargotunnel.com`);

    const removed = await removeCfTunnelAgentRule(ENV, {
      tunnelId: server.tunnelId,
      agentHostname: agentHost,
    });
    assert.equal(removed, true);
    const serverIngress = mock.state.tunnels.get(server.tunnelId).config.ingress;
    assert.ok(
      !serverIngress.some((x) => x.hostname === agentHost),
      "règle agent absente du tunnel instance",
    );
    mock.calls.length = 0;
    assert.equal(
      await removeCfTunnelAgentRule(ENV, {
        tunnelId: server.tunnelId,
        agentHostname: agentHost,
      }),
      false,
    );
    assert.equal(callsTo(mock.calls, "PUT", /\/configurations$/).length, 0);
    mock.calls.length = 0;
    await ensureCfTunnel(ENV, {
      slug: "resto-h",
      stored: { tunnelId: server.tunnelId, tunnelToken: server.tunnelToken },
    });
    const rebooted = mock.state.tunnels.get(server.tunnelId).config.ingress;
    assert.ok(!rebooted.some((x) => x.hostname === agentHost));
  } finally {
    mock.restore();
  }
});

test("deprovisionCfSlug ne touche JAMAIS un DNS agent ; seul deprovisionCfAgentTunnel le retire", async () => {
  const mock = startCfMock();
  try {
    const instance = await ensureCfTunnel(ENV, { slug: "resto-i" });
    const agent = await ensureCfAgentTunnel(ENV, {
      slug: "resto-i",
      serverHostname: "resto-i.gate.test",
      agentPort: 18810,
    });
    const agentHost = "agent-resto-i.gate.test";
    assert.ok(
      [...mock.state.dns.values()].some((x) => x.name === agentHost),
      "CNAME agent posé par le tunnel dédié",
    );
    mock.calls.length = 0;
    await deprovisionCfSlug(ENV, {
      slug: "resto-i",
      tunnelId: instance.tunnelId,
    });
    const afterInstance = [...mock.state.dns.values()];
    assert.ok(
      afterInstance.some((x) => x.name === agentHost),
      "DNS agent intact après deprovision instance",
    );
    assert.ok(
      mock.state.tunnels.has(agent.tunnelId),
      "tunnel dédié agent intact après deprovision instance",
    );
    assert.equal(
      afterInstance.filter((x) => /^agent[.-]/.test(x.name)).length,
      1,
    );
    const out = await deprovisionCfAgentTunnel(ENV, {
      slug: "resto-i",
      hostname: agentHost,
      tunnelId: agent.tunnelId,
    });
    assert.equal(out.removed.tunnel, agent.tunnelId);
    assert.ok(out.removed.dns.some((d) => d.includes(agentHost)));
    assert.ok(
      ![...mock.state.dns.values()].some((x) => x.name === agentHost),
      "DNS agent retiré uniquement par deprovisionCfAgentTunnel",
    );
    assert.ok(!mock.state.tunnels.has(agent.tunnelId));
    const agentHosts = agentTunnelDeprovisionDnsHosts("resto-i", "gate.test", [
      agentHost,
    ]);
    assert.ok(agentHosts.includes("agent-resto-i.gate.test"));
    assert.ok(agentHosts.includes("agent.resto-i.gate.test"));
    assert.ok(
      !tunnelDeprovisionDnsHosts(
        "resto-i",
        "resto-i.gate.test",
        "gate.test",
      ).some((h) => /^agent[.-]/.test(h)),
    );
  } finally {
    mock.restore();
  }
});

/* ── 9. contrat env ── */

test("configureTunnelIngress suit CREEZIO_DOMAIN, pas seulement le store", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/host-runtime/src/tunnel/tunnel.ts"),
    "utf8",
  );
  assert.match(src, /domain: instanceDomain\(\) \|\| cfg\.hostname/);
  assert.match(src, /hostname: result\.hostname/);
});

test("contrat env : resolveCfTunnelEnv (marque d'abord) + clés manquantes", () => {
  const env = {
    CREEZIO_CF_API_TOKEN: "t",
    CREEZIO_CF_ACCOUNT_ID: "a",
    CREEZIO_CF_ZONE_ID: "z",
    WINHUB_CF_API_TOKEN: "t-brand",
  };
  const r = resolveCfTunnelEnv(env, "WINHUB");
  assert.equal(r.apiToken, "t-brand", "variante marque prioritaire");
  assert.equal(r.accountId, "a");
  assert.equal(resolveCfTunnelEnv({}, "WINHUB"), null);
  assert.deepEqual(missingCfTunnelEnvKeys({ CREEZIO_CF_API_TOKEN: "t" }), [
    "CREEZIO_CF_ACCOUNT_ID",
    "CREEZIO_CF_ZONE_ID",
  ]);
  // Slug : validation locale pure (réservés, format).
  assert.equal(slugCheckLocal("registry").available, false);
  assert.equal(slugCheckLocal("Resto_Bad!").available, false);
  assert.equal(slugCheckLocal("resto-ok").available, true);
});
