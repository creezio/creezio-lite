/**
 * Contrats control plane plugins HTTP (loopback) — brand-agnostic.
 */

import type { ProductHubBrandTokens } from "../brand-tokens.js";
import type { ProductHubProductDetails } from "../grants-flow.js";
import type {
  PluginAclActor,
  PluginAclDecision,
  PluginAclPolicy,
} from "../acl.js";

export type PluginControlPlaneAdapters = {
  /** Status listing (plugins + running). */
  listStatus: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Création scaffold (vertical peut fournir git). */
  createPlugin: (opts: {
    id: string;
    name?: string;
    description?: string;
  }) => Promise<
    | { ok: true; plugin: unknown; git?: unknown }
    | { ok: false; error: string }
  >;
  writeFiles: (
    id: string,
    files: Record<string, string>,
    message?: string,
  ) => Promise<
    | { ok: true; written: string[]; git?: unknown }
    | { ok: false; error: string }
  >;
  deletePlugin?: (
    id: string,
  ) => Promise<{ ok: true; deleted: string } | { ok: false; error: string }>;
  enablePlugin?: (
    id: string,
    enabled: boolean,
  ) => Promise<{ ok: true; plugin: unknown } | { ok: false; error: string }>;
  restartPlugin?: (
    id: string,
  ) => Promise<
    | { ok: true; running: unknown }
    | { ok: false; error: string }
  >;
  pluginDir: (id: string) => string;
  /** Détails produit CRM pour émission grant. */
  fetchProductDetails?: (
    productId: string,
  ) => Promise<ProductHubProductDetails | null>;
};

/**
 * H5 — ACL org branchée sur le control plane.
 * Absent ⇒ compat Phase E (pas de filtre org — Bearer seul).
 */
export type PluginControlPlaneAcl = {
  resolveActor: (headers: Record<string, string | string[] | undefined>) => PluginAclActor;
  getPolicy: (pluginId: string) => PluginAclPolicy | undefined;
  listPolicies?: () => PluginAclPolicy[];
  /** Après create réussi — bind owner org + grants. */
  onInstalled?: (pluginId: string, actor: PluginAclActor) => void;
  /** Après delete — clear ACL / binding. */
  onUninstalled?: (pluginId: string) => void;
  /**
   * Install d'un plugin inexistant : si true, admin uniquement
   * (défaut). Si false, tout acteur authentifié Bearer peut créer
   * (déconseillé hors sandbox).
   */
  requireAdminToBootstrapInstall?: boolean;
};

export type PluginControlPlaneOptions = {
  tokens: ProductHubBrandTokens;
  /** Bearer secret (= control token). */
  controlToken: string;
  pluginsDir: string;
  adapters: PluginControlPlaneAdapters;
  /** Port préféré (info health). */
  preferredPort?: number;
  /** H5 — enforcement ACL L3 (optionnel, rétrocompat). */
  acl?: PluginControlPlaneAcl;
  /**
   * C7 — routes marque avant le handler kit (extras TF/Certivan).
   * Retourne `true` si la requête est entièrement traitée.
   */
  preHandle?: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => boolean | Promise<boolean>;
};

export type PluginControlPlaneState = {
  port: number;
  url: string;
  token: string;
  pluginsDir: string;
  tokens: ProductHubBrandTokens;
  close: () => Promise<void>;
};

export type { PluginAclActor, PluginAclDecision, PluginAclPolicy };
