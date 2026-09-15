/**
 * Driver `external_*` / `ui_*` PORTABLE — logique unique Electron ↔ Chromium
 * sidecar derrière l'interface `CdpTransport`.
 *
 * - RÉSOLUTION des cibles : `DRIVER_HELPERS` (monde isolé, voir
 *   driver-scripts.ts) via `transport.evalIsolated`.
 * - ENTRÉES : CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent` via
 *   `transport.cdp` → événements TRUSTED (indiscernables d'un humain).
 * - Feedback visuel : faux curseur IA (FAKE_CURSOR_INJECT, best-effort).
 *
 * Contrat transport : `evalIsolated` évalue une expression dans un monde
 * isolé où DRIVER_HELPERS + FAKE_CURSOR_INJECT sont déjà (ré)injectés.
 */

export type DriverResult = Record<string, unknown>;
export type DriverParams = Record<string, unknown>;

export type CdpTransport = {
  /** Commande CDP sur la page cible (Input.*, Page.*, …). */
  cdp: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  /**
   * Évalue `expression` dans le monde isolé du driver (DRIVER_HELPERS et
   * FAKE_CURSOR_INJECT préinjectés — idempotents). Await des promesses.
   */
  evalIsolated: <T>(expression: string) => Promise<T>;
  /** Taille du viewport (scroll). */
  viewport: () => Promise<{ width: number; height: number }>;
  /** URL / titre si le monde isolé est injoignable (page en chargement…). */
  fallbackPage: () => Promise<{ url: string; title: string }>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function driverPageContext(t: CdpTransport): Promise<DriverResult> {
  try {
    return await t.evalIsolated<DriverResult>("globalThis.__tfsup.pageContext()");
  } catch {
    const fb = await t.fallbackPage().catch(() => ({ url: "", title: "" }));
    return { url: fb.url, title: fb.title };
  }
}

/**
 * Faux curseur : déplacement + halo AVANT le clic CDP. Borne dure 2 s — le
 * feedback visuel ne doit JAMAIS bloquer l'action (page occluse / throttlée).
 */
async function showFakeCursorAt(
  t: CdpTransport,
  x: number,
  y: number,
): Promise<void> {
  try {
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 2000));
    const anim = t
      .evalIsolated<void>(
        `(async () => {
          const c = globalThis.__creezioFakeCursor;
          if (!c) return;
          await c.moveTo(${Math.round(x)}, ${Math.round(y)});
          await c.clickEffect();
          c.hideSoon();
        })()`,
      )
      .catch(() => {});
    await Promise.race([anim, deadline]);
  } catch {
    /* feedback best-effort — le clic CDP suit quoi qu'il arrive */
  }
}

export async function trustedClick(
  t: CdpTransport,
  x: number,
  y: number,
): Promise<void> {
  await showFakeCursorAt(t, x, y);
  await t.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await sleep(60);
  await t.cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await sleep(40);
  await t.cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

export async function trustedTypeText(
  t: CdpTransport,
  text: string,
): Promise<void> {
  // Frappe caractère par caractère (vitesse plafonnée, comme ui-driver.tsx).
  const perChar = Math.max(18, Math.min(55, Math.floor(1600 / Math.max(text.length, 1))));
  for (const ch of text) {
    await t.cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: ch,
      unmodifiedText: ch,
      key: ch,
    });
    await t.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(perChar);
  }
}

export async function trustedEnter(t: CdpTransport): Promise<void> {
  const common = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  await t.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
  await t.cdp("Input.dispatchKeyEvent", {
    type: "char",
    text: "\r",
    unmodifiedText: "\r",
    ...common,
  });
  await t.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}

type LocateResult = {
  ok: boolean;
  x?: number;
  y?: number;
  label?: string;
  isField?: boolean;
  suggestions?: string[];
  page?: DriverResult;
};

async function locateTarget(
  t: CdpTransport,
  ref?: string,
  label?: string,
): Promise<LocateResult> {
  return t.evalIsolated<LocateResult>(
    `globalThis.__tfsup.locate(${JSON.stringify(ref ?? null)}, ${JSON.stringify(label ?? null)})`,
  );
}

export async function driverListTargets(
  t: CdpTransport,
  params: DriverParams,
): Promise<DriverResult> {
  const q = typeof params.q === "string" ? params.q : undefined;
  const res = await t.evalIsolated<{
    targets: unknown[];
    truncated: boolean;
    note?: string;
  }>(`globalThis.__tfsup.collectTargets(${JSON.stringify(q ?? null)})`);
  const page = await driverPageContext(t);
  return { ok: true, page, ...res };
}

export async function driverClick(
  t: CdpTransport,
  params: DriverParams,
): Promise<DriverResult> {
  const ref = typeof params.ref === "string" ? params.ref : undefined;
  const label = typeof params.label === "string" ? params.label : undefined;
  const loc = await locateTarget(t, ref, label);
  if (!loc.ok || loc.x == null || loc.y == null) {
    return {
      ok: false,
      error: `Cible introuvable (ref=${ref || "—"}, label=${label || "—"}). Refaire external_list_targets (alias supplier_list_targets).`,
      suggestions: loc.suggestions || [],
      page: loc.page || (await driverPageContext(t)),
    };
  }
  await trustedClick(t, loc.x, loc.y);
  // Laisser une éventuelle navigation / rendu se produire.
  await sleep(1200);
  return { ok: true, page: await driverPageContext(t), clicked: loc.label || ref || label };
}

export async function driverType(
  t: CdpTransport,
  params: DriverParams,
): Promise<DriverResult> {
  const ref = typeof params.ref === "string" ? params.ref : undefined;
  const label = typeof params.label === "string" ? params.label : undefined;
  const text = typeof params.text === "string" ? params.text : "";
  const submit = params.submit === true;

  const loc = await locateTarget(t, ref, label);
  if (!loc.ok || loc.x == null || loc.y == null) {
    return {
      ok: false,
      error: `Champ introuvable (ref=${ref || "—"}, label=${label || "—"}).`,
      suggestions: loc.suggestions || [],
      page: loc.page || (await driverPageContext(t)),
    };
  }
  await trustedClick(t, loc.x, loc.y);
  await sleep(150);
  await t.evalIsolated<boolean>("globalThis.__tfsup.clearFocusedField()");
  await trustedTypeText(t, text);
  if (submit) {
    await sleep(120);
    await trustedEnter(t);
  }
  await sleep(900);
  return { ok: true, page: await driverPageContext(t), typed: text };
}

export async function driverScroll(
  t: CdpTransport,
  params: DriverParams,
): Promise<DriverResult> {
  const direction = params.direction === "up" ? -1 : 1;
  const { width, height } = await t.viewport();
  const deltaY = direction * Math.round(Math.max(height, 400) * 0.75);
  await t.cdp("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: Math.round(width / 2),
    y: Math.round(Math.max(height, 400) / 2),
    deltaX: 0,
    deltaY,
  });
  await sleep(650);
  return { ok: true, page: await driverPageContext(t) };
}

export async function driverRead(
  t: CdpTransport,
  params: DriverParams,
): Promise<DriverResult> {
  const q = typeof params.q === "string" ? params.q : undefined;
  const maxChars = typeof params.maxChars === "number" ? params.maxChars : undefined;
  const res = await t.evalIsolated<DriverResult>(
    `globalThis.__tfsup.readText(${JSON.stringify(q ?? null)}, ${JSON.stringify(maxChars ?? null)})`,
  );
  return { ok: true, ...res };
}

/**
 * Capture JPEG compressée (vision LLM) — quality 60 ≈ 40-120 Ko sur une page
 * classique, assez pour lire l'UI sans exploser le contexte du modèle.
 */
export async function driverScreenshot(t: CdpTransport): Promise<DriverResult> {
  const res = await t.cdp("Page.captureScreenshot", { format: "jpeg", quality: 60 });
  const data = String(res.data || "");
  if (!data) {
    return { ok: false, error: "Capture d'écran vide", page: await driverPageContext(t) };
  }
  return { ok: true, page: await driverPageContext(t), imageBase64: data, format: "jpeg" };
}

export type DriverVerb =
  | "list_targets"
  | "click"
  | "type"
  | "scroll"
  | "read"
  | "screenshot";

/** Normalise external_* / supplier_* / ui_* → verbe driver (null si tab-level). */
export function driverVerbOf(actionType: string): DriverVerb | null {
  const n = String(actionType || "")
    .replace(/^supplier_/, "external_")
    .replace(/^ui_/, "external_")
    .replace(/^external_/, "");
  switch (n) {
    case "list_targets":
    case "click":
    case "type":
    case "scroll":
    case "read":
    case "screenshot":
      return n;
    default:
      return null;
  }
}

/** Exécute un verbe driver sur le transport (jamais de throw). */
export async function runDriverVerb(
  t: CdpTransport,
  verb: DriverVerb,
  params: DriverParams,
): Promise<DriverResult> {
  try {
    switch (verb) {
      case "list_targets":
        return await driverListTargets(t, params);
      case "click":
        return await driverClick(t, params);
      case "type":
        return await driverType(t, params);
      case "scroll":
        return await driverScroll(t, params);
      case "read":
        return await driverRead(t, params);
      case "screenshot":
        return await driverScreenshot(t);
      default:
        return { ok: false, error: `Verbe driver inconnu: ${String(verb)}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erreur exécution action driver",
    };
  }
}
