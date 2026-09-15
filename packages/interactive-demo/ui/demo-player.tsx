"use client";

/**
 * Lecteur de démo interactive — exécute un `DemoScenario` en live dans la
 * page : spotlight sur les cibles, cartes de narration, faux curseur qui
 * clique et tape réellement (mêmes événements DOM qu'une souris).
 *
 * Monté par `InteractiveDemoRoot` (démo en cours) ou directement par une
 * marque. Styles : `@creezio/interactive-demo/ui/interactive-demo.css`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkspaceTabNavigate } from "@creezio/shell-ui/ui";
import type {
  DemoScenario,
  DemoStep,
  DemoTarget,
} from "@creezio/interactive-demo";
import { getDemoCursor } from "./fake-cursor";
import {
  findScrollableRoot,
  moveCursorToElement,
  resolveDemoTarget,
  sleep,
  submitField,
  synthClick,
  typeInto,
  waitForDemoTarget,
} from "./dom";

export type DemoPlayerProps = {
  scenario: DemoScenario;
  /** Fin normale (dernière étape jouée). */
  onFinish?: () => void;
  /** Sortie anticipée (bouton « Quitter »). */
  onExit?: () => void;
  /**
   * Navigation SPA (ex. `router.push` Next). Le player préfère toujours le
   * `navigate` du workspace onglets kit s'il est monté
   * (`getWorkspaceTabNavigate`) : un `router.push` direct sur l'onglet
   * épinglé Dashboard serait réaligné par le provider. Cette prop est le
   * fallback hors workspace ; défaut final : `window.location.assign`
   * (rechargement complet).
   */
  navigate?: (href: string) => void;
  /** Libellé du badge du curseur (défaut « Démo »). */
  cursorLabel?: string;
};

type Rect = { left: number; top: number; width: number; height: number };

type CardState = {
  kicker: string;
  title?: string;
  body?: string;
  centered: boolean;
  /** Ancre : rect de la cible (carte positionnée autour). */
  anchor?: Rect;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  showNext: boolean;
  nextLabel?: string;
};

const CARD_W = 380;
const CARD_H_GUESS = 170;
const MARGIN = 14;

function cardPosition(anchor: Rect, placement: CardState["placement"]): {
  left: number;
  top: number;
} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 32);
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  const below = anchor.top + anchor.height + MARGIN;
  const above = anchor.top - CARD_H_GUESS - MARGIN;
  const right = anchor.left + anchor.width + MARGIN;
  const left = anchor.left - w - MARGIN;

  const fitsBelow = below + CARD_H_GUESS < vh - 90;
  const fitsAbove = above > 12;
  const fitsRight = right + w < vw - 12;
  const fitsLeft = left > 12;

  let p = placement && placement !== "auto" ? placement : undefined;
  if (!p) {
    p = fitsBelow ? "bottom" : fitsAbove ? "top" : fitsRight ? "right" : "left";
  }

  const centeredX = clamp(
    anchor.left + anchor.width / 2 - w / 2,
    16,
    vw - w - 16,
  );
  const centeredY = clamp(
    anchor.top + anchor.height / 2 - CARD_H_GUESS / 2,
    12,
    vh - CARD_H_GUESS - 100,
  );

  switch (p) {
    case "bottom":
      return { left: centeredX, top: clamp(below, 12, vh - CARD_H_GUESS - 100) };
    case "top":
      return { left: centeredX, top: clamp(above, 12, vh - CARD_H_GUESS - 100) };
    case "right":
      return { left: clamp(right, 16, vw - w - 16), top: centeredY };
    case "left":
      return { left: clamp(left, 16, vw - w - 16), top: centeredY };
  }
}

export function DemoPlayer({
  scenario,
  onFinish,
  onExit,
  navigate,
  cursorLabel,
}: DemoPlayerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [veil, setVeil] = useState(false);
  const [card, setCard] = useState<CardState | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const advanceRef = useRef<(() => void) | null>(null);
  const spotlightElRef = useRef<Element | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = scenario.steps.length;

  /** Bouton « Suivant » : résout l'attente en cours. */
  const advance = useCallback(() => {
    advanceRef.current?.();
    advanceRef.current = null;
  }, []);

  const exit = useCallback(() => {
    runIdRef.current += 1;
    advanceRef.current?.();
    advanceRef.current = null;
    getDemoCursor().hide();
    onExit?.();
  }, [onExit]);

  // Suivi du rect de la cible spotlightée (scroll / resize / re-render).
  useEffect(() => {
    let raf = 0;
    const track = () => {
      const el = spotlightElRef.current;
      if (el && document.contains(el)) {
        const r = el.getBoundingClientRect();
        setSpotlight((prev) => {
          if (
            prev &&
            Math.abs(prev.left - r.left) < 1 &&
            Math.abs(prev.top - r.top) < 1 &&
            Math.abs(prev.width - r.width) < 1 &&
            Math.abs(prev.height - r.height) < 1
          ) {
            return prev;
          }
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        });
      }
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const runId = ++runIdRef.current;
    const cancelled = () => runIdRef.current !== runId;

    const cursor = getDemoCursor();
    cursor.setLabel(cursorLabel ?? "Démo");

    const showNote = (text: string) => {
      setNote(text);
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(() => setNote(null), 2600);
    };

    const clearStage = () => {
      spotlightElRef.current = null;
      setSpotlight(null);
      setVeil(false);
      setCard(null);
    };

    /** Attente du bouton « Suivant » (ou avance auto). */
    const waitAdvance = (step: DemoStep) =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          advanceRef.current = null;
          resolve();
        };
        advanceRef.current = finish;
        if (typeof step.autoAdvanceMs === "number" && step.autoAdvanceMs > 0) {
          setTimeout(finish, step.autoAdvanceMs);
        }
      });

    const anchorFor = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };

    const spotlightOn = (el: Element) => {
      spotlightElRef.current = el;
      setVeil(false);
      setSpotlight(anchorFor(el));
    };

    const missTarget = async (step: DemoStep): Promise<"skip" | "stop"> => {
      // Une démo ne bloque jamais : les cibles introuvables sont sautées
      // (permissions, page vide, UI modifiée) — note discrète.
      if (step.optional === false) {
        showNote("Étape indisponible — démo interrompue.");
        return "stop";
      }
      showNote("Étape passée (élément indisponible sur cet écran).");
      return "skip";
    };

    const execStep = async (step: DemoStep, index: number): Promise<boolean> => {
      if (step.delayMs) await sleep(step.delayMs);
      if (cancelled()) return false;

      const kicker = `${scenario.title} — ${index + 1}/${total}`;
      const timeout = step.timeoutMs ?? 6000;

      switch (step.kind) {
        case "say": {
          clearStage();
          setVeil(true);
          setCard({
            kicker,
            title: step.title,
            body: step.body,
            centered: true,
            showNext: true,
            nextLabel: index === total - 1 ? "Terminer" : index === 0 ? "C'est parti" : "Suivant",
          });
          await waitAdvance(step);
          setVeil(false);
          setCard(null);
          return !cancelled();
        }

        case "navigate": {
          clearStage();
          const go =
            getWorkspaceTabNavigate() ??
            navigate ??
            ((href: string) => window.location.assign(href));
          const before = window.location.pathname;
          go(step.href);
          // Laisser la navigation App Router se poser.
          for (let i = 0; i < 30 && window.location.pathname === before; i++) {
            if (cancelled()) return false;
            await sleep(100);
          }
          await sleep(450);
          if (cancelled()) return false;
          if (step.title || step.body) {
            setVeil(true);
            setCard({
              kicker,
              title: step.title,
              body: step.body,
              centered: true,
              showNext: true,
              nextLabel: index === total - 1 ? "Terminer" : "Suivant",
            });
            await waitAdvance(step);
            setVeil(false);
            setCard(null);
          }
          return !cancelled();
        }

        case "highlight": {
          const el = await waitForDemoTarget(step.target, timeout, cancelled);
          if (cancelled()) return false;
          if (!el) {
            return (await missTarget(step)) === "skip";
          }
          const rect = el.getBoundingClientRect();
          if (rect.top < 60 || rect.bottom > window.innerHeight - 20) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
            await sleep(450);
          }
          spotlightOn(el);
          const anchor = anchorFor(el);
          await getDemoCursor().moveTo(
            anchor.left + Math.min(anchor.width / 2, 180),
            anchor.top + anchor.height / 2,
          );
          setCard({
            kicker,
            title: step.title,
            body: step.body,
            centered: false,
            anchor,
            placement: step.placement,
            showNext: true,
            nextLabel: index === total - 1 ? "Terminer" : "Suivant",
          });
          await waitAdvance(step);
          clearStage();
          getDemoCursor().hideSoon();
          return !cancelled();
        }

        case "click": {
          const el = await waitForDemoTarget(step.target, timeout, cancelled);
          if (cancelled()) return false;
          if (!el) {
            return (await missTarget(step)) === "skip";
          }
          clearStage();
          if (step.title || step.body) {
            setCard({
              kicker,
              title: step.title,
              body: step.body,
              centered: false,
              anchor: anchorFor(el),
              showNext: false,
            });
          }
          const { x, y } = await moveCursorToElement(el);
          if (cancelled()) return false;
          await getDemoCursor().clickEffect();
          synthClick(el, x, y);
          getDemoCursor().hideSoon();
          await sleep(900);
          setCard(null);
          return !cancelled();
        }

        case "type": {
          let el = await waitForDemoTarget(step.target, timeout, cancelled);
          if (cancelled()) return false;
          if (el && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
            el = el.querySelector("input, textarea");
          }
          if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
            return (await missTarget(step)) === "skip";
          }
          clearStage();
          if (step.title || step.body) {
            setCard({
              kicker,
              title: step.title,
              body: step.body,
              centered: false,
              anchor: anchorFor(el),
              showNext: false,
            });
          }
          const { x, y } = await moveCursorToElement(el);
          if (cancelled()) return false;
          await getDemoCursor().clickEffect();
          synthClick(el, x, y);
          await sleep(150);
          await typeInto(el, step.text, cancelled);
          if (cancelled()) return false;
          if (step.submit) submitField(el);
          getDemoCursor().hideSoon();
          await sleep(900);
          setCard(null);
          return !cancelled();
        }

        case "scroll": {
          clearStage();
          if (step.target) {
            const el = await waitForDemoTarget(step.target, timeout, cancelled);
            if (el) {
              el.scrollIntoView({ block: "center", behavior: "smooth" });
              await sleep(650);
              return !cancelled();
            }
          }
          const root = findScrollableRoot();
          const dir = step.direction === "up" ? -1 : 1;
          root.scrollBy({
            top: dir * Math.round(window.innerHeight * 0.75),
            behavior: "smooth",
          });
          await sleep(650);
          return !cancelled();
        }

        case "wait": {
          await sleep(step.ms);
          return !cancelled();
        }

        case "waitFor": {
          clearStage();
          // Step silencieux par défaut : carte seulement si title/body posés.
          if (step.title || step.body) {
            setCard({
              kicker,
              title: step.title,
              body: step.body,
              centered: true,
              showNext: false,
            });
          }
          const conditionMet = () => {
            if (step.target) {
              const el = resolveDemoTarget(step.target);
              if (step.absent ? el !== null : el === null) return false;
            }
            if (step.url && !window.location.pathname.startsWith(step.url)) {
              return false;
            }
            return true;
          };
          // Même cadence de polling que la résolution de cible (150 ms).
          const deadline = Date.now() + Math.max(0, step.timeoutMs ?? 8000);
          let met = conditionMet();
          while (!met && Date.now() < deadline) {
            if (cancelled()) return false;
            await sleep(150);
            met = conditionMet();
          }
          setCard(null);
          if (cancelled()) return false;
          if (!met) {
            return (await missTarget(step)) === "skip";
          }
          return true;
        }
      }
    };

    (async () => {
      for (let i = 0; i < scenario.steps.length; i++) {
        if (cancelled()) return;
        setStepIndex(i);
        const ok = await execStep(scenario.steps[i]!, i);
        if (!ok) {
          if (!cancelled()) {
            // Étape non-optionnelle en échec : sortie propre.
            clearStage();
            getDemoCursor().hide();
            onExit?.();
          }
          return;
        }
      }
      if (cancelled()) return;
      clearStage();
      getDemoCursor().hide();
      onFinish?.();
    })();

    return () => {
      runIdRef.current += 1;
      advanceRef.current = null;
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      getDemoCursor().hide();
    };
    // Le scénario est immuable pendant la lecture : relance sur changement d'id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id]);

  const cardPos =
    card && !card.centered && card.anchor
      ? cardPosition(card.anchor, card.placement)
      : null;

  return (
    <div data-creezio-demo-ui="1">
      {veil ? <div className="creezio-demo-veil" /> : null}
      {spotlight ? (
        <div
          className="creezio-demo-spotlight"
          style={{
            left: spotlight.left - 6,
            top: spotlight.top - 6,
            width: spotlight.width + 12,
            height: spotlight.height + 12,
          }}
        />
      ) : null}

      {card ? (
        <div
          className={
            card.centered
              ? "creezio-demo-card creezio-demo-card--centered"
              : "creezio-demo-card"
          }
          style={cardPos ? { left: cardPos.left, top: cardPos.top } : undefined}
          role="dialog"
          aria-live="polite"
        >
          <p className="creezio-demo-card-kicker">{card.kicker}</p>
          {card.title ? (
            <h3 className="creezio-demo-card-title">{card.title}</h3>
          ) : null}
          {card.body ? (
            <p className="creezio-demo-card-body">{card.body}</p>
          ) : null}
          {card.showNext ? (
            <div className="creezio-demo-card-actions">
              <button
                type="button"
                className="creezio-demo-btn creezio-demo-btn--ghost"
                onClick={exit}
              >
                Quitter
              </button>
              <button
                type="button"
                className="creezio-demo-btn creezio-demo-btn--primary"
                onClick={advance}
              >
                {card.nextLabel ?? "Suivant"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {note ? <div className="creezio-demo-note">{note}</div> : null}

      <div className="creezio-demo-controls">
        <span className="creezio-demo-controls-label">{scenario.title}</span>
        <span className="creezio-demo-progress">
          <span
            className="creezio-demo-progress-fill"
            style={{ width: `${Math.round(((stepIndex + 1) / total) * 100)}%` }}
          />
        </span>
        <span className="creezio-demo-controls-count">
          {stepIndex + 1}/{total}
        </span>
        <button
          type="button"
          className="creezio-demo-btn creezio-demo-btn--ghost"
          onClick={exit}
        >
          Quitter la visite
        </button>
      </div>
    </div>
  );
}
