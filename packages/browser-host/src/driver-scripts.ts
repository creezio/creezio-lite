/**
 * Scripts in-page du driver sites externes — SOURCE OF TRUTH partagée.
 *
 * Consommés par :
 * - `@creezio/electron-shell` (browser-tab-driver, monde isolé Electron) ;
 * - `@creezio/browser-host` (Chromium sidecar serveur, monde isolé CDP).
 *
 * JS pur portable (aucune API Electron/Node) — ne PAS forker : toute évolution
 * du sélecteur interactif / labels / similarité Dice se fait ici et profite
 * aux deux runtimes.
 */

/**
 * Helpers monde isolé (`globalThis.__tfsup`) : énumération / résolution des
 * cibles interactives, locate (centre cliquable), lecture texte, contexte page.
 * Idempotent : redéfinit `__tfsup` à chaque évaluation, l'état
 * targets/generation survit tant que la page (et son monde isolé) vit.
 */
export const DRIVER_HELPERS = `
(() => {
  const g = globalThis;
  if (!g.__tfsupState) g.__tfsupState = { generation: 0, targets: new Map() };
  const state = g.__tfsupState;

  const INTERACTIVE_SELECTOR = [
    "a[href]", "button", '[role="button"]', '[role="option"]', '[role="menuitem"]',
    '[role="tab"]', '[role="combobox"]', '[role="link"]', '[onclick]',
    'input:not([type="hidden"])', "select", "textarea", "[contenteditable='true']",
  ].join(", ");

  function isVisible(el) {
    if (el.closest('[aria-hidden="true"]')) return false;
    if (el.hidden) return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const margin = 300;
    if (rect.bottom < -margin || rect.top > window.innerHeight + margin ||
        rect.right < -margin || rect.left > window.innerWidth + margin) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return true;
  }

  function labelFor(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const title = el.getAttribute && el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const ph = (el.placeholder || "").trim();
      if (ph) return ph;
      if (el.name) return el.name;
      if (el.id) return el.id;
    }
    const alt = el.querySelector && el.querySelector("img[alt]");
    const text = ((el.innerText || el.textContent || "") + (alt ? " " + alt.getAttribute("alt") : ""))
      .replace(/\\s+/g, " ").trim();
    return text.slice(0, 90);
  }

  function kindFor(el) {
    const role = el.getAttribute && el.getAttribute("role");
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") return "input:" + (el.type || "text");
    return tag;
  }

  function normalize(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  }

  function pageContext() {
    const h1 = document.querySelector("h1");
    return {
      url: window.location.href,
      title: document.title,
      heading: h1 ? (h1.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120) : null,
    };
  }

  function collectTargets(q) {
    state.generation += 1;
    if (state.targets.size > 2000) state.targets.clear();
    const scan = (nq) => {
      const seen = new Set();
      const out = [];
      let idx = 0;
      for (const el of Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!isVisible(el)) continue;
        const label = labelFor(el);
        if (!label) continue;
        const href = el instanceof HTMLAnchorElement ? (el.getAttribute("href") || undefined) : undefined;
        if (nq) {
          const hay = normalize(label + " " + (href || ""));
          if (!hay.includes(nq)) continue;
        }
        idx += 1;
        const ref = "s" + state.generation + "-" + idx;
        state.targets.set(ref, new WeakRef(el));
        out.push({ ref, label, kind: kindFor(el), href });
        if (out.length >= 120) break;
      }
      return out;
    };
    const nq = q ? normalize(q) : "";
    let targets = scan(nq);
    let note;
    if (nq && targets.length === 0) {
      targets = scan("");
      note = "Aucune cible ne contient « " + q + " » — liste complète renvoyée à la place.";
    }
    return { targets, truncated: targets.length >= 120, note };
  }

  function similarity(a, b) {
    const na = normalize(a); const nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.9;
    const bigrams = (s) => {
      const m = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const bg = s.slice(i, i + 2);
        m.set(bg, (m.get(bg) || 0) + 1);
      }
      return m;
    };
    const ba = bigrams(na); const bb = bigrams(nb);
    let inter = 0, totalA = 0, totalB = 0;
    ba.forEach((c) => { totalA += c; });
    bb.forEach((c) => { totalB += c; });
    ba.forEach((c, bg) => { inter += Math.min(c, bb.get(bg) || 0); });
    return totalA + totalB ? (2 * inter) / (totalA + totalB) : 0;
  }

  function scoreCandidates(query) {
    const out = [];
    for (const el of Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))) {
      if (!isVisible(el)) continue;
      const label = labelFor(el);
      if (!label) continue;
      out.push({ el, label, score: similarity(query, label) });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  function resolveTarget(refArg, labelArg) {
    if (refArg) {
      const wr = state.targets.get(refArg);
      const el = wr && wr.deref();
      if (el && document.contains(el) && isVisible(el)) return el;
    }
    if (labelArg) {
      const nl = normalize(labelArg);
      let partial = null;
      for (const el of Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))) {
        if (!isVisible(el)) continue;
        const l = normalize(labelFor(el));
        if (!l) continue;
        if (l === nl) return el;
        if (!partial && (l.includes(nl) || nl.includes(l))) partial = el;
      }
      if (partial) return partial;
    }
    return null;
  }

  async function resolveWithRepair(refArg, labelArg) {
    let el = resolveTarget(refArg, labelArg);
    if (el) return { el, suggestions: [] };
    const query = labelArg || refArg || "";
    if (query) {
      const scored = scoreCandidates(query);
      if (scored[0] && scored[0].score >= 0.6) return { el: scored[0].el, suggestions: [] };
      window.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: "instant" });
      await new Promise((r) => setTimeout(r, 400));
      el = resolveTarget(refArg, labelArg);
      if (el) return { el, suggestions: [] };
      const rescored = scoreCandidates(query);
      if (rescored[0] && rescored[0].score >= 0.6) return { el: rescored[0].el, suggestions: [] };
      const suggestions = rescored.filter((c) => c.score > 0.2).slice(0, 5).map((c) => c.label);
      return { el: null, suggestions };
    }
    return { el: null, suggestions: [] };
  }

  /** Centre cliquable de l'élément (scroll au centre si hors écran). */
  async function locate(refArg, labelArg) {
    const { el, suggestions } = await resolveWithRepair(refArg, labelArg);
    if (!el) return { ok: false, suggestions, page: pageContext() };
    const before = el.getBoundingClientRect();
    if (before.top < 40 || before.bottom > window.innerHeight - 20 ||
        before.left < 0 || before.right > window.innerWidth) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      await new Promise((r) => setTimeout(r, 350));
    }
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + Math.min(rect.width / 2, 160));
    const y = Math.round(rect.top + rect.height / 2);
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
      (el.getAttribute && el.getAttribute("contenteditable") === "true");
    // Champ imbriqué (cible = conteneur) : viser l'input interne.
    let fieldSelectorHit = isField;
    if (!isField && el.querySelector) {
      const inner = el.querySelector("input, textarea");
      if (inner) {
        const r2 = inner.getBoundingClientRect();
        return { ok: true, x: Math.round(r2.left + r2.width / 2), y: Math.round(r2.top + r2.height / 2),
                 label: labelFor(el), isField: true, page: pageContext() };
      }
    }
    return { ok: true, x, y, label: labelFor(el), isField: fieldSelectorHit, page: pageContext() };
  }

  /** Vide le champ actuellement focus (avant frappe trusted). */
  function clearFocusedField() {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(el, "");
      else el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function readText(q, maxChars) {
    const max = Math.min(Math.max(maxChars || 6000, 500), 20000);
    const raw = (document.body && document.body.innerText) || "";
    const lines = raw.split("\\n").map((l) => l.replace(/\\s+/g, " ").trim()).filter(Boolean);
    let selected = lines;
    if (q) {
      const nq = normalize(q);
      // Bloc de contexte : la ligne qui matche ± 3 lignes voisines.
      const keep = new Set();
      lines.forEach((l, i) => {
        if (normalize(l).includes(nq)) {
          for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) keep.add(j);
        }
      });
      selected = Array.from(keep).sort((a, b) => a - b).map((i) => lines[i]);
      if (selected.length === 0) selected = lines;
    }
    let text = selected.join("\\n");
    const truncated = text.length > max;
    if (truncated) text = text.slice(0, max);
    return { text, truncated, page: pageContext() };
  }

  g.__tfsup = { collectTargets, locate, clearFocusedField, readText, pageContext };
})();
`;

/**
 * Faux curseur IA (badge + halo de clic) injecté dans le monde isolé —
 * feedback visuel identique CRM / onglets externes / sidecar serveur.
 */
export const FAKE_CURSOR_INJECT = `
(() => {
  const g = globalThis;
  if (g.__creezioFakeCursor) return;

  const CURSOR_ID = "creezio-fake-cursor";
  const HIDE_DELAY_MS = 3500;
  const CURSOR_SVG =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 2.5 L4 18.5 L8.2 14.8 L11 21 L13.6 19.8 L10.9 13.8 L16.5 13.3 Z" ' +
    'fill="#0284c7" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  class FakeCursor {
    constructor() {
      this.el = null;
      this.badge = null;
      this.x = 0;
      this.y = 0;
      this.hideTimer = null;
      this.currentAnim = null;
    }

    ensure() {
      if (this.el && document.documentElement.contains(this.el)) return this.el;
      const wrap = document.createElement("div");
      wrap.id = CURSOR_ID;
      wrap.style.cssText = [
        "position:fixed", "left:0", "top:0", "z-index:2147483000",
        "pointer-events:none", "opacity:0", "transition:opacity 220ms ease",
        "will-change:transform", "filter:drop-shadow(0 2px 5px rgba(2,132,199,.45))",
      ].join(";");
      wrap.innerHTML = CURSOR_SVG;
      const badge = document.createElement("div");
      badge.textContent = "IA";
      badge.style.cssText = [
        "position:absolute", "left:18px", "top:20px", "background:#0284c7",
        "color:white", "font:600 9px/1 system-ui,sans-serif", "letter-spacing:.06em",
        "padding:3px 6px", "border-radius:9999px", "border:1.5px solid white",
        "white-space:nowrap",
      ].join(";");
      wrap.appendChild(badge);
      (document.documentElement || document.body).appendChild(wrap);
      this.el = wrap;
      this.badge = badge;
      this.x = window.innerWidth / 2;
      this.y = window.innerHeight / 2;
      wrap.style.transform = "translate(" + this.x + "px, " + this.y + "px)";
      return wrap;
    }

    show() {
      const el = this.ensure();
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = null;
      el.style.opacity = "1";
    }

    hideSoon(delayMs) {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        if (this.el) this.el.style.opacity = "0";
      }, delayMs == null ? HIDE_DELAY_MS : delayMs);
    }

    moveTo(x, y) {
      const el = this.ensure();
      this.show();
      if (this.currentAnim) try { this.currentAnim.cancel(); } catch (e) { /* ignore */ }
      const dx = x - this.x;
      const dy = y - this.y;
      const dist = Math.hypot(dx, dy);
      const duration = Math.max(320, Math.min(1100, dist * 1.35));
      const fromX = this.x;
      const fromY = this.y;
      return new Promise((resolve) => {
        const anim = el.animate(
          [
            { transform: "translate(" + fromX + "px, " + fromY + "px)" },
            { transform: "translate(" + x + "px, " + y + "px)" },
          ],
          { duration: duration, easing: "cubic-bezier(.3,.9,.35,1)", fill: "forwards" },
        );
        this.currentAnim = anim;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          this.x = x;
          this.y = y;
          el.style.transform = "translate(" + x + "px, " + y + "px)";
          try { anim.cancel(); } catch (e) { /* ignore */ }
          resolve();
        };
        anim.onfinish = finish;
        anim.oncancel = finish;
        // Fenêtre occluse / arrière-plan : onfinish peut ne JAMAIS tirer
        // (compositeur throttlé) — garde-fou temporel obligatoire.
        setTimeout(finish, duration + 250);
      });
    }

    clickEffect() {
      this.ensure();
      const ripple = document.createElement("div");
      ripple.style.cssText = [
        "position:fixed",
        "left:" + (this.x - 16) + "px",
        "top:" + (this.y - 16) + "px",
        "width:32px", "height:32px", "border-radius:9999px",
        "border:2.5px solid #0284c7", "background:rgba(2,132,199,.18)",
        "z-index:2147482999", "pointer-events:none",
      ].join(";");
      (document.documentElement || document.body).appendChild(ripple);
      return new Promise((resolve) => {
        const anim = ripple.animate(
          [
            { transform: "scale(.4)", opacity: 1 },
            { transform: "scale(1.7)", opacity: 0 },
          ],
          { duration: 420, easing: "ease-out" },
        );
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          ripple.remove();
          resolve();
        };
        anim.onfinish = finish;
        anim.oncancel = finish;
        // Même garde-fou que moveTo (fenêtre occluse → pas de compositeur).
        setTimeout(finish, 700);
      });
    }
  }

  g.__creezioFakeCursor = new FakeCursor();
})();
`;
