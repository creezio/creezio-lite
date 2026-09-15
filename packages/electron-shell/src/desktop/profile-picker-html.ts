/**
 * Écran de profils au boot — gold kit paramétré (brand / bridge / tunnel).
 */

import {
  windowChromeBarHtml,
  windowChromeCss,
  windowChromeJs,
} from "../window-chrome.js";

export type PickerRememberedServer = {
  id: string;
  url: string;
  label: string;
};

export type ProfilePickerBrand = {
  productName: string;
  bridgeName: string;
  /** Domaine tunnel affiché, ex. `acme.example`. */
  tunnelRootDomain: string;
  /** Deep link join, ex. `acme`. */
  deepLinkScheme: string;
  accent?: string;
  cssPrefix?: string;
};

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function profilePickerHtml(
  brand: ProfilePickerBrand,
  opts: {
    initialMode: "local" | "remote";
    remoteUrl: string;
    localSetupDone: boolean;
    recallLine: string;
    rememberedServers: PickerRememberedServer[];
    joinOnly?: boolean;
  },
): string {
  const joinOnly = Boolean(opts.joinOnly);
  const accent = brand.accent || "#f0701d";
  const cssPrefix = brand.cssPrefix || "cz";
  const product = brand.productName;
  const tunnel = brand.tunnelRootDomain;
  const deep = brand.deepLinkScheme;
  const localHint = opts.localSetupDone
    ? "Reprendre le serveur local déjà configuré sur ce PC (tunnel d’accès distant inclus s’il est en place)."
    : "Créer un serveur local : onboarding (slug, tunnel, compte) puis démarrage.";
  const showChrome = process.platform === "win32";
  const chromeBar = showChrome ? windowChromeBarHtml(cssPrefix) : "";
  const chromeCss = showChrome
    ? windowChromeCss({ dark: true, cssPrefix })
    : "";
  const chromeJs = showChrome
    ? windowChromeJs(brand.bridgeName, cssPrefix)
    : "";
  const savedTiles = opts.rememberedServers
    .map(
      (s) => `<div class="saved" data-url="${escapeHtml(s.url)}" data-id="${escapeHtml(s.id)}" role="button" tabindex="0">
    <div class="saved-txt"><b>${escapeHtml(s.label)}</b><span>${escapeHtml(s.url)}</span></div>
    <button type="button" class="forget" data-forget="${escapeHtml(s.id)}" title="Oublier ce serveur">✕</button>
  </div>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(product)} — Profils</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14182f;color:#fff;font-family:system-ui,-apple-system,sans-serif}
  .${cssPrefix}-upd{position:fixed;left:12px;right:160px;top:48px;font-size:12px;color:#ffd08a;opacity:.95;z-index:40}
  .wrap{width:min(460px,92vw);padding:28px 24px}
  .brand{font-size:28px;font-weight:700;color:${accent};text-align:center}
  .sub{margin:10px 0 10px;text-align:center;opacity:.8;font-size:14px;line-height:1.45}
  .recall{margin:0 0 18px;text-align:center;font-size:12.5px;opacity:.7;line-height:1.4}
  .opt{display:block;width:100%;text-align:left;margin:0 0 10px;padding:14px 16px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:14px}
  .opt:hover{border-color:${accent}88;background:${accent}14}
  .opt.active{border-color:${accent};background:${accent}24}
  .opt b{display:block;font-size:15px;margin-bottom:4px}
  .opt span{opacity:.7;font-size:12.5px;line-height:1.4}
  .saved-title{margin:14px 0 8px;font-size:12px;opacity:.65;text-transform:uppercase;letter-spacing:.06em}
  .saved{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 8px;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.03);cursor:pointer}
  .saved:hover{border-color:${accent}80;background:${accent}12}
  .saved-txt{flex:1;min-width:0}
  .saved-txt b{display:block;font-size:14px;margin-bottom:2px}
  .saved-txt span{display:block;opacity:.6;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .forget{flex:none;border:0;background:transparent;color:rgba(255,255,255,.45);font-size:14px;cursor:pointer;padding:4px 6px;border-radius:6px}
  .forget:hover{color:#ff8f8f;background:rgba(255,143,143,.12)}
  .remote{margin-top:14px;display:none}
  .remote.show{display:block}
  label{display:block;font-size:12px;opacity:.75;margin-bottom:6px}
  input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:#0f1328;color:#fff;font-size:14px}
  .row{display:flex;gap:8px;margin-top:10px}
  button.primary{flex:1;padding:11px 16px;border:0;border-radius:8px;background:${accent};color:#fff;font-weight:600;font-size:14px;cursor:pointer}
  button.primary:disabled{opacity:.45;cursor:default}
  button.ghost{padding:11px 14px;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:transparent;color:#fff;font-size:13px;cursor:pointer}
  #msg{margin-top:12px;min-height:18px;font-size:13px;opacity:.85}
  #msg.err{color:#ff8f8f}
  #msg.ok{color:#8dffb0}
  ${chromeCss}
</style>
</head>
<body>
${chromeBar}
${showChrome ? `<div class="${cssPrefix}-upd" id="${cssPrefix}-upd" hidden></div>` : ""}
<div class="wrap">
  <div class="brand">${escapeHtml(product)}</div>
  <div class="sub">${
    joinOnly
      ? `Rejoignez votre serveur ${escapeHtml(product)} : choisissez un serveur mémorisé, ou entrez une URL / un lien d’invitation.`
      : "Choisissez un profil : héberger un serveur local, ou rejoindre un serveur existant."
  }</div>
  <div class="recall" id="recall">${escapeHtml(opts.recallLine)}</div>
  ${
    joinOnly
      ? ""
      : `<button type="button" class="opt" id="optLocal" data-mode="local">
    <b>Héberger un serveur local</b>
    <span>${localHint}</span>
  </button>
  <button type="button" class="opt" id="optRemote" data-mode="remote">
    <b>Rejoindre un serveur</b>
    <span>Connexion à une URL (LAN ou tunnel https://….${escapeHtml(tunnel)}) — pas de serveur local sur ce PC.</span>
  </button>`
  }
  ${savedTiles ? `<div class="saved-title">Serveurs mémorisés</div>\n${savedTiles}` : ""}
  <div class="remote${joinOnly ? " show" : ""}" id="remoteBox">
    <label for="url">${joinOnly ? "URL du serveur ou lien d’invitation" : "URL du serveur (LAN ou tunnel)"}</label>
    <input id="url" type="text" placeholder="${
      joinOnly
        ? `https://cabinet.${escapeHtml(tunnel)} ou ${escapeHtml(deep)}://join/…`
        : `http://192.168.1.10:18790 ou https://cabinet.${escapeHtml(tunnel)}`
    }" autocomplete="off" spellcheck="false" />
    <div class="row">
      <button type="button" class="ghost" id="btnTest">Tester</button>
      <button type="button" class="primary" id="btnGo">Continuer</button>
    </div>
  </div>
  ${
    joinOnly
      ? ""
      : `<div class="row" id="localRow" style="margin-top:16px">
    <button type="button" class="primary" id="btnLocalGo">Continuer</button>
  </div>`
  }
  <div id="msg"></div>
</div>
<script>
(function () {
  var joinOnly = ${JSON.stringify(joinOnly)};
  var initialMode = ${JSON.stringify(opts.initialMode)};
  var initialUrl = ${JSON.stringify(opts.remoteUrl)};
  var bridge = ${JSON.stringify(brand.bridgeName)};
  var mode = joinOnly ? "remote" : initialMode;
  var optLocal = document.getElementById("optLocal");
  var optRemote = document.getElementById("optRemote");
  var remoteBox = document.getElementById("remoteBox");
  var localRow = document.getElementById("localRow");
  var msg = document.getElementById("msg");
  var urlInput = document.getElementById("url");
  urlInput.value = initialUrl || "";
  function setMode(m) {
    if (joinOnly) m = "remote";
    mode = m;
    if (optLocal) optLocal.classList.toggle("active", m === "local");
    if (optRemote) optRemote.classList.toggle("active", m === "remote");
    remoteBox.classList.toggle("show", joinOnly || m === "remote");
    if (localRow) localRow.style.display = m === "local" ? "flex" : "none";
    msg.textContent = "";
    msg.className = "";
  }
  if (optLocal) optLocal.onclick = function () { setMode("local"); };
  if (optRemote) optRemote.onclick = function () { setMode("remote"); };
  setMode(joinOnly || initialMode === "remote" ? "remote" : "local");
  function api() { return window[bridge]; }
  async function choose(profile) {
    msg.className = "";
    msg.textContent = "Enregistrement…";
    var r = await api().chooseConnection(profile);
    if (!r || !r.ok) {
      msg.className = "err";
      msg.textContent = (r && r.error) || "Impossible d’enregistrer le choix";
    }
  }
  async function joinUrl(url) {
    msg.className = "";
    msg.textContent = "Vérification…";
    try {
      var t = await api().testConnection(url);
      if (!t.ok) {
        msg.className = "err";
        msg.textContent = t.error || "Serveur injoignable";
        return;
      }
      await choose({ mode: "remote", remoteUrl: t.baseUrl || url, chosen: true });
    } catch (e) {
      msg.className = "err";
      msg.textContent = e && e.message ? e.message : String(e);
    }
  }
  var btnLocalGo = document.getElementById("btnLocalGo");
  if (btnLocalGo) {
    btnLocalGo.onclick = function () {
      choose({ mode: "local", chosen: true });
    };
  }
  document.getElementById("btnTest").onclick = async function () {
    msg.className = "";
    msg.textContent = "Test en cours…";
    try {
      var r = await api().testConnection(urlInput.value);
      if (r.ok) {
        msg.className = "ok";
        msg.textContent = "Serveur joignable" + (r.baseUrl ? " — " + r.baseUrl : "");
        if (r.baseUrl) urlInput.value = r.baseUrl;
      } else {
        msg.className = "err";
        msg.textContent = r.error || "Échec";
      }
    } catch (e) {
      msg.className = "err";
      msg.textContent = e && e.message ? e.message : String(e);
    }
  };
  document.getElementById("btnGo").onclick = function () { joinUrl(urlInput.value); };
  Array.prototype.forEach.call(document.querySelectorAll(".saved"), function (tile) {
    tile.addEventListener("click", function (ev) {
      if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute("data-forget")) return;
      setMode("remote");
      urlInput.value = tile.getAttribute("data-url") || "";
      joinUrl(urlInput.value);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".forget"), function (btn) {
    btn.addEventListener("click", async function (ev) {
      ev.stopPropagation();
      var id = btn.getAttribute("data-forget");
      try {
        if (api().forgetRememberedServer) await api().forgetRememberedServer(id);
      } catch (e) { /* non bloquant */ }
      var tile = btn.closest(".saved");
      if (tile) tile.remove();
    });
  });
  ${chromeJs}
})();
</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
