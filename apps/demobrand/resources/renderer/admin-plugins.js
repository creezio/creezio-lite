/**
 * Client Admin Plugins L3 (I5).
 * En Electron, brancher `window.demobrandAdminPlugins` (preload) ;
 * sinon mode démo localStorage pour la maquette UI.
 */
(function () {
  const logEl = document.getElementById("log");
  const rowsEl = document.getElementById("rows");

  function log(msg, cls) {
    logEl.textContent = msg;
    logEl.className = cls || "meta";
  }

  async function api(method, path, body, headers) {
    if (window.demobrandAdminPlugins?.handle) {
      return window.demobrandAdminPlugins.handle({ method, path, body, headers });
    }
    // Fallback maquette (pas de backend) — persistance locale UI only
    const key = "demobrand-admin-plugins-i5";
    const db = JSON.parse(localStorage.getItem(key) || '{"plugins":[]}');
    if (method === "GET" && path.endsWith("/list")) {
      return { status: 200, body: { ok: true, plugins: db.plugins } };
    }
    if (method === "POST" && path.endsWith("/upsert")) {
      const caps = [];
      for (const c of body.orgCapabilities?.[0]?.capabilities || []) {
        caps.push({
          subjectKind: "org",
          subjectId: body.orgCapabilities[0].orgId,
          capability: c,
        });
      }
      const row = {
        pluginId: body.pluginId,
        ownerOrgId: body.ownerOrgId,
        orgIds: body.orgIds || [body.ownerOrgId],
        userIds: [],
        capabilities: caps,
      };
      db.plugins = db.plugins.filter((p) => p.pluginId !== row.pluginId);
      db.plugins.push(row);
      localStorage.setItem(key, JSON.stringify(db));
      return { status: 200, body: { ok: true, plugin: row } };
    }
    if (method === "POST" && path.endsWith("/preview")) {
      const row = db.plugins.find((p) => p.pluginId === body.pluginId);
      if (!row) {
        return {
          status: 200,
          body: {
            ok: true,
            decision: { allow: false, reason: "no_acl" },
          },
        };
      }
      const actorOrg = headers["x-creezio-org-id"];
      const cross = row.ownerOrgId && actorOrg && actorOrg !== row.ownerOrgId;
      const member = (row.orgIds || []).includes(actorOrg);
      const allow = !cross && member;
      return {
        status: 200,
        body: {
          ok: true,
          decision: allow
            ? { allow: true }
            : { allow: false, reason: cross ? "cross_org_denied" : "not_member" },
        },
      };
    }
    return { status: 501, body: { ok: false, error: "bridge_missing" } };
  }

  async function refresh() {
    const res = await api("GET", "/api/v1/modules/admin-plugins/list");
    const plugins = res.body?.plugins || [];
    rowsEl.innerHTML = plugins
      .map((p) => {
        const caps = (p.capabilities || [])
          .map((c) => `${c.subjectId}:${c.capability}`)
          .join(", ");
        return `<tr><td><code>${p.pluginId}</code></td><td>${p.ownerOrgId || "—"}</td><td>${(p.orgIds || []).join(", ")}</td><td>${caps || "see+execute (défaut)"}</td></tr>`;
      })
      .join("");
    if (!plugins.length) {
      rowsEl.innerHTML =
        '<tr><td colspan="4" class="meta">Aucun binding</td></tr>';
    }
  }

  document.getElementById("upsert").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const pluginId = String(fd.get("pluginId") || "").trim();
    const ownerOrgId = String(fd.get("ownerOrgId") || "").trim();
    const orgIds = String(fd.get("orgIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const capabilities = [];
    if (fd.get("cap_see")) capabilities.push("see");
    if (fd.get("cap_install")) capabilities.push("install");
    if (fd.get("cap_execute")) capabilities.push("execute");
    const res = await api(
      "POST",
      "/api/v1/modules/admin-plugins/upsert",
      {
        pluginId,
        ownerOrgId,
        orgIds,
        orgCapabilities: [{ orgId: ownerOrgId, capabilities }],
      },
      { "x-creezio-is-owner": "1" },
    );
    if (res.status >= 400) {
      log(JSON.stringify(res.body, null, 2), "bad");
    } else {
      log("Binding enregistré\n" + JSON.stringify(res.body.plugin, null, 2), "ok");
      await refresh();
    }
  });

  document.getElementById("preview").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const res = await api(
      "POST",
      "/api/v1/modules/admin-plugins/preview",
      {
        pluginId: String(fd.get("pluginId") || "").trim(),
        action: String(fd.get("action") || "see"),
      },
      { "x-creezio-org-id": String(fd.get("orgId") || "").trim() },
    );
    const d = res.body?.decision;
    if (d?.allow) log("ALLOW " + JSON.stringify(d), "ok");
    else log("DENY " + JSON.stringify(d), "bad");
  });

  refresh();
})();
