/**
 * Écran offline du client thin (mode remote) : le serveur ne répond plus
 * en cours de session. Retry automatique avec backoff via le bridge
 * (`testConnection`) puis rechargement du CRM ; bouton « Changer de
 * serveur » (`rechooseConnection` → picker au prochain boot).
 */

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function remoteOfflineHtml(opts: {
  productName: string;
  bridgeName: string;
  crmUrl: string;
  accent?: string;
  detail?: string;
}): string {
  const accent = opts.accent || "#f0701d";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(opts.productName)} — Hors ligne</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14182f;color:#fff;font-family:system-ui,-apple-system,sans-serif}
  .wrap{width:min(440px,92vw);padding:28px 24px;text-align:center}
  .badge{display:inline-block;padding:4px 12px;border-radius:999px;background:#ff8f8f22;color:#ff8f8f;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
  h1{font-size:22px;margin:16px 0 8px}
  .url{opacity:.65;font-size:13px;word-break:break-all}
  .detail{margin:10px 0 0;font-size:13px;opacity:.75;min-height:18px}
  .spinner{margin:22px auto 0;width:26px;height:26px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:${accent};animation:sp 1s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  .row{display:flex;gap:8px;margin-top:24px;justify-content:center}
  button{padding:10px 16px;border-radius:8px;font-size:13px;cursor:pointer}
  .primary{border:0;background:${accent};color:#fff;font-weight:600}
  .ghost{border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff}
</style></head>
<body>
<div class="wrap">
  <span class="badge">Hors ligne</span>
  <h1>Serveur injoignable</h1>
  <div class="url">${escapeHtml(opts.crmUrl)}</div>
  <div class="detail" id="detail">${escapeHtml(opts.detail || "Nouvelle tentative automatique…")}</div>
  <div class="spinner"></div>
  <div class="row">
    <button type="button" class="primary" id="btnRetry">Réessayer maintenant</button>
    <button type="button" class="ghost" id="btnRechoose">Changer de serveur</button>
  </div>
</div>
<script>
(function () {
  var bridge = ${JSON.stringify(opts.bridgeName)};
  var crmUrl = ${JSON.stringify(opts.crmUrl)};
  var detail = document.getElementById("detail");
  var attempt = 0;
  var timer = null;
  function api() { return window[bridge] || {}; }
  async function tryOnce() {
    attempt++;
    detail.textContent = "Tentative " + attempt + "…";
    try {
      var r = api().testConnection ? await api().testConnection(crmUrl) : null;
      if (r && r.ok) {
        detail.textContent = "Serveur de retour — rechargement…";
        window.location.replace(r.baseUrl || crmUrl);
        return;
      }
      detail.textContent = (r && r.error) || "Toujours injoignable — nouvelle tentative…";
    } catch (e) {
      detail.textContent = e && e.message ? e.message : String(e);
    }
    // Backoff plafonné : 3s, 6s, 12s, 24s, puis 30s.
    var delay = Math.min(3000 * Math.pow(2, Math.min(attempt - 1, 3)), 30000);
    timer = setTimeout(tryOnce, delay);
  }
  document.getElementById("btnRetry").onclick = function () {
    if (timer) clearTimeout(timer);
    tryOnce();
  };
  document.getElementById("btnRechoose").onclick = async function () {
    try {
      if (api().rechooseConnection) await api().rechooseConnection();
    } catch (e) {
      detail.textContent = e && e.message ? e.message : String(e);
    }
  };
  tryOnce();
})();
</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
