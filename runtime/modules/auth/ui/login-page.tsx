"use client";

/**
 * LoginPage — page de connexion split-screen 50/50 (module natif kit).
 *
 * Panneau formulaire (champs, erreurs, loading, a11y) + panneau brand
 * (logo, nom produit, tagline, highlights). 100 % configurable marque via
 * configureShellUiBrand({ productName, login: {…} }) — LiteUiBoot.
 * Sans config login : défaut neutre élégant (gradient encre du thème kit,
 * tuile initiale, aucun texte marketing).
 *
 * Responsive : mobile = bande brand compacte au-dessus du formulaire ;
 * desktop = split vertical, côté configurable (login.panelSide).
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useShellUiBrand } from "@lite/shell-ui/ui/kit";
import { LoginForm, type LoginFormProps } from "./login-form";

export type LoginPageProps = LoginFormProps & {
  /** Alternate identity provider form; the canonical Lite layout is retained. */
  form?: ReactNode;
  /** Slot sous le formulaire (liens marque, mentions légales…). */
  footer?: ReactNode;
};

/** Fond panneau par défaut — encre neutre du thème kit (aucune marque). */
const DEFAULT_PANEL_BACKGROUND =
  "linear-gradient(165deg, #14182f 0%, #1b2040 55%, #0d101f 100%)";

function LogoTile({
  logoUrl,
  productName,
  size = "md",
}: {
  logoUrl?: string;
  productName: string;
  size?: "sm" | "md";
}) {
  const dims =
    size === "sm" ? "h-8 w-8 rounded-md text-xs" : "h-10 w-10 rounded-xl text-sm";
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={`${dims} shrink-0 object-cover ring-1 ring-white/25`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`flex ${dims} shrink-0 select-none items-center justify-center bg-white/10 font-semibold text-white ring-1 ring-white/20`}
    >
      {productName.trim().charAt(0).toUpperCase() || "·"}
    </div>
  );
}

export function LoginPage({ footer, form, ...formProps }: LoginPageProps = {}) {
  const brand = useShellUiBrand();
  const login = brand.login ?? {};
  const productName = brand.productName;
  const side = login.panelSide ?? "right";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const panelStyle: CSSProperties = {
    background: login.panelBackground ?? DEFAULT_PANEL_BACKGROUND,
  };

  const entrance = `transition-all duration-700 ease-out ${
    mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
  }`;

  const brandPanel = (
    <aside
      data-lite-login="brand-panel"
      className={`relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16 ${
        side === "left" ? "lg:order-1" : ""
      }`}
      style={panelStyle}
    >
      {login.panelImageUrl ? (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${JSON.stringify(login.panelImageUrl)})` }}
          />
          <div aria-hidden className="absolute inset-0 bg-slate-950/55" />
        </>
      ) : null}
      {/* Halo décoratif — accent du thème kit, voilé */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-28 -top-28 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-sky-700/10 blur-3xl"
      />
      <div className={`relative flex items-center gap-3 ${entrance}`}>
        <LogoTile logoUrl={login.logoUrl} productName={productName} />
        <span className="text-lg font-semibold tracking-tight text-white">
          {productName}
        </span>
      </div>
      <div
        className={`relative space-y-8 transition-all delay-150 duration-700 ease-out ${
          mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        {login.tagline ? (
          <p className="max-w-md text-3xl font-semibold leading-snug tracking-tight text-white xl:text-4xl">
            {login.tagline}
          </p>
        ) : null}
        {login.highlights && login.highlights.length > 0 ? (
          <ul className="space-y-3.5">
            {login.highlights.map((point) => (
              <li
                key={point}
                className="flex items-start gap-3 text-[15px] leading-relaxed text-white/75"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
                  <Check className="h-3 w-3 text-sky-300" aria-hidden />
                </span>
                {point}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {/* Espace bas — équilibre vertical du panneau */}
      <div aria-hidden className="relative" />
    </aside>
  );

  return (
    <div
      data-lite-login="split"
      className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-2"
    >
      {/* Bande brand compacte — mobile uniquement */}
      <div
        data-lite-login="brand-band"
        className="flex items-center gap-3 px-5 py-4 lg:hidden"
        style={panelStyle}
      >
        <LogoTile logoUrl={login.logoUrl} productName={productName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            {productName}
          </p>
          {login.tagline ? (
            <p className="truncate text-xs text-white/65">{login.tagline}</p>
          ) : null}
        </div>
      </div>

      {side === "left" ? brandPanel : null}

      {/* Panneau formulaire */}
      <div
        className={`flex flex-col px-5 pb-10 pt-8 sm:px-10 lg:px-14 lg:py-12 xl:px-20 ${
          side === "left" ? "lg:order-2" : ""
        }`}
      >
        <div className="hidden lg:block">
          <LogoTile logoUrl={login.logoUrl} productName={productName} size="sm" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className={`w-full max-w-sm ${entrance}`}>
            <div className="mb-8 space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                Connexion
              </h1>
              <p className="text-[15px] leading-relaxed text-slate-500">
                Accédez à votre espace {productName}.
              </p>
            </div>
            {form ?? <LoginForm {...formProps} />}
            {login.secondaryLink?.label && login.secondaryLink?.href ? (
              <p
                data-lite-login="secondary-link"
                className="mt-6 text-center text-sm text-slate-500"
              >
                <a
                  href={login.secondaryLink.href}
                  className="font-medium text-sky-600 underline-offset-4 transition-colors hover:text-sky-700 hover:underline"
                >
                  {login.secondaryLink.label}
                </a>
              </p>
            ) : null}
            {footer ? <div className="mt-8">{footer}</div> : null}
          </div>
        </div>
      </div>

      {side === "right" ? brandPanel : null}
    </div>
  );
}
