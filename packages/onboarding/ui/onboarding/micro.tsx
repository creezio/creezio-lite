"use client";

/**
 * Moteur de micro-étapes façon Typeform : une seule question par écran,
 * auto-avance au clic pour les choix simples, OK / Entrée pour les saisies.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, Check, CornerDownLeft } from "lucide-react";
import { cn } from "@creezio/shell-ui";
import { getOnboardingUiConfig } from "./configure";
import type { CompanionPose } from "./types";

export const AUTO_ADVANCE_MS = 320;

export function useMicro(
  count: number,
  {
    onDone,
    onExit,
    startAtEnd,
  }: { onDone: () => void; onExit?: () => void; startAtEnd?: boolean },
) {
  const [idx, setIdx] = useState(startAtEnd ? Math.max(count - 1, 0) : 0);
  const [dir, setDir] = useState<"fwd" | "back">(startAtEnd ? "back" : "fwd");

  const next = useCallback(() => {
    setIdx((i) => {
      if (i >= count - 1) {
        onDone();
        return i;
      }
      setDir("fwd");
      return i + 1;
    });
  }, [count, onDone]);

  const prev = useCallback(() => {
    setIdx((i) => {
      if (i === 0) {
        onExit?.();
        return i;
      }
      setDir("back");
      return i - 1;
    });
  }, [onExit]);

  return { idx, dir, next, prev };
}

export function MicroScreen({
  idx,
  total,
  dir,
  question,
  helper,
  hint,
  pose = "pointing",
  companionSrc,
  children,
  onBack,
  onOK,
  okLabel = "OK",
  okDisabled,
  okLoading,
  skipLabel,
  onSkip,
  wide,
  accentColor = "#f0701d",
  inkColor = "#14182f",
  tealColor = "#0e7b7b",
}: {
  idx: number;
  total: number;
  dir: "fwd" | "back";
  question: string;
  helper?: string;
  hint: string;
  pose?: CompanionPose;
  /** Override image companion (sinon configureOnboardingUi). */
  companionSrc?: string;
  children: ReactNode;
  onBack: () => void;
  onOK?: () => void;
  okLabel?: string;
  okDisabled?: boolean;
  okLoading?: boolean;
  skipLabel?: string;
  onSkip?: () => void;
  wide?: boolean;
  accentColor?: string;
  inkColor?: string;
  tealColor?: string;
}) {
  useEffect(() => {
    if (!onOK) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || okDisabled || okLoading) return;
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === "TEXTAREA") return;
      e.preventDefault();
      onOK();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onOK, okDisabled, okLoading]);

  const resolvedCompanion =
    companionSrc ?? getOnboardingUiConfig().companionSrc?.(pose);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="onb-scroll flex min-h-0 flex-1 items-center justify-center px-6 lg:pr-72 2xl:pr-80">
        <div
          key={idx}
          className={cn(
            "w-full py-6",
            wide ? "max-w-5xl" : "max-w-3xl",
            dir === "fwd" ? "onb-anim-fwd" : "onb-anim-back",
          )}
        >
          <p
            className="mb-4 flex items-center gap-2.5 text-base font-semibold"
            style={{ color: accentColor }}
          >
            <span
              className="flex h-7 min-w-7 items-center justify-center rounded-lg px-2 tabular-nums"
              style={{ backgroundColor: `${accentColor}1A` }}
            >
              {idx + 1}
            </span>
            <span style={{ color: `${accentColor}80` }}>/ {total}</span>
          </p>
          <h2
            className="font-serif text-4xl font-bold leading-tight xl:text-5xl xl:leading-[1.12] [@media(max-height:760px)]:text-3xl"
            style={{ color: inkColor }}
          >
            {question}
          </h2>
          {helper ? (
            <p
              className="mt-3 text-base font-medium leading-relaxed xl:text-lg"
              style={{ color: tealColor }}
            >
              {helper}
            </p>
          ) : null}

          <div className="onb-stagger mt-8 [@media(max-height:760px)]:mt-6">{children}</div>

          {onOK ? (
            <div className="mt-8 flex items-center gap-4 [@media(max-height:760px)]:mt-6">
              <button
                type="button"
                disabled={okDisabled || okLoading}
                onClick={onOK}
                className="inline-flex items-center gap-2 rounded-xl px-8 py-3 text-lg font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  backgroundColor: accentColor,
                  boxShadow: `0 4px 14px ${accentColor}40`,
                }}
              >
                {okLoading ? "…" : okLabel}
                <Check className="h-5 w-5" strokeWidth={3} />
              </button>
              <span className="hidden items-center gap-1 text-sm text-slate-400 sm:flex">
                appuyez sur <b className="text-slate-500">Entrée</b>
                <CornerDownLeft className="h-3.5 w-3.5" />
              </span>
              {onSkip ? (
                <button
                  type="button"
                  onClick={onSkip}
                  className="ml-2 text-[15px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
                >
                  {skipLabel ?? "Passer"}
                </button>
              ) : null}
            </div>
          ) : onSkip ? (
            <div className="mt-8 [@media(max-height:760px)]:mt-6">
              <button
                type="button"
                onClick={onSkip}
                className="text-[15px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
              >
                {skipLabel ?? "Passer"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-4 z-10 flex w-56 flex-col items-center lg:right-6 lg:w-60 2xl:w-72 [@media(max-height:600px)]:bottom-2 [@media(max-height:600px)]:w-auto">
        <div className="hidden w-full flex-col items-center lg:flex [@media(max-height:600px)]:hidden">
          <div className="relative w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p
              className="text-sm font-medium leading-snug 2xl:text-[15px]"
              style={{ color: inkColor }}
            >
              {hint}
            </p>
            <span
              aria-hidden
              className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-slate-200 bg-white"
            />
          </div>
          {resolvedCompanion ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolvedCompanion}
              alt=""
              className="mt-2.5 w-48 select-none 2xl:w-56 [@media(max-height:760px)]:w-36"
              draggable={false}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="pointer-events-auto mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/80"
          style={{ ["--tw-text-opacity" as string]: 1 }}
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
          Retour
        </button>
      </div>
    </div>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return Boolean(t.closest("[contenteditable='true']"));
}

export function BigOption({
  index,
  icon,
  label,
  description,
  selected,
  onClick,
  disabled,
  badge,
  accentColor = "#f0701d",
  inkColor = "#14182f",
  tealColor = "#0e7b7b",
}: {
  index: number;
  icon?: ReactNode;
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
  accentColor?: string;
  inkColor?: string;
  tealColor?: string;
}) {
  const letter = String.fromCharCode(65 + index);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (disabled || index < 0 || index > 25) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (e.key.length !== 1 || e.key.toUpperCase() !== letter) return;
      e.preventDefault();
      onClickRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, index, letter]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      aria-keyshortcuts={letter}
      title={`${label} (${letter})`}
      className={cn(
        "group flex w-full items-center gap-4 rounded-2xl border-2 bg-white px-5 py-4 text-left transition [@media(max-height:760px)]:px-4 [@media(max-height:760px)]:py-3",
        selected ? "shadow-md" : "border-slate-200 hover:shadow-sm",
        disabled && "cursor-not-allowed opacity-50",
      )}
      style={
        selected
          ? {
              borderColor: accentColor,
              boxShadow: `0 4px 14px ${accentColor}1A`,
            }
          : undefined
      }
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold transition",
          selected
            ? "text-white"
            : "border-slate-300 bg-slate-50 text-slate-500",
        )}
        style={
          selected
            ? { borderColor: accentColor, backgroundColor: accentColor }
            : undefined
        }
      >
        {selected ? (
          <Check className="h-5 w-5" strokeWidth={3} />
        ) : (
          letter
        )}
      </span>
      {icon ? (
        <span
          className="shrink-0"
          style={{ color: selected ? accentColor : tealColor }}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className="block text-base font-semibold leading-snug xl:text-[17px]"
          style={{ color: inkColor }}
        >
          {label}
          {badge ? (
            <span className="ml-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
              {badge}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-1 block text-sm leading-snug text-slate-500">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function BigInput({
  value,
  onChange,
  placeholder,
  suffix,
  type = "text",
  autoFocus = true,
  inputMode,
  accentColor = "#f0701d",
  inkColor = "#14182f",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  type?: string;
  autoFocus?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
  accentColor?: string;
  inkColor?: string;
}) {
  return (
    <div
      className="flex items-baseline gap-3 border-b-2 pb-3 transition"
      style={{ borderColor: `${inkColor}26` }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = accentColor;
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = `${inkColor}26`;
      }}
    >
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-3xl font-medium outline-none placeholder:text-slate-300 xl:text-4xl"
        style={{ color: inkColor }}
      />
      {suffix ? (
        <span className="shrink-0 text-2xl font-medium text-slate-400">{suffix}</span>
      ) : null}
    </div>
  );
}

export function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </p>
  );
}
