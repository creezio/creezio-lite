/**
 * Splash de démarrage — modèle + HTML riche (aucun import Electron).
 * Port brand-agnostic de electron/splash-ui.ts (historique) — productName / bridgeName / cssPrefix.
 */

import {
  windowChromeBarHtml,
  windowChromeCss,
  windowChromeJs,
} from "./window-chrome.js";

export type SplashStepStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "skip";

export type SplashStepId =
  | "catalog"
  | "migrations"
  | "runtime"
  | "meili"
  | "index"
  | "node"
  | "hermes"
  | "n8n"
  | "next"
  | "tunnel"
  | "login"
  | "remote";

export type SplashStepView = {
  id: SplashStepId;
  label: string;
  status: SplashStepStatus;
  detail: string;
  percent: number | null;
  startedAt: number | null;
  endedAt: number | null;
};

export type SplashViewModel = {
  headline: string;
  bootStartedAt: number;
  overallPercent: number;
  steps: SplashStepView[];
  footer: string;
};

export const SPLASH_STEP_WEIGHTS: Record<SplashStepId, number> = {
  catalog: 12,
  migrations: 5,
  runtime: 3,
  meili: 5,
  index: 12,
  node: 10,
  hermes: 20,
  n8n: 22,
  next: 4,
  tunnel: 4,
  login: 3,
  remote: 100,
};

export function formatElapsedMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

export function sanitizeSplashDetail(line: string): string {
  return String(line || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function estimateEmbedPercent(detail: string): number {
  const s = detail.toLowerCase();
  if (!s || s === "…" || s === "démarrage") return 8;
  if (/erreur|error|fail/.test(s)) return 100;
  if (/\bok\b|prêt|ready|ui prêt|session owner/.test(s)) return 100;
  if (/réutilise|déjà prêt|warm/.test(s)) return 90;
  if (/health|attente|wait|lent/.test(s)) return 82;
  if (/attente n8n|charge encore ses modules/.test(s)) return 82;
  if (/première initialisation|migrations|listening/.test(s)) return 70;
  if (
    /redémarrage n8n|données déjà présentes|spawn warm|spawn cold|signal prêt|editor is now/i.test(
      s,
    )
  )
    return 88;
  if (/owner:|local_trusted|jwt=ok|cli hermes/.test(s)) return 55;
  if (/npm install|pip install|download|télécharg|checksum|bootstrap/.test(s))
    return 35;
  if (/runtime (déjà|manquant)|installation runtime|node /.test(s)) return 20;
  return 40;
}

export function stepProgressRatio(step: SplashStepView): number {
  if (step.status === "done" || step.status === "skip") return 1;
  if (step.status === "error") return 1;
  if (step.status === "pending") return 0;
  if (typeof step.percent === "number" && Number.isFinite(step.percent)) {
    return Math.max(0, Math.min(100, step.percent)) / 100;
  }
  return 0.35;
}

export function computeOverallPercent(steps: SplashStepView[]): number {
  let wSum = 0;
  let pSum = 0;
  for (const step of steps) {
    if (step.status === "skip") continue;
    const w = SPLASH_STEP_WEIGHTS[step.id] ?? 5;
    wSum += w;
    pSum += w * stepProgressRatio(step);
  }
  if (wSum <= 0) return 0;
  return Math.max(0, Math.min(100, (pSum / wSum) * 100));
}

export function createLocalSplashSteps(opts: {
  needIndex: boolean;
  needNode: boolean;
  needHermes: boolean;
  needN8n: boolean;
  needTunnel: boolean;
  /** Label étape catalogue (vertical) — défaut générique. */
  catalogLabel?: string;
  /** Label runtime Node (marque). */
  nodeLabel?: string;
  /** Inclure étape plateforme `runtime` (I15) après migrations. */
  includeRuntime?: boolean;
  runtimeLabel?: string;
}): SplashStepView[] {
  const mk = (
    id: SplashStepId,
    label: string,
    status: SplashStepStatus = "pending",
  ): SplashStepView => ({
    id,
    label,
    status,
    detail: "",
    percent: null,
    startedAt: null,
    endedAt: null,
  });
  const steps: SplashStepView[] = [
    mk("catalog", opts.catalogLabel ?? "Données initiales"),
    mk("migrations", "Base de données"),
  ];
  if (opts.includeRuntime) {
    steps.push(mk("runtime", opts.runtimeLabel ?? "Runtime plateforme"));
  }
  steps.push(
    mk("meili", "Moteur de recherche"),
    mk("index", "Indexation", opts.needIndex ? "pending" : "skip"),
    mk("node", opts.nodeLabel ?? "Runtime Node", opts.needNode ? "pending" : "skip"),
    mk("hermes", "Hermes (agents)", opts.needHermes ? "pending" : "skip"),
    mk("n8n", "n8n (automatisations)", opts.needN8n ? "pending" : "skip"),
    mk("next", "Serveur local CRM"),
    mk("tunnel", "Tunnel d’accès distant", opts.needTunnel ? "pending" : "skip"),
    mk("login", "Ouverture de l’interface"),
  );
  return steps;
}

export function createRemoteSplashSteps(): SplashStepView[] {
  return [
    {
      id: "remote",
      label: "Connexion au serveur",
      status: "pending",
      detail: "",
      percent: null,
      startedAt: null,
      endedAt: null,
    },
    {
      id: "login",
      label: "Ouverture de l’interface",
      status: "pending",
      detail: "",
      percent: null,
      startedAt: null,
      endedAt: null,
    },
  ];
}

export function createSplashModel(
  steps: SplashStepView[],
  headline = "Démarrage…",
): SplashViewModel {
  const now = Date.now();
  return {
    headline,
    bootStartedAt: now,
    overallPercent: computeOverallPercent(steps),
    steps,
    footer:
      "Hermes et n8n démarrent en parallèle — le temps total ≈ le plus lent des deux.",
  };
}

export function activateSplashStep(
  model: SplashViewModel,
  id: SplashStepId,
  opts?: {
    detail?: string;
    percent?: number | null;
    parallel?: boolean;
    headline?: string;
  },
): SplashViewModel {
  const now = Date.now();
  const steps = model.steps.map((s) => {
    if (s.id === id) {
      if (s.status === "skip") return s;
      return {
        ...s,
        status: "running" as const,
        detail:
          opts?.detail !== undefined
            ? sanitizeSplashDetail(opts.detail)
            : s.detail,
        percent: opts?.percent !== undefined ? opts.percent : s.percent,
        startedAt: s.startedAt ?? now,
        endedAt: null,
      };
    }
    if (!opts?.parallel && s.status === "running" && s.id !== id) {
      return {
        ...s,
        status: "done" as const,
        percent: 100,
        endedAt: s.endedAt ?? now,
      };
    }
    return s;
  });
  const next: SplashViewModel = {
    ...model,
    headline: opts?.headline ?? model.headline,
    steps,
  };
  next.overallPercent = computeOverallPercent(steps);
  return next;
}

export function updateSplashStep(
  model: SplashViewModel,
  id: SplashStepId,
  patch: {
    detail?: string;
    percent?: number | null;
    status?: SplashStepStatus;
    headline?: string;
  },
): SplashViewModel {
  const now = Date.now();
  const steps = model.steps.map((s) => {
    if (s.id !== id) return s;
    const status = patch.status ?? s.status;
    const endedAt =
      status === "done" || status === "error"
        ? (s.endedAt ?? now)
        : status === "running"
          ? null
          : s.endedAt;
    return {
      ...s,
      status,
      detail:
        patch.detail !== undefined
          ? sanitizeSplashDetail(patch.detail)
          : s.detail,
      percent: patch.percent !== undefined ? patch.percent : s.percent,
      startedAt: status === "running" ? (s.startedAt ?? now) : s.startedAt,
      endedAt,
    };
  });
  const next: SplashViewModel = {
    ...model,
    headline: patch.headline ?? model.headline,
    steps,
  };
  next.overallPercent = computeOverallPercent(steps);
  return next;
}

export function completeSplashStep(
  model: SplashViewModel,
  id: SplashStepId,
  detail = "Terminé",
): SplashViewModel {
  return updateSplashStep(model, id, {
    status: "done",
    detail,
    percent: 100,
  });
}

export type SplashHtmlOptions = {
  productName: string;
  bridgeName: string;
  windowChrome?: boolean;
  accentColor?: string;
  /** Préfixe classes / ids chrome (`tf` pour marques, `cz` défaut). */
  cssPrefix?: string;
};

/** HTML splash riche (barres + chronos) — data URL construite par le caller. */
export function splashHtmlDocument(opts: SplashHtmlOptions): string {
  const chrome = Boolean(opts.windowChrome);
  const accent = opts.accentColor ?? "#f0701d";
  const cssPrefix = opts.cssPrefix ?? "cz";
  const chromeBar = chrome ? windowChromeBarHtml(cssPrefix) : "";
  const chromeCss = chrome
    ? windowChromeCss({ dark: true, cssPrefix })
    : "";
  const chromeJs = chrome
    ? windowChromeJs(opts.bridgeName, cssPrefix)
    : "";
  const bodyAttrs = chrome
    ? ` class="${cssPrefix}-chrome" data-${cssPrefix}-chrome-force="1"`
    : "";
  const title = opts.productName.replace(/</g, "");
  const updClass = `${cssPrefix}-upd`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  *{box-sizing:border-box}
  body{
    margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#14182f;color:#fff;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  .wrap{width:min(640px,92vw);padding:28px 22px 32px}
  .brand{font-size:28px;font-weight:700;color:${accent};letter-spacing:-.02em}
  .headline{margin-top:10px;font-size:15px;line-height:1.4;opacity:.92;word-break:break-word}
  .meta{margin-top:14px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:13px;opacity:.75}
  .meta b{color:#fff;opacity:1;font-variant-numeric:tabular-nums}
  .obar{
    margin-top:8px;height:10px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;
  }
  .obar > i{
    display:block;height:100%;width:0%;border-radius:6px;background:${accent};
    transition:width .3s ease;
  }
  .steps{margin-top:18px;display:flex;flex-direction:column;gap:8px;max-height:min(58vh,520px);overflow:auto;padding-right:2px}
  .step{
    border:1px solid rgba(255,255,255,.1);border-radius:10px;
    background:rgba(255,255,255,.03);padding:10px 12px;
  }
  .step.skip{display:none}
  .step.pending{opacity:.45}
  .step.running{border-color:${accent}88;background:${accent}14}
  .step.done{opacity:.85}
  .step.error{border-color:rgba(255,120,120,.55);background:rgba(255,80,80,.08)}
  .row{display:flex;align-items:flex-start;gap:10px}
  .mark{
    flex:0 0 22px;width:22px;height:22px;border-radius:50%;
    display:grid;place-items:center;font-size:12px;margin-top:1px;
    background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);
  }
  .step.running .mark{background:${accent}40;color:${accent}}
  .step.done .mark{background:rgba(80,200,120,.2);color:#8dffb0}
  .step.error .mark{background:rgba(255,100,100,.2);color:#ff8f8f}
  .body{flex:1;min-width:0}
  .topline{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .label{font-size:14px;font-weight:600}
  .timer{font-size:12px;opacity:.7;font-variant-numeric:tabular-nums;white-space:nowrap}
  .sbar{
    margin-top:7px;height:5px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;
  }
  .sbar > i{display:block;height:100%;width:0%;border-radius:4px;background:${accent};transition:width .25s ease}
  .sbar.indet > i{
    width:36%!important;animation:indet 1.1s ease-in-out infinite;
  }
  @keyframes indet{
    0%{transform:translateX(-120%)}
    100%{transform:translateX(320%)}
  }
  .detail{
    margin-top:7px;font-size:12px;line-height:1.45;opacity:.78;
    white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;
  }
  .pct{font-size:11px;opacity:.55;margin-left:6px;font-variant-numeric:tabular-nums}
  .footer{margin-top:14px;font-size:12px;line-height:1.45;opacity:.55;word-break:break-word}
  .${updClass}{margin-top:12px;font-size:12.5px;line-height:1.4;color:#ffd08a;opacity:.95;word-break:break-word}
  ${chromeCss}
</style>
</head>
<body${bodyAttrs}>
${chromeBar}
<div class="wrap">
  <div class="brand">${title}</div>
  <div class="headline" id="headline">Démarrage…</div>
  <div class="${updClass}" id="${updClass}" hidden></div>
  <div class="meta">
    <span>Temps écoulé <b id="elapsed">0s</b></span>
    <span><b id="opct">0</b>%</span>
  </div>
  <div class="obar"><i id="obar"></i></div>
  <div class="steps" id="steps"></div>
  <div class="footer" id="footer"></div>
</div>
<script>
(function () {
  var state = null;
  var MARK = { pending: "○", running: "●", done: "✓", error: "!", skip: "–" };

  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m > 0 ? (m + ":" + String(r).padStart(2, "0")) : (r + "s");
  }

  function stepTimer(st, now) {
    if (!st.startedAt) return "";
    if (st.endedAt) return fmt(st.endedAt - st.startedAt);
    if (st.status === "running") return fmt(now - st.startedAt);
    if (st.status === "done" || st.status === "error") {
      return st.endedAt ? fmt(st.endedAt - st.startedAt) : "";
    }
    return "";
  }

  function render() {
    if (!state) return;
    var now = Date.now();
    document.getElementById("headline").textContent = state.headline || "Démarrage…";
    document.getElementById("elapsed").textContent = fmt(now - (state.bootStartedAt || now));
    var op = Math.max(0, Math.min(100, Number(state.overallPercent) || 0));
    document.getElementById("opct").textContent = String(Math.round(op));
    document.getElementById("obar").style.width = op.toFixed(1) + "%";
    document.getElementById("footer").textContent = state.footer || "";

    var root = document.getElementById("steps");
    var html = "";
    (state.steps || []).forEach(function (st) {
      var cls = "step " + (st.status || "pending");
      var pct = st.percent;
      var showBar = st.status === "running" || (typeof pct === "number" && st.status !== "pending");
      var indet = st.status === "running" && (pct == null || !isFinite(pct));
      var barW = indet ? 36 : Math.max(0, Math.min(100, Number(pct) || (st.status === "done" ? 100 : 0)));
      var pctLabel = (!indet && typeof pct === "number" && st.status === "running")
        ? ('<span class="pct">' + Math.round(pct) + "%</span>")
        : "";
      var detail = st.detail ? String(st.detail) : "";
      html += '<div class="' + cls + '" data-id="' + st.id + '">'
        + '<div class="row">'
        + '<div class="mark">' + (MARK[st.status] || "○") + "</div>"
        + '<div class="body">'
        + '<div class="topline"><span class="label">' + escapeHtml(st.label) + pctLabel + "</span>"
        + '<span class="timer" data-started="' + (st.startedAt || "") + '" data-ended="' + (st.endedAt || "") + '" data-status="' + st.status + '">'
        + escapeHtml(stepTimer(st, now)) + "</span></div>"
        + (showBar
          ? ('<div class="sbar' + (indet ? " indet" : "") + '"><i style="width:' + barW + '%"></i></div>')
          : "")
        + (detail ? ('<div class="detail">' + escapeHtml(detail) + "</div>") : "")
        + "</div></div></div>";
    });
    root.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tickTimers() {
    if (!state) return;
    var now = Date.now();
    document.getElementById("elapsed").textContent = fmt(now - (state.bootStartedAt || now));
    var timers = document.querySelectorAll(".timer");
    for (var i = 0; i < timers.length; i++) {
      var el = timers[i];
      var started = Number(el.getAttribute("data-started") || 0);
      var ended = Number(el.getAttribute("data-ended") || 0);
      var status = el.getAttribute("data-status") || "";
      if (!started) { el.textContent = ""; continue; }
      if (ended) el.textContent = fmt(ended - started);
      else if (status === "running") el.textContent = fmt(now - started);
    }
  }

  window.__setBoot = function (m) {
    state = m || null;
    render();
  };
  window.__setStatus = function (t) {
    if (!state) {
      state = {
        headline: String(t || "Démarrage…"),
        bootStartedAt: Date.now(),
        overallPercent: 0,
        steps: [],
        footer: "",
      };
    } else {
      state.headline = String(t || state.headline);
    }
    render();
  };
  window.__setProgress = function (p) {
    if (!state) return;
    if (p && typeof p.percent === "number") {
      state.overallPercent = p.percent;
      var cat = (state.steps || []).find(function (s) { return s.id === "catalog"; });
      if (cat && cat.status === "running") {
        cat.percent = p.percent;
        if (p.detail) cat.detail = String(p.detail);
      }
    }
    render();
  };

  setInterval(tickTimers, 250);
})();
${chromeJs}
</script>
</body></html>`;
}

export function splashDataUrl(opts: SplashHtmlOptions): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    splashHtmlDocument(opts),
  )}`;
}
