"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { cn, resolveDesktopHomePath } from "@creezio/shell-ui";
import { INTERSTITIAL_MS, Interstitial } from "./interstitial";
import { Stepper } from "./onboarding-shell";
import type {
  OnboardingStepContext,
  OnboardingWizardProps,
} from "./types";

export function OnboardingWizard({
  steps,
  transport,
  initialStep,
  editMode,
  flags,
  theme,
  resolveExitHref,
  onExit,
  className,
}: OnboardingWizardProps) {
  const stepCount = steps.length;
  const lastStep = Math.max(stepCount - 1, 0);
  const interstitialsEnabled = flags?.interstitials !== false;
  const allowSkip = flags?.allowSkip !== false;
  const interstitialMs = flags?.interstitialMs ?? INTERSTITIAL_MS;

  const accentColor = theme?.accentColor ?? "#f0701d";
  const inkColor = theme?.inkColor ?? "#14182f";
  const tealColor = theme?.tealColor ?? "#0e7b7b";
  const creamBackground = theme?.creamBackground ?? "#faf7f1";

  const [step, setStep] = useState<number>(() => {
    if (initialStep != null) {
      return Math.min(Math.max(initialStep, 0), lastStep);
    }
    if (editMode) return lastStep;
    return 0;
  });
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<"start" | "end">("start");
  const [interstitial, setInterstitial] = useState<number | null>(null);

  const stepLabels = useMemo(() => steps.map((s) => s.label), [steps]);

  const exitTo = useCallback(
    async () => {
      const href = resolveExitHref
        ? await resolveExitHref()
        : await resolveDesktopHomePath();
      if (onExit) onExit(href);
      else window.location.assign(href);
    },
    [onExit, resolveExitHref],
  );

  const persistStep = useCallback(
    (next: number) => {
      void Promise.resolve(transport.persistStep(next)).catch(() => {});
    },
    [transport],
  );

  const showInterstitialFor = useCallback(
    (next: number) => {
      const def = steps[next];
      if (
        interstitialsEnabled &&
        next > 0 &&
        next <= lastStep &&
        def?.interstitialTitle
      ) {
        setInterstitial(next);
        window.setTimeout(() => setInterstitial(null), interstitialMs);
      }
    },
    [interstitialsEnabled, interstitialMs, lastStep, steps],
  );

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), lastStep);
      persistStep(clamped);
      setEntry("start");
      setStep(clamped);
      showInterstitialFor(clamped);
      window.scrollTo({ top: 0 });
    },
    [lastStep, persistStep, showInterstitialFor],
  );

  const advance = useCallback(() => {
    goTo(Math.min(step + 1, lastStep));
  }, [goTo, lastStep, step]);

  const back = useCallback(() => {
    const prevStep = Math.max(step - 1, 0);
    persistStep(prevStep);
    setEntry("end");
    setStep(prevStep);
    window.scrollTo({ top: 0 });
  }, [persistStep, step]);

  const skip = useCallback(async () => {
    if (!allowSkip) return;
    setSkipping(true);
    try {
      await transport.skip();
      await exitTo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setSkipping(false);
    }
  }, [allowSkip, exitTo, transport]);

  const complete = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await transport.complete();
      await exitTo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setSaving(false);
    }
  }, [exitTo, transport]);

  const ctx: OnboardingStepContext = {
    stepIndex: step,
    entry,
    saving,
    skipping,
    advance,
    goTo,
    back,
    skip,
    complete,
    setSaving,
    setError,
  };

  const current = steps[step];
  const interstitialDef =
    interstitial != null ? steps[interstitial] : undefined;

  return (
    <div
      className={cn("onb-stage flex h-dvh flex-col overflow-hidden", className)}
      style={
        {
          ["--onb-accent-color" as string]: accentColor,
          ["--onb-ink-color" as string]: inkColor,
          ["--onb-teal-color" as string]: tealColor,
          ["--onb-cream-bg" as string]: creamBackground,
        } as CSSProperties
      }
    >
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden">
        <Stepper
          steps={stepLabels}
          current={step}
          accentColor={accentColor}
          tealColor={tealColor}
          inkColor={inkColor}
        />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {error ? (
            <p className="absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-1.5 text-sm text-rose-700 shadow-sm">
              {error}
            </p>
          ) : null}

          {interstitial != null && interstitialDef?.interstitialTitle ? (
            <Interstitial
              title={interstitialDef.interstitialTitle}
              tagline={interstitialDef.interstitialTagline}
              stepIndex={interstitial}
              totalSteps={stepCount}
              accentColor={accentColor}
              inkColor={inkColor}
              tealColor={tealColor}
            />
          ) : current ? (
            current.render(ctx)
          ) : null}
        </main>
      </div>
    </div>
  );
}
