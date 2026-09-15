/**
 * Écran d’erreur boot / crash (hors React) — gold kit paramétré.
 */

import { logFilePath } from "@creezio/host-runtime";
import {
  windowChromeBarHtml,
  windowChromeCss,
  windowChromeJs,
} from "../window-chrome.js";

export type ErrorPageBrand = {
  productName: string;
  bridgeName: string;
  accent?: string;
  cssPrefix?: string;
  /** Chemin journal affiché ; sinon logFilePath() kit. */
  logPathHint?: string;
};

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function errorPageHtmlDocument(
  brand: ErrorPageBrand,
  title: string,
  message: string,
  opts?: { windowChrome?: boolean },
): string {
  const cssPrefix = brand.cssPrefix || "cz";
  const accent = brand.accent || "#f0701d";
  const showChrome =
    opts?.windowChrome === true ||
    (opts?.windowChrome !== false && process.platform === "win32");
  const chromeBar = showChrome ? windowChromeBarHtml(cssPrefix) : "";
  const chromeCss = showChrome
    ? windowChromeCss({ dark: true, cssPrefix })
    : "";
  const chromeJs = showChrome
    ? windowChromeJs(brand.bridgeName, cssPrefix)
    : "";
  const bodyAttrs = showChrome
    ? ` class="${cssPrefix}-chrome" data-${cssPrefix}-chrome-force="1"`
    : "";
  const logPath =
    brand.logPathHint ||
    logFilePath() ||
    `(dossier userData)/logs/${brand.productName.toLowerCase()}-main.log`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(brand.productName)} — erreur</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  *{box-sizing:border-box}
  body{
    margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#14182f;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  .wrap{max-width:min(640px,92vw);padding:28px 22px 32px;text-align:center}
  .brand{font-size:26px;font-weight:700;color:${accent}}
  h1{font-size:18px;margin:20px 0 0;font-weight:600}
  .msg{
    margin-top:14px;opacity:.88;line-height:1.55;text-align:left;
    white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;
    max-height:min(52vh,420px);overflow:auto;padding:12px 14px;
    border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(0,0,0,.18);
  }
  .retry{
    margin-top:22px;padding:10px 26px;font-size:15px;font-weight:600;color:#fff;
    background:${accent};border:0;border-radius:8px;cursor:pointer;
  }
  .retry:hover{filter:brightness(.92)}
  .foot{margin-top:22px;opacity:.6;font-size:12px;line-height:1.45}
  ${chromeCss}
</style>
</head>
<body${bodyAttrs}>
${chromeBar}
<div class="wrap">
  <div class="brand">${escapeHtml(brand.productName)}</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="msg">${escapeHtml(message)}</div>
  <button type="button" class="retry" id="czRetry">Réessayer</button>
  <p class="foot">Un rapport a été envoyé automatiquement à l’éditeur.<br>
  Journal local : ${escapeHtml(logPath)}</p>
</div>
<script>
(function () {
  var btn = document.getElementById("czRetry");
  var bridge = ${JSON.stringify(brand.bridgeName)};
  if (btn) {
    btn.onclick = function () {
      var api = window[bridge];
      if (api && api.retrySetup) {
        api.retrySetup();
      }
    };
  }
})();
${chromeJs}
</script>
</body></html>`;
}

export function errorPageDataUrl(
  brand: ErrorPageBrand,
  title: string,
  message: string,
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    errorPageHtmlDocument(brand, title, message),
  )}`;
}
