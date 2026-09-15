"use client";

/**
 * Stepper onboarding paramétré — labels injectés par la marque.
 */
import { Check } from "lucide-react";
import { cn } from "@creezio/shell-ui";

export type { CompanionPose } from "./types";
/** @deprecated — préférer CompanionPose (réexport compat) */
export type { TempoPose } from "./types";

export function Stepper({
  steps,
  current,
  accentColor = "#f0701d",
  tealColor = "#0e7b7b",
  inkColor = "#14182f",
}: {
  steps: string[];
  current: number;
  accentColor?: string;
  tealColor?: string;
  inkColor?: string;
}) {
  return (
    <nav
      aria-label="Progression"
      className="onb-stepper-fade w-full shrink-0 overflow-hidden"
    >
      <ol className="mx-auto flex w-full max-w-7xl items-start px-4 py-4 sm:px-6 [@media(max-height:760px)]:py-3">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={`${label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div
                  className={cn(
                    "h-[3px] min-w-0 flex-1 rounded-full",
                    i === 0 ? "bg-transparent" : done || active ? "" : "bg-slate-200",
                  )}
                  style={
                    i !== 0 && (done || active)
                      ? { backgroundColor: tealColor }
                      : undefined
                  }
                />
                <span
                  className={cn(
                    "mx-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition sm:mx-1.5 sm:h-10 sm:w-10 sm:text-base",
                    done
                      ? "text-white"
                      : active
                        ? "text-white shadow-md"
                        : "border-slate-300 bg-white text-slate-400",
                  )}
                  style={
                    done
                      ? {
                          borderColor: tealColor,
                          backgroundColor: tealColor,
                        }
                      : active
                        ? {
                            borderColor: accentColor,
                            backgroundColor: accentColor,
                            boxShadow: `0 4px 14px ${accentColor}4D`,
                          }
                        : undefined
                  }
                >
                  {done ? <Check className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={3} /> : i + 1}
                </span>
                <div
                  className={cn(
                    "h-[3px] min-w-0 flex-1 rounded-full",
                    i === steps.length - 1
                      ? "bg-transparent"
                      : done
                        ? ""
                        : "bg-slate-200",
                  )}
                  style={
                    i !== steps.length - 1 && done
                      ? { backgroundColor: tealColor }
                      : undefined
                  }
                />
              </div>
              <span
                className={cn(
                  "mt-2 max-w-full truncate px-0.5 text-center text-[11px] leading-none sm:text-[13px]",
                  active
                    ? "font-bold"
                    : done
                      ? "font-semibold"
                      : "font-medium text-slate-400",
                )}
                style={
                  active
                    ? { color: accentColor }
                    : done
                      ? { color: inkColor }
                      : undefined
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
