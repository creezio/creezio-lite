"use client";

/**
 * Exécuteur d'actions UI de l'assistant (souris virtuelle).
 *
 * Reçoit les actions via CustomEvent `creezio-assistant-ui-action` (relayées par
 * le widget depuis le flux SSE), les exécute visuellement dans la page
 * (déplacement du faux curseur + vrais événements DOM), puis renvoie le
 * résultat au serveur : POST /api/v1/assistant/ui-actions/:id/result.
 */

import { useEffect } from "react";
import { getFakeCursor } from "./fake-cursor";
import { resolveAidAttr } from "@creezio/shell-ui/ui";

export const UI_ACTION_EVENT = "creezio-assistant-ui-action";
/** @deprecated alias kit */
export const UI_ACTION_EVENT_LEGACY = "tf2-assistant-ui-action";

type UiActionDetail = {
  actionId: string;
  type: "list_targets" | "click" | "type" | "scroll";
  params: Record<string, unknown>;
};

type TargetInfo = {
  ref: string;
  label: string;
  kind: string;
  aid?: string;
  href?: string;
};

/* ── Registre de cibles (refs stables entre list_targets et click) ── */

let generation = 0;
const targetMap = new Map<string, WeakRef<Element>>();

function interactiveSelector(): string {
  return [
    "a[href]",
    "button",
    '[role="button"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="combobox"]',
    'input:not([type="hidden"])',
    "select",
    "textarea",
    `[${resolveAidAttr()}]`,
  ].join(", ");
}

function isVisible(el: Element): boolean {
  if (el.closest("[data-creezio-assistant-ui]")) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const he = el as HTMLElement;
  if (he.hidden) return false;
  if ((he as HTMLButtonElement).disabled) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  // Marge : on liste aussi ce qui est juste hors écran (scroll léger).
  const margin = 300;
  if (
    rect.bottom < -margin ||
    rect.top > window.innerHeight + margin ||
    rect.right < -margin ||
    rect.left > window.innerWidth + margin
  ) {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  return true;
}

function labelFor(el: Element): string {
  const he = el as HTMLElement;
  const aria = he.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const title = he.getAttribute("title");
  if (title?.trim()) return title.trim();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const ph = el.placeholder?.trim();
    if (ph) return ph;
    if (el.name) return el.name;
  }
  const text = (he.innerText || he.textContent || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 90);
}

function kindFor(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "input") {
    return `input:${(el as HTMLInputElement).type || "text"}`;
  }
  return tag;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pageContext() {
  const h1 = document.querySelector("h1");
  return {
    path: window.location.pathname + window.location.search,
    title: document.title,
    heading: h1 ? (h1.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) : null,
  };
}

function collectTargets(q?: string): {
  targets: TargetInfo[];
  truncated: boolean;
  note?: string;
} {
  generation += 1;
  // On CONSERVE les refs des générations précédentes : le LLM réutilise souvent
  // une ref d'un scan antérieur ; tant que l'élément vit, le clic doit marcher.
  if (targetMap.size > 2000) targetMap.clear();

  const scan = (nq: string): TargetInfo[] => {
    const seen = new Set<Element>();
    const out: TargetInfo[] = [];
    let idx = 0;
    for (const el of Array.from(document.querySelectorAll(interactiveSelector()))) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (!isVisible(el)) continue;

      const aid = el.getAttribute(resolveAidAttr()) || undefined;
      const label = labelFor(el);
      if (!label && !aid) continue;

      const href =
        el instanceof HTMLAnchorElement ? el.getAttribute("href") || undefined : undefined;
      if (nq) {
        const hay = normalize(`${label} ${aid || ""} ${href || ""}`);
        if (!hay.includes(nq)) continue;
      }

      idx += 1;
      const ref = `t${generation}-${idx}`;
      targetMap.set(ref, new WeakRef(el));
      out.push({ ref, label, kind: kindFor(el), aid, href });
      if (out.length >= 120) break;
    }
    return out;
  };

  const nq = q ? normalize(q) : "";
  let targets = scan(nq);
  let note: string | undefined;
  if (nq && targets.length === 0) {
    // Auto-réparation : plutôt que « 0 cible », renvoyer la liste complète.
    targets = scan("");
    note = `Aucune cible ne contient « ${q} » — liste complète renvoyée à la place.`;
  }
  return { targets, truncated: targets.length >= 120, note };
}

/** Similarité Dice sur bigrammes — suffisant pour suggérer des labels proches. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const bigrams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let inter = 0;
  let totalA = 0;
  let totalB = 0;
  ba.forEach((c) => {
    totalA += c;
  });
  bb.forEach((c) => {
    totalB += c;
  });
  ba.forEach((c, bg) => {
    inter += Math.min(c, bb.get(bg) || 0);
  });
  return totalA + totalB ? (2 * inter) / (totalA + totalB) : 0;
}

type Candidate = { el: Element; label: string; aid?: string; score: number };

function scoreCandidates(query: string): Candidate[] {
  const out: Candidate[] = [];
  for (const el of Array.from(document.querySelectorAll(interactiveSelector()))) {
    if (!isVisible(el)) continue;
    const aid = el.getAttribute(resolveAidAttr()) || undefined;
    const label = labelFor(el);
    if (!label && !aid) continue;
    const score = Math.max(
      similarity(query, label),
      aid ? similarity(query, aid) : 0,
    );
    out.push({ el, label, aid, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Résolution avec auto-réparation :
 * 1. resolveTarget direct (ref mémorisée, aid exact, label exact/inclusif) ;
 * 2. fuzzy match sur la page courante ;
 * 3. scroll d'une page + nouvelle tentative ;
 * 4. échec → suggestions (5 labels les plus proches) pour guider le LLM.
 */
async function resolveWithRepair(
  refArg?: string,
  labelArg?: string,
): Promise<{ el: Element | null; suggestions: string[] }> {
  let el = resolveTarget(refArg, labelArg);
  if (el) return { el, suggestions: [] };

  const query = labelArg || refArg || "";
  if (query) {
    const scored = scoreCandidates(query);
    if (scored[0] && scored[0].score >= 0.6) {
      return { el: scored[0].el, suggestions: [] };
    }
    // Peut-être hors écran : un scroll puis on retente.
    const root = findScrollableRoot();
    root.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: "smooth" });
    await sleep(550);
    el = resolveTarget(refArg, labelArg);
    if (el) return { el, suggestions: [] };
    const rescored = scoreCandidates(query);
    if (rescored[0] && rescored[0].score >= 0.6) {
      return { el: rescored[0].el, suggestions: [] };
    }
    const suggestions = rescored
      .filter((c) => c.score > 0.2)
      .slice(0, 5)
      .map((c) => (c.aid ? `${c.label} (aid=${c.aid})` : c.label));
    return { el: null, suggestions };
  }
  return { el: null, suggestions: [] };
}

/** Toasts sonner actuellement affichés (feedback réel des actions métier). */
function visibleToasts(): string[] {
  return Array.from(document.querySelectorAll("[data-sonner-toast]"))
    .map((t) => (t.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function resolveTarget(refArg?: string, labelArg?: string): Element | null {
  if (refArg) {
    const el = targetMap.get(refArg)?.deref();
    if (el && document.contains(el) && isVisible(el)) return el;
    // Le LLM passe parfois un aid (ex. « search.q » ou « produit.123.panier ») en ref.
    if (!/^t\d+-\d+$/.test(refArg)) {
      const nr = normalize(refArg);
      for (const cand of Array.from(document.querySelectorAll(`[${resolveAidAttr()}]`))) {
        if (normalize(cand.getAttribute(resolveAidAttr()) || "") === nr && isVisible(cand)) {
          return cand;
        }
      }
    }
  }
  if (labelArg) {
    const nl = normalize(labelArg);
    // 1. aidAttr exact
    for (const el of Array.from(document.querySelectorAll(`[${resolveAidAttr()}]`))) {
      if (normalize(el.getAttribute(resolveAidAttr()) || "") === nl && isVisible(el)) {
        return el;
      }
    }
    // 2. label exact puis inclusif sur les éléments interactifs
    let partial: Element | null = null;
    for (const el of Array.from(document.querySelectorAll(interactiveSelector()))) {
      if (!isVisible(el)) continue;
      const l = normalize(labelFor(el));
      if (!l) continue;
      if (l === nl) return el;
      if (!partial && (l.includes(nl) || nl.includes(l))) partial = el;
    }
    return partial;
  }
  return null;
}

/* ── Événements synthétiques ── */

function pointerOpts(x: number, y: number): PointerEventInit & MouseEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    pointerId: 9001,
    pointerType: "mouse",
    isPrimary: true,
  };
}

function synthClick(el: Element, x: number, y: number) {
  const opts = pointerOpts(x, y);
  el.dispatchEvent(new PointerEvent("pointerover", opts));
  el.dispatchEvent(new PointerEvent("pointerenter", { ...opts, bubbles: false }));
  el.dispatchEvent(new PointerEvent("pointermove", opts));
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  (el as HTMLElement).focus?.({ preventScroll: true });
  el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("click", { ...opts, buttons: 0, detail: 1 }));
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function moveCursorToElement(el: Element): Promise<{ x: number; y: number }> {
  const cursor = getFakeCursor();
  cursor.show();

  let rect = el.getBoundingClientRect();
  const outOfView =
    rect.top < 60 || rect.bottom > window.innerHeight - 20 || rect.left < 0 || rect.right > window.innerWidth;
  if (outOfView) {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    await sleep(450);
    rect = el.getBoundingClientRect();
  }

  const x = rect.left + Math.min(rect.width / 2, 160);
  const y = rect.top + rect.height / 2;
  await cursor.moveTo(x, y);
  return { x, y };
}

/* ── Handlers d'actions ── */

async function handleListTargets(params: Record<string, unknown>) {
  const q = typeof params.q === "string" ? params.q : undefined;
  const { targets, truncated, note } = collectTargets(q);
  return { ok: true, page: pageContext(), targets, truncated, ...(note ? { note } : {}) };
}

async function handleClick(params: Record<string, unknown>) {
  const ref = typeof params.ref === "string" ? params.ref : undefined;
  const label = typeof params.label === "string" ? params.label : undefined;
  const { el, suggestions } = await resolveWithRepair(ref, label);
  if (!el) {
    return {
      ok: false,
      error: `Cible introuvable (ref=${ref || "—"}, label=${label || "—"}). Refaire ui_list_targets.`,
      suggestions,
      page: pageContext(),
    };
  }
  const cursor = getFakeCursor();
  const { x, y } = await moveCursorToElement(el);
  await cursor.clickEffect();
  synthClick(el, x, y);
  cursor.hideSoon();
  // Laisser la navigation / le re-render RSC se produire.
  await sleep(850);
  // Les toasts (ex. « Ajouté au panier ») peuvent arriver après le fetch : polling ~4 s.
  let toasts = visibleToasts();
  for (let i = 0; i < 16 && !toasts.length; i++) {
    await sleep(250);
    toasts = visibleToasts();
  }
  return {
    ok: true,
    page: pageContext(),
    clicked: labelFor(el) || ref || label,
    toasts,
  };
}

async function handleType(params: Record<string, unknown>) {
  const ref = typeof params.ref === "string" ? params.ref : undefined;
  const label = typeof params.label === "string" ? params.label : undefined;
  const text = typeof params.text === "string" ? params.text : "";
  const submit = params.submit === true;

  const resolved = await resolveWithRepair(ref, label);
  let el: Element | null = resolved.el;
  // Si la cible n'est pas un champ, chercher un input à l'intérieur.
  if (el && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    el = el.querySelector("input, textarea");
  }
  if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return {
      ok: false,
      error: `Champ de saisie introuvable (ref=${ref || "—"}, label=${label || "—"}).`,
      suggestions: resolved.suggestions,
      page: pageContext(),
    };
  }

  const cursor = getFakeCursor();
  const { x, y } = await moveCursorToElement(el);
  await cursor.clickEffect();
  synthClick(el, x, y);
  await sleep(120);

  // Frappe progressive (vitesse plafonnée pour les textes longs).
  setNativeValue(el, "");
  const perChar = Math.max(18, Math.min(55, Math.floor(1600 / Math.max(text.length, 1))));
  let acc = "";
  for (const ch of text) {
    acc += ch;
    setNativeValue(el, acc);
    await sleep(perChar);
  }

  if (submit) {
    const keyOpts = { bubbles: true, cancelable: true, key: "Enter", code: "Enter" };
    el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
    el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
    el.form?.requestSubmit();
  }

  cursor.hideSoon();
  // Debounce recherche (300 ms) + refresh RSC.
  await sleep(900);
  return { ok: true, page: pageContext(), typed: text, toasts: visibleToasts() };
}

function findScrollableRoot(): Element {
  const doc = document.scrollingElement;
  if (doc && doc.scrollHeight > doc.clientHeight + 50) return doc;
  // Layout à conteneur défilant : prendre le plus grand candidat.
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(document.querySelectorAll("main, [data-scroll-root], div"))) {
    if (el.closest("[data-creezio-assistant-ui]")) continue;
    const he = el as HTMLElement;
    if (he.scrollHeight <= he.clientHeight + 50) continue;
    const style = window.getComputedStyle(he);
    if (!/(auto|scroll)/.test(style.overflowY)) continue;
    const rect = he.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  return best || doc || document.documentElement;
}

async function handleScroll(params: Record<string, unknown>) {
  const direction = params.direction === "up" ? -1 : 1;
  const root = findScrollableRoot();
  const delta = direction * Math.round(window.innerHeight * 0.75);
  root.scrollBy({ top: delta, behavior: "smooth" });
  const cursor = getFakeCursor();
  cursor.show();
  cursor.hideSoon(1500);
  await sleep(650);
  return { ok: true, page: pageContext() };
}

async function executeUiAction(detail: UiActionDetail): Promise<Record<string, unknown>> {
  try {
    switch (detail.type) {
      case "list_targets":
        return await handleListTargets(detail.params);
      case "click":
        return await handleClick(detail.params);
      case "type":
        return await handleType(detail.params);
      case "scroll":
        return await handleScroll(detail.params);
      default:
        return { ok: false, error: `Action inconnue: ${String(detail.type)}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erreur exécution action UI",
      page: pageContext(),
    };
  }
}

/** API réutilisée par les partitions Electron d'espace IA. */
export function runUiAction(detail: { type: string; params: Record<string, unknown> }) {
  return executeUiAction({ ...detail, type: detail.type as UiActionDetail["type"], actionId: "workspace" });
}
export async function runUiNavigate(href: string, navigate: (href: string) => void) {
  if (!href || (!href.startsWith("/") && !/^https?:\/\//i.test(href))) {
    return { ok: false, error: "Chemin de navigation invalide" };
  }
  navigate(href);
  return { ok: true, href };
}

export function UiDriver() {
  useEffect(() => {
    let disposed = false;

    async function onAction(e: Event) {
      const detail = (e as CustomEvent<UiActionDetail>).detail;
      if (!detail?.actionId || !detail.type) return;
      const result = await executeUiAction(detail);
      if (disposed) {
        /* la page a été démontée : on tente quand même le POST */
      }
      try {
        await fetch(`/api/v1/assistant/ui-actions/${encodeURIComponent(detail.actionId)}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
          keepalive: true,
        });
      } catch {
        /* le serveur timeoutera */
      }
    }

    window.addEventListener(UI_ACTION_EVENT, onAction);
    window.addEventListener(UI_ACTION_EVENT_LEGACY, onAction);
    return () => {
      disposed = true;
      window.removeEventListener(UI_ACTION_EVENT, onAction);
      window.removeEventListener(UI_ACTION_EVENT_LEGACY, onAction);
    };
  }, []);

  return null;
}
