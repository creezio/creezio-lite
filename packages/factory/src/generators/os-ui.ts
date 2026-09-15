/**
 * Catalogue OS Next — source de vérité = `@creezio/os-ui/routes`.
 * La factory ne versionne PLUS ces pages dans ui/app/ d'une marque :
 * elles sont matérialisées localement sous `ui/app/(creezio-os)/` (gitignoré).
 */
import type { AppManifest } from "@creezio/brand-config";
import { creezioNpmDeps, UI_CREEZIO_DEPS } from "../kit-release.js";
import type { ProductModel } from "../product-model.js";

export type OsUiPageSpec = {
  /** Chemin relatif sous routes/ (ex. "mails/page.tsx") */
  rel: string;
  source: string;
};

/** Segments OS interdits dans ui/app/ versionné d'une marque. */
export const FORBIDDEN_BRAND_OS_UI_SEGMENTS = [
  "admin",
  "cockpit",
  "collaborateurs",
  "configuration",
  "developers",
  "granola",
  "grokbot",
  "login",
  "mails",
  "mcp",
  "onboarding",
  "parametres",
  "server-cockpit",
  "settings",
  "setup",
  "taches",
] as const;

function pageClient(importLine: string, jsx: string): string {
  return `"use client";

${importLine}

export default function Page() {
  return (
${jsx}
  );
}
`;
}

/**
 * Catalogue des surfaces OS (référence / sync package os-ui).
 * Ne plus écrire ces chemins dans le git de la marque.
 */
export function listOsUiPages(_manifest: AppManifest): OsUiPageSpec[] {
  return [
    {
      rel: "mails/page.tsx",
      source: pageClient(
        `import { MailWorkspace } from "@creezio/mails/ui";`,
        `    <MailWorkspace />`,
      ),
    },
    {
      rel: "parametres/email/page.tsx",
      source: pageClient(
        `import { MailSettings } from "@creezio/mails/ui";`,
        `    <MailSettings />`,
      ),
    },
    {
      rel: "taches/page.tsx",
      source: pageClient(
        `import { TasksKanbanClient } from "@creezio/tasks/ui";`,
        `    <TasksKanbanClient />`,
      ),
    },
    {
      rel: "login/page.tsx",
      source: pageClient(
        `import { Suspense } from "react";
import { LoginPage } from "@creezio/auth/ui";`,
        `    <Suspense fallback={<p>Chargement…</p>}>
      <LoginPage defaultRedirect="/dashboard" />
    </Suspense>`,
      ),
    },
    {
      rel: "setup/page.tsx",
      source: pageClient(
        `import { SetupWizard } from "@creezio/onboarding/ui";`,
        `    <SetupWizard />`,
      ),
    },
    {
      rel: "onboarding/page.tsx",
      source: `import { redirect } from "next/navigation";

/**
 * Fallback OS /onboarding — sans page métier marque, jamais d'écran mort.
 * Marque avec parcours : ui/app/onboarding/ (prime sur ce wrapper).
 */
export default function Page() {
  redirect("/");
}
`,
    },
    {
      rel: "settings/page.tsx",
      source: pageClient(
        `import { DesktopSettingsPage } from "@creezio/shell-ui/ui/os-pages";`,
        `    <DesktopSettingsPage />`,
      ),
    },
    {
      rel: "configuration/page.tsx",
      source: pageClient(
        `import { DesktopSettingsPage } from "@creezio/shell-ui/ui/os-pages";`,
        `    <DesktopSettingsPage />`,
      ),
    },
    {
      rel: "parametres/page.tsx",
      source: pageClient(
        `import { DesktopSettingsPage } from "@creezio/shell-ui/ui/os-pages";`,
        `    <DesktopSettingsPage />`,
      ),
    },
    {
      rel: "developers/page.tsx",
      source: pageClient(
        `import { McpAdminClient } from "@creezio/mcp-facade/ui";
import { RequestLogsClient } from "@creezio/observability/ui";`,
        `    <McpAdminClient logsSlot={<RequestLogsClient />} />`,
      ),
    },
    {
      rel: "mcp/page.tsx",
      source: pageClient(
        `import { McpAdminClient } from "@creezio/mcp-facade/ui";
import { RequestLogsClient } from "@creezio/observability/ui";`,
        `    <McpAdminClient logsSlot={<RequestLogsClient />} />`,
      ),
    },
    {
      rel: "admin/mcp/page.tsx",
      source: pageClient(
        `import { McpAdminClient } from "@creezio/mcp-facade/ui";
import { RequestLogsClient } from "@creezio/observability/ui";`,
        `    <McpAdminClient logsSlot={<RequestLogsClient />} />`,
      ),
    },
    {
      rel: "admin/api/page.tsx",
      source: pageClient(
        `import { ApiEndpointsClient } from "@creezio/observability/ui";`,
        `    <ApiEndpointsClient />`,
      ),
    },
    {
      rel: "admin/plugins/page.tsx",
      source: pageClient(
        `import { AdminPluginsList } from "@creezio/product-hub/ui";`,
        `    <AdminPluginsList />`,
      ),
    },
    {
      rel: "admin/access/page.tsx",
      source: pageClient(
        `import { AccessAdminClient } from "@creezio/access-control/ui";`,
        `    <AccessAdminClient />`,
      ),
    },
    {
      rel: "admin/database/page.tsx",
      source: pageClient(
        `import { DatabaseClient } from "@creezio/database/ui";`,
        `    <DatabaseClient />`,
      ),
    },
    {
      rel: "admin/analytics/page.tsx",
      source: pageClient(
        `import { AnalyticsClient } from "@creezio/observability/ui";`,
        `    <AnalyticsClient />`,
      ),
    },
    {
      rel: "admin/request-logs/page.tsx",
      source: pageClient(
        `import { RequestLogsClient } from "@creezio/observability/ui";`,
        `    <RequestLogsClient />`,
      ),
    },
    {
      rel: "cockpit/page.tsx",
      source: pageClient(
        `import { CockpitClient } from "@creezio/cockpit/ui";`,
        `    <CockpitClient />`,
      ),
    },
    {
      rel: "server-cockpit/page.tsx",
      source: pageClient(
        `import { ServerCockpitShell } from "@creezio/cockpit/ui";`,
        `    <ServerCockpitShell />`,
      ),
    },
    {
      rel: "collaborateurs/page.tsx",
      source: pageClient(
        `import { AccountSettings } from "@creezio/shell-ui/ui/settings/account-settings";`,
        `    <>
      <h1>Collaborateurs</h1>
      <p style={{ opacity: 0.75 }}>Compte local / session — OS Creezio.</p>
      <AccountSettings />
    </>`,
      ),
    },
  ];
}

export function renderUiPackageJson(_manifest: AppManifest): string {
  // Deps @creezio/* de l'UI : SoT unique UI_CREEZIO_DEPS (kit-release.ts) —
  // la même liste que consomme `creezio upgrade` pour synchroniser les
  // marques existantes. JAMAIS de liste inline parallèle (incident prod
  // 0.20.0 : /granola + /grokbot matérialisés sans les deps).
  return (
    JSON.stringify(
      {
        name: "@creezio/brand-ui",
        private: true,
        version: "0.1.0",
        scripts: {
          "predev": "npm run os-ui:materialize --prefix ..",
          "prebuild": "npm run os-ui:materialize --prefix ..",
          dev: "next dev -p 18790",
          build: "next build",
          start: "node .next/standalone/server.js",
        },
        dependencies: {
          // Clôture @creezio UI (pages os-ui + composants kit + peers kit
          // déclarés pour une résolution déterministe hors workspace).
          ...creezioNpmDeps(UI_CREEZIO_DEPS),
          "@radix-ui/react-avatar": "^1.1.10",
          "@radix-ui/react-dialog": "^1.1.14",
          "@radix-ui/react-dropdown-menu": "^2.1.15",
          "@radix-ui/react-label": "^2.1.7",
          "@radix-ui/react-scroll-area": "^1.2.9",
          "@radix-ui/react-select": "^2.2.5",
          "@radix-ui/react-separator": "^1.1.7",
          "@radix-ui/react-slot": "^1.2.3",
          "@radix-ui/react-tabs": "^1.1.12",
          "@radix-ui/react-tooltip": "^1.2.7",
          "@tanstack/react-table": "^8.21.3",
          // Webmail natif (@creezio/mails/ui) : panneaux + éditeur riche.
          "react-resizable-panels": "^3.0.3",
          "@tiptap/react": "^2.14.0",
          "@tiptap/starter-kit": "^2.14.0",
          "@tiptap/extension-link": "^2.14.0",
          next: "15.3.3",
          react: "19.1.0",
          "react-dom": "19.1.0",
          // Middleware auth pages (parité TF3) — jwtVerify cookie session.
          jose: "^6.2.3",
          "lucide-react": "^0.511.0",
          sonner: "^2.0.3",
          "date-fns": "^4.1.0",
          cmdk: "^1.1.1",
          recharts: "^2.15.3",
          "class-variance-authority": "^0.7.1",
          clsx: "^2.1.1",
          "tailwind-merge": "^3.3.0",
        },
        devDependencies: {
          "@types/node": "^22.15.3",
          "@types/react": "^19.1.2",
          "@types/react-dom": "^19.1.2",
          // Chrome kit (@creezio/shell-ui/ui) = classes Tailwind : sans le
          // build Tailwind, l'app rend du HTML brut non stylé.
          autoprefixer: "^10.4.21",
          postcss: "^8.5.3",
          tailwindcss: "^3.4.17",
          typescript: "^5.8.3",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

/**
 * Middleware auth pages — parité kit3 pour les marques factory.
 * Cookie = `${brandId}_session` (aligné mountBrandPlatformSurface).
 * Les routes /api/v1 restent gérées par le kernel Hono (rewrites).
 */
export function renderUiAuthMiddleware(brandId: string): string {
  const cookie = `${brandId.replace(/[^a-z0-9_]/gi, "_")}_session`;
  return `import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const AUTH_COOKIE = ${JSON.stringify(cookie)};
const PUBLIC = [
  "/login",
  "/setup",
  "/onboarding",
  "/health",
  "/developers",
  "/oauth",
  "/.well-known",
  "/lp",
  "/lp-media",
  "/sw.js",
  "/manifest.webmanifest",
  "/icons",
];

function authDisabled() {
  const v = (process.env.AUTH_DISABLED || "0").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function getSecret() {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) {
    // Plane UI : AUTH_SECRET injecté par le harness (composeBrandOs).
    // Absent → fail-closed (redirige login) plutôt que fallback public.
    return null;
  }
  return new TextEncoder().encode(secret);
}

function firstHeader(value: string | null): string {
  if (!value) return "";
  return value.split(",")[0]?.trim() || "";
}

function isLoopbackHost(host: string): boolean {
  const bare = (host || "").toLowerCase().trim().split(":")[0] || "";
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

/** Origine publique derrière Cloudflare Tunnel (Host réécrit en loopback). */
function publicOrigin(request: NextRequest): string {
  const xfHost = firstHeader(request.headers.get("x-forwarded-host"));
  const host = firstHeader(request.headers.get("host"));
  const xfProto = firstHeader(request.headers.get("x-forwarded-proto")).toLowerCase();
  const appPublic = (process.env.APP_PUBLIC_URL || "").trim().replace(/\\/+$/, "");
  const cf = Boolean(
    request.headers.get("cf-connecting-ip") ||
      request.headers.get("cf-ray") ||
      /https/i.test(request.headers.get("cf-visitor") || ""),
  );
  if (xfHost && !isLoopbackHost(xfHost)) {
    const proto = xfProto === "http" ? "http" : "https";
    return \`\${proto}://\${xfHost}\`;
  }
  if (host && !isLoopbackHost(host)) {
    const proto =
      xfProto === "http" || xfProto === "https"
        ? xfProto
        : cf || host.includes(".")
          ? "https"
          : "http";
    return \`\${proto}://\${host}\`;
  }
  if (appPublic && (xfProto === "https" || cf)) {
    try {
      return new URL(appPublic).origin;
    } catch {
      /* ignore */
    }
  }
  return request.nextUrl.origin;
}

function loginRedirect(request: NextRequest, nextPath?: string) {
  const url = new URL("/login", publicOrigin(request));
  if (nextPath && nextPath !== "/login") {
    url.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const host = (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    ""
  ).toLowerCase();
  const { pathname } = request.nextUrl;

  // Landing publique lp.{zone} — rewrite avant la garde session
  // (sinon /flotte admin se sert sans cookie : 200 HTML + APIs 401).
  if (host.startsWith("lp.") && pathname !== "/lp") {
    const url = request.nextUrl.clone();
    url.pathname = "/lp";
    url.protocol = "http:";
    return NextResponse.rewrite(url);
  }

  if (
    PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  if (authDisabled()) return NextResponse.next();

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return loginRedirect(request, pathname);

  const secret = getSecret();
  if (!secret) return loginRedirect(request, pathname);

  try {
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return loginRedirect(request);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
`;
}

export function renderUiNextConfig(): string {
  return `import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Cible kernel pour rewrite same-origin (UI plane navigateur / MCP). */
const metierProxyTarget = (
  process.env.METIER_BASE_URL ||
  process.env.NEXT_PUBLIC_METIER_BASE_URL ||
  "http://127.0.0.1:18791"
).replace(/\\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Packages npm @creezio/* : typés côté kit. Ici, peers résolus via webpack.
  typescript: { ignoreBuildErrors: true },
  transpilePackages: [
    "@creezio/os-ui",
    "@creezio/shell-ui",
    "@creezio/assistant",
    "@creezio/mails",
    "@creezio/tasks",
    "@creezio/auth",
    "@creezio/onboarding",
    "@creezio/mcp-facade",
    "@creezio/product-hub",
    "@creezio/cockpit",
    "@creezio/database",
    "@creezio/observability",
    "@creezio/interactive-demo",
    "@creezio/access-control",
    "@creezio/nav",
    "@creezio/granola",
    "@creezio/grokbot",
  ],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: \`\${metierProxyTarget}/api/v1/:path*\`,
      },
    ];
  },
  webpack: (config) => {
    // Imports @creezio/* (node_modules) résolvent les peers de ui/node_modules.
    config.resolve.modules = [
      path.join(__dirname, "node_modules"),
      ...(config.resolve.modules || ["node_modules"]),
    ];
    return config;
  },
};

export default nextConfig;
`;
}

/** tsconfig UI — paths pour typer les packages npm @creezio contre peers ui/. */
export function renderUiTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "next": ["./node_modules/next"],
      "next/*": ["./node_modules/next/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;
}

/**
 * Layout marque : chrome CRM kit (sidebar/onglets/recherche) + nav métier.
 * Les surfaces OS vivent dans @creezio/os-ui (matérialisées hors git).
 * Boot identity via props marque — pas de dossier OS versionné.
 */
export function renderNextLayoutWithOsNav(model: ProductModel): string {
  const bridge = `${model.brandId}Desktop`;
  const host = model.domain || `${model.brandId}.local`;

  return `import type { ReactNode } from "react";
import { CreezioUiBoot } from "@creezio/os-ui/boot";
import { BrandChrome } from "@/components/brand-chrome";
import "@creezio/shell-ui/theme.css";
import "@creezio/interactive-demo/ui/interactive-demo.css";
import "./globals.css";

export const metadata = {
  title: ${JSON.stringify(model.brandName)},
  description: ${JSON.stringify(model.tagline)},
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased">
        <CreezioUiBoot
          desktopApiGlobal={${JSON.stringify(bridge)}}
          productName={${JSON.stringify(model.brandName)}}
          publicHostSuffix={${JSON.stringify(host)}}
        >
          <BrandChrome>{children}</BrandChrome>
        </CreezioUiBoot>
      </body>
    </html>
  );
}
`;
}

/**
 * Wiring chrome kit côté marque : loader catalogue + adminItems kit.
 * Fichier marque (personnalisable), généré une fois.
 *
 * Sidebar = `<NavCatalogLoader />` (GET /api/v1/modules/nav) — **interdit**
 * de recopier un `OS_NAV` / d'écrire les hrefs granola ou grokbot en dur.
 * Fallback premier paint : `defaultOsPrimaryNavItems()`. Admin :
 * `defaultOsAdminNavItems` (consommé, pas recopié). Métier =
 * `collectNavItems` via le mount auto-register app-runtime, pas une
 * liste inline.
 * SoT : `docs/plans/PLAN-NAV-CATALOG.md`. Feature-off plugins : passer
 * `{ includePlugins: false }` à `defaultOsAdminNavItems`.
 */
export function renderUiBrandChrome(model: ProductModel): string {
  const storageKey = `${model.brandId}-global-search`;
  const home = defaultWorkspaceHome(model);
  const includePlugins = model.platformNeeds.pluginApi !== false;

  return `"use client";
/**
 * creezio:owned-by-brand — wiring du chrome CRM kit (sidebar, onglets,
 * recherche). Le chrome lui-même vient de @creezio/shell-ui/ui : sidebar
 * = <NavCatalogLoader /> (GET /api/v1/modules/nav) + defaultOsAdminNavItems.
 * Interdit de recopier OS_NAV. SoT : docs/plans/PLAN-NAV-CATALOG.md.
 * Hermes / n8n = Admin → Outils.
 */

import type { ReactNode } from "react";
import { RequireSession, SessionProvider, useSession } from "@creezio/auth/ui";
import { InteractiveDemoRoot } from "@creezio/interactive-demo/ui";
import { AssistantRoot } from "@creezio/assistant/ui";
import { SessionUsageAnalyticsProvider } from "@creezio/observability/ui";
import {
  configureDefaultNewTabHref,
  configureGlobalSearch,
  configureSidebar,
  defaultOsAdminNavItems,
  defaultOsPrimaryNavItems,
  getSidebarHost,
  NavCatalogLoader,
  WorkspaceRoot,
} from "@creezio/shell-ui/ui";

configureSidebar({
  getNavItems: () => defaultOsPrimaryNavItems(),
  getAdminItems: () => defaultOsAdminNavItems({ includePlugins: ${includePlugins} }),
});

configureGlobalSearch({
  placeholder: "Rechercher une page…",
  storageKey: ${JSON.stringify(storageKey)},
  search: async (query) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return getSidebarHost().getNavItems().filter((n) => n.label.toLowerCase().includes(q)).map((n) => ({
      index: "pages",
      id: n.href,
      title: n.label,
      href: n.href,
    }));
  },
});

configureDefaultNewTabHref(${JSON.stringify(home)});

function DemoInSession() {
  const { me } = useSession();
  return (
    <InteractiveDemoRoot
      launcher="sidebar"
      userKey={me?.user}
      role={me?.brandRole}
    />
  );
}

export function BrandChrome({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {/* Contrat @creezio/auth/ui — pas un wrapper local. Sans ça, /flotte
          (admin) et le CRM marque rendent un workspace creux (APIs 401). */}
      <RequireSession>
        <NavCatalogLoader includePlugins={${includePlugins}} />
        {/* Tracker client → POST /api/v1/analytics/events (Admin → Analytics). */}
        <SessionUsageAnalyticsProvider>
          <AssistantRoot>
            <WorkspaceRoot>{children}</WorkspaceRoot>
          </AssistantRoot>
        </SessionUsageAnalyticsProvider>
      </RequireSession>
      {/* Un seul lecteur démo, dans SessionProvider (pas de brandDemoScenarios). */}
      <DemoInSession />
    </SessionProvider>
  );
}
`;
}

/**
 * CONVENTION OS — home workspace : le chrome kit canonise "/" → /dashboard
 * (normalizeHref / targetHref, DASHBOARD_PATH) et l'onglet de base vit sur
 * /dashboard. Jamais de fallback vers une autre page (ensureDashboardPage
 * garantit que /dashboard existe dans toute app générée).
 */
export function defaultWorkspaceHome(_model: ProductModel): string {
  return "/dashboard";
}

/**
 * Tailwind : preset kit (thème Creezio canonique, extrait du gold TF) +
 * scan app + composants + sources UI des packages npm @creezio/*.
 */
export function renderUiTailwindConfig(): string {
  return `import type { Config } from "tailwindcss";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Le design system vient du kit (preset + theme.css @creezio/shell-ui) :
// une app générée ne DOIT PAS repartir d'un thème vide / HTML brut.
// Le scan inclut les sources UI des packages npm @creezio/* — LOCALES
// (./node_modules) EXCLUSIVEMENT : server/ui est un projet npm indépendant
// (lockfile propre, npm ci --prefix server/ui), les deps n'y sont jamais
// hoistées. NE JAMAIS ajouter de glob ../../node_modules/@creezio/* : le
// symlink workspace racine @creezio/app-<brand> → server/ y matcherait, et
// Tailwind scannerait server/ui/node_modules + .next (~900 Mo → compile
// Next 30 s → 17 min+, vécu tempoflow3-admin 2026-08-12), sinon purge.
const config: Config = {
  presets: [require("@creezio/shell-ui/tailwind-preset")],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@creezio/*/ui/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@creezio/*/routes/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
`;
}

/** PostCSS CJS — le loader Next le lit tel quel (pas d'ESM ici). */
export function renderUiPostcssConfig(): string {
  return `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
}

/**
 * Globals marque : directives Tailwind + overrides éventuels.
 * Le thème lui-même (tokens crème/encre, chrome onglets, sidebar sombre,
 * animations) vient du kit : `@creezio/shell-ui/theme.css`, importé par le
 * layout racine AVANT ce fichier.
 */
export function renderUiGlobalsCss(): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * Le design system par défaut est le thème Creezio (@creezio/shell-ui/theme.css,
 * importé dans app/layout.tsx). Ce fichier ne contient que les directives
 * Tailwind + les overrides propres à la marque.
 */
`;
}

/** Script marque : matérialise ui/app/(creezio-os) depuis le package npm. */
export function renderMaterializeOsUiScript(): string {
  return `#!/usr/bin/env node
/**
 * Matérialise les pages OS kit sous ui/app/(creezio-os)/ (gitignoré).
 * Ne pas versionner de dossier OS dans ui/app/.
 *
 * Source = package npm @creezio/os-ui (scripts/materialize.mjs), résolu par
 * walk-up node_modules (workspaces racine : hoisting au node_modules racine).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolvePkgScript(pkg, rel) {
  let dir = root;
  for (;;) {
    const cand = path.join(dir, "node_modules", pkg, rel);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    \`\${pkg}/\${rel} introuvable — lancer npm install à la racine (workspaces)\`,
  );
}

const script = resolvePkgScript("@creezio/os-ui", "scripts/materialize.mjs");
const r = spawnSync(process.execPath, [script, "--app-root", root], {
  stdio: "inherit",
  env: { ...process.env, CREEZIO_BRAND_ROOT: root },
});
process.exit(r.status ?? 1);
`;
}
