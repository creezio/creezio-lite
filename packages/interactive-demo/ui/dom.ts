/**
 * Utilitaires DOM du lecteur de démo : résolution des cibles (`DemoTarget` :
 * sélecteur CSS, `data-aid` shell-ui, libellé d'élément interactif),
 * événements synthétiques (clic pointeur complet, frappe caractère par
 * caractère compatible React) et déplacement du faux curseur.
 */

import type { DemoTarget } from "@creezio/interactive-demo";
import { resolveAidAttr } from "@creezio/shell-ui/ui";
import { getDemoCursor } from "./fake-cursor";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

export function isVisible(el: Element): boolean {
  if (el.closest("[data-creezio-demo-ui]")) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const he = el as HTMLElement;
  if (he.hidden) return false;
  if ((he as HTMLButtonElement).disabled) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  const margin = 400;
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

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function scope(within?: string): ParentNode {
  if (within) {
    const root = document.querySelector(within);
    if (root) return root;
  }
  return document;
}

function findByText(text: string, within?: string): Element | null {
  const needle = normalize(text);
  if (!needle) return null;
  let partial: Element | null = null;
  for (const el of Array.from(scope(within).querySelectorAll(interactiveSelector()))) {
    if (!isVisible(el)) continue;
    const label = normalize(labelFor(el));
    if (!label) continue;
    if (label === needle) return el;
    if (!partial && (label.includes(needle) || needle.includes(label))) partial = el;
  }
  return partial;
}

function findByAid(aid: string, within?: string): Element | null {
  const attr = resolveAidAttr();
  const needle = normalize(aid);
  for (const el of Array.from(scope(within).querySelectorAll(`[${attr}]`))) {
    if (normalize(el.getAttribute(attr) || "") === needle && isVisible(el)) return el;
  }
  return null;
}

function findBySelector(selector: string, within?: string): Element | null {
  try {
    for (const el of Array.from(scope(within).querySelectorAll(selector))) {
      if (isVisible(el)) return el;
    }
  } catch {
    /* sélecteur invalide → autres stratégies */
  }
  return null;
}

/** Résolution ponctuelle d'une cible (null si introuvable/invisible). */
export function resolveDemoTarget(target: DemoTarget): Element | null {
  if (typeof target === "string") {
    return (
      findBySelector(target) || findByAid(target) || findByText(target)
    );
  }
  const { selector, aid, text, within } = target;
  if (selector) {
    const el = findBySelector(selector, within);
    if (el) return el;
  }
  if (aid) {
    const el = findByAid(aid, within);
    if (el) return el;
  }
  if (text) {
    const el = findByText(text, within);
    if (el) return el;
  }
  return null;
}

/**
 * Attend la cible (polling 150 ms) — les pages App Router chargent en
 * asynchrone. Renvoie null au timeout, jamais de throw.
 */
export async function waitForDemoTarget(
  target: DemoTarget,
  timeoutMs = 6000,
  isCancelled?: () => boolean,
): Promise<Element | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    if (isCancelled?.()) return null;
    const el = resolveDemoTarget(target);
    if (el) return el;
    if (Date.now() >= deadline) return null;
    await sleep(150);
  }
}

/* ── Événements synthétiques (mêmes séquences que la souris réelle) ── */

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
    pointerId: 9002,
    pointerType: "mouse",
    isPrimary: true,
  };
}

export function synthClick(el: Element, x: number, y: number) {
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

/** Pose la valeur via le setter natif (déclenche l'onChange React). */
export function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Frappe progressive avec touches simulées (vitesse plafonnée). */
export async function typeInto(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  isCancelled?: () => boolean,
) {
  setNativeValue(el, "");
  const perChar = Math.max(28, Math.min(75, Math.floor(2200 / Math.max(text.length, 1))));
  let acc = "";
  for (const ch of text) {
    if (isCancelled?.()) return;
    const keyOpts = { bubbles: true, cancelable: true, key: ch };
    el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
    acc += ch;
    setNativeValue(el, acc);
    el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
    await sleep(perChar);
  }
}

export function submitField(el: HTMLInputElement | HTMLTextAreaElement) {
  const keyOpts = { bubbles: true, cancelable: true, key: "Enter", code: "Enter" };
  el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
  el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
  el.form?.requestSubmit();
}

/** Conteneur défilant principal (layouts à scroll interne inclus). */
export function findScrollableRoot(): Element {
  const doc = document.scrollingElement;
  if (doc && doc.scrollHeight > doc.clientHeight + 50) return doc;
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(
    document.querySelectorAll("main, [data-scroll-root], div"),
  )) {
    if (el.closest("[data-creezio-demo-ui]")) continue;
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

/** Scroll la cible au centre si besoin puis amène le curseur dessus. */
export async function moveCursorToElement(
  el: Element,
): Promise<{ x: number; y: number }> {
  const cursor = getDemoCursor();
  cursor.show();

  let rect = el.getBoundingClientRect();
  const outOfView =
    rect.top < 60 ||
    rect.bottom > window.innerHeight - 20 ||
    rect.left < 0 ||
    rect.right > window.innerWidth;
  if (outOfView) {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    await sleep(450);
    rect = el.getBoundingClientRect();
  }

  const x = rect.left + Math.min(rect.width / 2, 180);
  const y = rect.top + rect.height / 2;
  await cursor.moveTo(x, y);
  return { x, y };
}
