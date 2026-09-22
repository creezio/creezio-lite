"use client";

export const INTERSTITIAL_MS = 2100;

export function Interstitial({
  title,
  tagline,
  stepIndex,
  totalSteps,
  accentColor = "#f0701d",
  inkColor = "#14182f",
  tealColor = "#0e7b7b",
}: {
  title: string;
  tagline?: string;
  stepIndex: number;
  totalSteps: number;
  accentColor?: string;
  inkColor?: string;
  tealColor?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="onb-interstitial max-w-3xl text-center">
        <p
          className="text-sm font-bold uppercase tracking-[0.25em]"
          style={{ color: accentColor }}
        >
          Étape {stepIndex + 1} / {totalSteps}
        </p>
        <h2
          className="mt-4 font-serif text-5xl font-bold leading-tight xl:text-6xl"
          style={{ color: inkColor }}
        >
          {title}
        </h2>
        <div
          className="onb-interstitial-line mx-auto mt-6 h-1 w-28 rounded-full"
          style={{ backgroundColor: tealColor }}
        />
        {tagline ? (
          <p className="mt-5 text-lg font-medium" style={{ color: tealColor }}>
            {tagline}
          </p>
        ) : null}
      </div>
    </div>
  );
}
