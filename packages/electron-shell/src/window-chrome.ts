/**
 * Chrome fenêtre frameless — HTML/CSS/JS purs.
 * Port de electron/window-chrome-html.ts, paramétré par bridgeName + cssPrefix.
 */

export function windowChromeBarHtml(cssPrefix = "cz"): string {
  return `<div class="${cssPrefix}-titlebar" id="${cssPrefix}-titlebar">
  <div class="${cssPrefix}-titlebar-drag"></div>
  <div class="${cssPrefix}-titlebar-btns" role="group" aria-label="Contrôles de la fenêtre">
    <button type="button" class="${cssPrefix}-tb" id="${cssPrefix}BtnMin" aria-label="Réduire" title="Réduire">─</button>
    <button type="button" class="${cssPrefix}-tb" id="${cssPrefix}BtnMax" aria-label="Agrandir" title="Agrandir">□</button>
    <button type="button" class="${cssPrefix}-tb ${cssPrefix}-tb-close" id="${cssPrefix}BtnClose" aria-label="Fermer" title="Fermer">✕</button>
  </div>
</div>`;
}

export function windowChromeCss(opts?: {
  dark?: boolean;
  cssPrefix?: string;
}): string {
  const dark = opts?.dark !== false;
  const p = opts?.cssPrefix ?? "cz";
  const barBg = dark ? "rgba(15,19,40,.92)" : "rgba(241,245,249,.95)";
  const border = dark ? "rgba(255,255,255,.08)" : "rgba(15,23,42,.1)";
  const fg = dark ? "rgba(255,255,255,.78)" : "rgba(51,65,85,.9)";
  const fgHover = dark ? "#fff" : "#0f172a";
  const hoverBg = dark ? "rgba(255,255,255,.1)" : "rgba(15,23,42,.08)";
  return `
  .${p}-titlebar{position:fixed;inset:0 0 auto 0;height:40px;display:flex;align-items:stretch;z-index:100;background:${barBg};border-bottom:1px solid ${border};-webkit-app-region:drag;app-region:drag}
  .${p}-titlebar-drag{flex:1;min-width:0}
  .${p}-titlebar-btns{display:flex;align-items:stretch;-webkit-app-region:no-drag;app-region:no-drag}
  .${p}-tb{width:46px;border:0;background:transparent;color:${fg};font-size:14px;line-height:1;cursor:default;padding:0}
  .${p}-tb:hover{background:${hoverBg};color:${fgHover}}
  .${p}-tb:active{background:${dark ? "rgba(255,255,255,.16)" : "rgba(15,23,42,.12)"}}
  .${p}-tb-close:hover{background:#e81123;color:#fff}
  .${p}-tb-close:active{background:#c50f1f;color:#fff}
  body.${p}-chrome{padding-top:40px}
`;
}

/** Wire IPC via window[bridgeName]. */
export function windowChromeJs(bridgeName: string, cssPrefix = "cz"): string {
  const forceAttr = `data-${cssPrefix}-chrome-force`;
  const minId = `${cssPrefix}BtnMin`;
  const maxId = `${cssPrefix}BtnMax`;
  const closeId = `${cssPrefix}BtnClose`;
  const updId = `${cssPrefix}-upd`;
  return `
(function wireCzChrome() {
  var api = window[${JSON.stringify(bridgeName)}];
  var bar = document.getElementById(${JSON.stringify(cssPrefix + "-titlebar")});
  var forced = document.body && document.body.getAttribute(${JSON.stringify(forceAttr)}) === "1";
  var useChrome = forced || (api && api.customWindowChrome);
  if (!useChrome) {
    if (bar) bar.style.display = "none";
    document.body.classList.remove(${JSON.stringify(cssPrefix + "-chrome")});
    return;
  }
  document.body.classList.add(${JSON.stringify(cssPrefix + "-chrome")});
  var maxBtn = document.getElementById(${JSON.stringify(maxId)});
  function syncMax(m) {
    if (!maxBtn) return;
    maxBtn.textContent = m ? "❐" : "□";
    maxBtn.setAttribute("aria-label", m ? "Restaurer" : "Agrandir");
    maxBtn.title = m ? "Restaurer" : "Agrandir";
  }
  if (api && api.isWindowMaximized) api.isWindowMaximized().then(syncMax);
  if (api && api.onWindowMaximizedChanged) api.onWindowMaximizedChanged(syncMax);
  var min = document.getElementById(${JSON.stringify(minId)});
  var close = document.getElementById(${JSON.stringify(closeId)});
  if (min) min.onclick = function () { api && api.minimizeWindow && api.minimizeWindow(); };
  if (maxBtn) maxBtn.onclick = function () {
    api && api.toggleMaximizeWindow && api.toggleMaximizeWindow().then(function (r) {
      if (r && typeof r.isMaximized === "boolean") syncMax(r.isMaximized);
    });
  };
  if (close) close.onclick = function () { api && api.closeWindow && api.closeWindow(); };

  var upd = document.getElementById(${JSON.stringify(updId)});
  function showUpd(st) {
    if (!upd || !st) return;
    if (st.updateAvailable || st.state === "available" || st.state === "ready" || st.state === "downloading") {
      var ver = st.availableVersion ? (" " + st.availableVersion) : "";
      if (st.state === "downloading") {
        upd.textContent = "Téléchargement de la mise à jour" + ver + "…";
      } else if (st.state === "ready") {
        upd.textContent = "Mise à jour" + ver + " prête — redémarrage après install.";
      } else {
        upd.textContent = "Mise à jour" + ver + " disponible — proposée après le démarrage.";
      }
      upd.hidden = false;
    }
  }
  if (api && api.getUpdateStatus) api.getUpdateStatus().then(showUpd).catch(function () {});
  if (api && api.onUpdateChanged) api.onUpdateChanged(showUpd);
})();
`;
}
