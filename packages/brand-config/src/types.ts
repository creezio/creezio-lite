/**
 * Schéma AppManifest — identité d'une marque desktop Creezio.
 *
 * Le modèle standard est **toujours** multi-exe Client + Serveur
 * (deux appId, deux feeds, deux GUID NSIS, deux segments userData).
 * Ce n'est pas une option : brand-config l'exige pour chaque marque.
 */

/** Kind packagé (hors « legacy » tout-en-un réservé au dev / upgrades). */
export type AppKind = "client" | "server";

/** Identité d'un exe (client ou serveur). */
export type ExeIdentity = {
  /** electron-builder `appId` (stable → upgrades in-place). */
  appId: string;
  /** Nom produit affiché (NSIS / menu Démarrer). */
  productName: string;
  /** Nom du binaire Windows (évite les collisions StartsWith INSTDIR). */
  executableName: string;
  /** Motif artifactName (ex. `Acme-Setup-${version}.${ext}`). */
  artifactName: string;
  /** `extraMetadata.name` → segment userData Electron par défaut. */
  packageName: string;
  /** Segment userData explicite (souvent = packageName ou productName). */
  userDataSegment: string;
  /** URL feed auto-update (generic provider), avec slash final. */
  feedUrl: string;
  /**
   * GUID NSIS (mutex + clé Uninstall).
   * Source de vérité : valeurs hardcodées dans build-builder-config.mjs
   * quand présentes ; sinon UUID.v5(appId, OID electron-builder).
   */
  nsisGuid: string;
  /** AppUserModelId Windows (distinct client/serveur). */
  appUserModelId: string;
};

/**
 * Capacités produit optionnelles (Phase N5).
 * Absent ou `true` = activé ; `false` = feature-off (host kit N/A).
 */
export type BrandFeatures = {
  /** Runtime plugins Electron (spawn / scaffold / admin). */
  plugins?: boolean;
  /** Agent flotte / samples diagnostics. */
  fleet?: boolean;
  /**
   * Parcours produit `/onboarding` après `/setup`.
   * Absent/`true` = activé (marques avec étapes métier).
   * `false` = désactivé : post-setup → home (`/`), page `/onboarding` OS redirige.
   */
  onboarding?: boolean;
};

/**
 * Manifeste complet d'une marque.
 * Paramètre tous les chemins / env / bridges sans hardcoder une marque
 * dans platform-core / electron-shell.
 */
export type AppManifest = {
  /** Identifiant court stable (ex. `acme`). */
  brandId: string;
  /** Préfixe variables d'env (ex. `ACME`). */
  envPrefix: string;
  /** Nom contextBridge exposé sur `window` (ex. `acmeDesktop`). */
  bridgeName: string;
  /** Nom fichier SQLite principal sous userData. */
  dbFileName: string;
  /** Nom fichier config locale JSON sous userData. */
  localConfigFileName: string;
  /**
   * Protocole deep-link OS (sans `://`) — ex. `acme`.
   * Utilisé pour `acme://join/<host>` et les argv `--{prefix}-profile=`.
   */
  deepLinkProtocol: string;
  /**
   * Segment partition Chromium app (sans préfixe `persist:`).
   * Ex. `acme-app` → `persist:acme-app`.
   */
  sessionPartition: string;
  /** Préfixe des fichiers log main (ex. `acme-main` → `acme-main.log`). */
  logBasename: string;
  /**
   * Domaine racine pour tunnels Cloudflare
   * (`{slug}.{tunnelRootDomain}`, embeds nested `n8n.{slug}.…` ou flat
   * `n8n-{slug}.…` selon `tunnelHostMode` / `CREEZIO_TUNNEL_FLAT_HOSTS`).
   */
  tunnelRootDomain: string;
  /**
   * Mode hostnames tunnel embeds/agent.
   * - `nested` (défaut) : `n8n.{slug}.{zone}` — ACM / rétrocompat
   * - `flat` : `n8n-{slug}.{zone}` — Universal SSL (1 niveau)
   * Override runtime : `CREEZIO_TUNNEL_FLAT_HOSTS=1` (force flat).
   */
  tunnelHostMode?: "nested" | "flat";
  /** Domaines / hosts publics (docs, feeds, tunnels). */
  domains: {
    /** Domaine produit principal (marketing / CRM). */
    primary: string;
    /** Domaine feed / infra Creezio si distinct. */
    feedHost: string;
  };
  /** Copyright electron-builder. */
  copyright: string;
  /**
   * URL serveur pré-provisionnée dans le picker du client join-only
   * (installateur distribué aux collaborateurs — champ pré-rempli, l'humain
   * confirme). Override runtime : env `${envPrefix}_DEFAULT_SERVER_URL`.
   */
  defaultServerUrl?: string;
  /**
   * Identités Client + Serveur — toujours les deux.
   * `legacy` (tout-en-un) n'est pas un exe packagé du modèle standard.
   */
  client: ExeIdentity;
  server: ExeIdentity;
  /**
   * Infra publish / remote-build (Phase C) — chemins DL, hôte distant, statut.
   * Les tokens secrets restent hors repo (env de l'app marque).
   */
  publish: BrandPublishInfra;
  /**
   * Marque sandbox / démo (Phase D factory) — feeds jetables, hors parc prod.
   * Exclue des asserts feeds live Phase C.
   */
  sandbox?: boolean;
  /**
   * Capacités optionnelles. Une marque peut poser `plugins: false` /
   * `fleet: false` (N5). Demo-app : `onboarding: false` (post-setup → home).
   */
  features?: BrandFeatures;
};

/** `true` si la capacité est activée (défaut = on si absente). */
export function isFeatureEnabled(
  manifest: AppManifest,
  feature: keyof BrandFeatures,
): boolean {
  return manifest.features?.[feature] !== false;
}

/**
 * Infra de publication Windows (feeds + remote-build).
 * Paramètre les scripts `@creezio/desktop-tooling` sans hardcoder une marque.
 */
export type BrandPublishInfra = {
  /** Nom sous `/data/` dans le conteneur NPM (ex. `dl-acme`). */
  dockerDlName: string;
  /** Chemin hôte du volume DL (fallback si pas de docker cp). */
  hostDlDirDefault: string;
  /** Conteneur Docker NPM pour `docker cp` (ex. `nginx-proxy-manager`). */
  npmContainer: string;
  /** Hôte SSH remote-build (`user@host`). */
  remoteBuildHost: string;
  /** Workdir distant parent de `crm/` (ex. `/opt/docker/acme-build`). */
  remoteBuildRoot: string;
  /** Source binaires Windows sur l'hôte distant (infra only). */
  remoteBinSrc: string;
  /** Fichier JSON de statut build (lu par la console). */
  statusFile: string;
  /** Préfixe logs `/tmp/{prefix}-{version}.log`. */
  remoteLogPrefix: string;
  /**
   * Si true, `remote-build-win` produit aussi `dist-electron-server`
   * (modèle Client+Serveur). Une marque peut rester `false` tant que le
   * split packagé n'est pas branché.
   */
  buildServerArtifact: boolean;
  /**
   * Alias legacy client optionnel republie sous ce nom
   * (ex. `Acme-Setup-0.1.0.exe`).
   */
  legacyClientAlias?: string;
  /** Chemin `crm/` local typique pour la console ops (lecture seule). */
  defaultAppRoot: string;
};

/** Résout l'identité pour un kind packagé. */
export function exeForKind(manifest: AppManifest, kind: AppKind): ExeIdentity {
  return kind === "server" ? manifest.server : manifest.client;
}

/** Nom d'env override (ex. `ACME_USER_DATA_OVERRIDE`). */
export function envKey(manifest: AppManifest, suffix: string): string {
  return `${manifest.envPrefix}_${suffix}`;
}

/** Partition persist Chromium pour la vue CRM principale. */
export function appSessionPartition(manifest: AppManifest): string {
  return `persist:${manifest.sessionPartition}`;
}

/** Prefixe argv profil (`--acme-profile=`). */
export function profileArgPrefix(manifest: AppManifest): string {
  return `--${manifest.envPrefix.toLowerCase()}-profile=`;
}

/** Prefixe argv profil-dir. */
export function profileDirArgPrefix(manifest: AppManifest): string {
  return `--${manifest.envPrefix.toLowerCase()}-profile-dir=`;
}

/** Résout `artifactName` → nom de fichier (`${version}` / `${ext}`). */
export function resolveArtifactFileName(
  exe: ExeIdentity,
  version: string,
  ext = "exe",
): string {
  return exe.artifactName
    .replaceAll("${version}", version)
    .replaceAll("${ext}", ext);
}

/** Alias `*-Setup-latest.exe` dérivé du motif artifactName. */
export function resolveLatestAlias(exe: ExeIdentity, ext = "exe"): string {
  return resolveArtifactFileName(exe, "latest", ext);
}

/** URL feed sans slash final. */
export function feedBaseUrl(exe: ExeIdentity): string {
  return exe.feedUrl.replace(/\/+$/, "");
}

/** URL `latest.yml` pour un kind. */
export function latestYmlUrl(manifest: AppManifest, kind: AppKind): string {
  return `${feedBaseUrl(exeForKind(manifest, kind))}/latest.yml`;
}

/** Variable d'env kind packagé (`ACME_APP_KIND`, …). */
export function appKindEnvKey(manifest: AppManifest): string {
  return `${manifest.envPrefix}_APP_KIND`;
}

/** Variable d'env plateforme serveur embarqué (`ACME_SERVER_PLATFORM`, …). */
export function serverPlatformEnvKey(manifest: AppManifest): string {
  return `${manifest.envPrefix}_SERVER_PLATFORM`;
}

/** Dossier dist electron-builder selon kind. */
export function distDirForKind(kind: AppKind): string {
  return kind === "server" ? "dist-electron-server" : "dist-electron";
}
