/**
 * ACL plugins — contrats L3 (org/tenant) et L4 (user) — H5 durci.
 *
 * Port du modèle Certivan/TF2 `plugin_acl` (L4) + extension kit L3 (org).
 * FAIL-CLOSED : sans grant explicite, seul l'owner (ou clé service) voit.
 * H5 : capacités `see` / `install` / `execute` + deny cross-org.
 * Persistance SQL = vertical (apps) ; ce module reste pur.
 */

/** Niveau L3 = organisation / tenant. */
export const PLUGIN_ACL_LEVEL_ORG = "L3" as const;
/** Niveau L4 = utilisateur collaborateur. */
export const PLUGIN_ACL_LEVEL_USER = "L4" as const;

export type PluginAclLevel =
  | typeof PLUGIN_ACL_LEVEL_ORG
  | typeof PLUGIN_ACL_LEVEL_USER;

/** Actions ACL Product Hub (visibilité / install / exécution). */
export type PluginAclAction = "see" | "install" | "execute";

export type PluginAclCapability = PluginAclAction;

/** Capacités implicites quand un org/user est listé sans lignes capability. */
export const PLUGIN_ACL_DEFAULT_CAPABILITIES: readonly PluginAclCapability[] = [
  "see",
  "execute",
] as const;

export type PluginAclActor = {
  /** Tenant / org (L3). */
  orgId?: string | null;
  /** Utilisateur (L4) — session.sub ou apiKeyUserId. */
  userId?: string | null;
  /** Owner non impersoné. */
  isOwner?: boolean;
  /** Clé API service sans user_id (= niveau owner). */
  isServiceKey?: boolean;
  /** Impersonation active → refuse le shortcut owner. */
  isImpersonating?: boolean;
};

export type PluginAclCapabilityGrant = {
  subjectKind: "org" | "user";
  subjectId: string;
  capability: PluginAclCapability;
};

export type PluginAclEntry = {
  pluginId: string;
  /** L3 — orgs autorisées (membership). */
  orgIds: string[];
  /** L4 — users autorisés (membership). */
  userIds: string[];
  /** Org propriétaire du plugin (binding install). */
  ownerOrgId?: string | null;
  /**
   * Capacités explicites. Vide / absent ⇒ pour chaque sujet listé,
   * défaut = see+execute (compat H1.8 / Phase E).
   */
  capabilities?: PluginAclCapabilityGrant[];
};

export type PluginAclPolicy = {
  pluginId: string;
  allowedOrgIds: string[];
  allowedUserIds: string[];
  /** Org propriétaire — deny cross-org si acteur d'une autre org. */
  ownerOrgId?: string | null;
  /**
   * Capacités par sujet. Clé = `org:<id>` ou `user:<id>`.
   * Absente ⇒ défaut see+execute si le sujet est listé.
   */
  capabilitiesBySubject?: Record<string, PluginAclCapability[]>;
  /** Défaut true — aucun enregistrement ⇒ owner seul. */
  failClosed?: boolean;
};

export type PluginAclDecision =
  | { allow: true }
  | { allow: false; reason: string };

/** Acteur « niveau owner » : owner non impersoné, ou clé API service. */
export function actorIsPluginAdmin(actor: PluginAclActor): boolean {
  if (actor.isServiceKey) return true;
  if (actor.isOwner && !actor.isImpersonating) return true;
  return false;
}

export function subjectKey(
  kind: "org" | "user",
  id: string,
): string {
  return `${kind}:${id}`;
}

function capabilitiesForSubject(
  policy: PluginAclPolicy,
  kind: "org" | "user",
  id: string,
): PluginAclCapability[] | null {
  const listed =
    kind === "org"
      ? policy.allowedOrgIds.includes(id)
      : policy.allowedUserIds.includes(id);
  if (!listed) return null;
  const explicit = policy.capabilitiesBySubject?.[subjectKey(kind, id)];
  if (explicit && explicit.length > 0) return explicit;
  return [...PLUGIN_ACL_DEFAULT_CAPABILITIES];
}

/**
 * Deny cross-org : plugin bound à org A, acteur org B (non admin)
 * et B non listée ⇒ refus, indépendamment de l'action.
 */
export function isCrossOrgDenied(
  policy: PluginAclPolicy,
  actor: PluginAclActor,
): boolean {
  if (actorIsPluginAdmin(actor)) return false;
  const owner = policy.ownerOrgId ? String(policy.ownerOrgId) : null;
  const actorOrg = actor.orgId ? String(actor.orgId) : null;
  if (!owner || !actorOrg) return false;
  if (owner === actorOrg) return false;
  // Autre org : uniquement si grant L3 explicite (delegation).
  return !policy.allowedOrgIds.includes(actorOrg);
}

function actorHasCapability(
  policy: PluginAclPolicy,
  actor: PluginAclActor,
  capability: PluginAclCapability,
): boolean {
  if (actorIsPluginAdmin(actor)) return true;
  if (isCrossOrgDenied(policy, actor)) return false;

  const orgId = actor.orgId ? String(actor.orgId) : null;
  const userId = actor.userId ? String(actor.userId) : null;

  if (orgId) {
    const caps = capabilitiesForSubject(policy, "org", orgId);
    if (caps?.includes(capability)) return true;
  }
  if (userId) {
    const caps = capabilitiesForSubject(policy, "user", userId);
    if (caps?.includes(capability)) return true;
  }
  return false;
}

/**
 * Décision unique API + MCP + control-plane (H5).
 * - see     : membership L3/L4 (ou admin)
 * - execute : capability execute (défaut si listé)
 * - install : capability install explicite (ou admin) — PAS dans le défaut
 */
export function decidePluginAccess(
  policy: PluginAclPolicy | undefined,
  actor: PluginAclActor,
  action: PluginAclAction,
): PluginAclDecision {
  if (actorIsPluginAdmin(actor)) return { allow: true };

  const effective: PluginAclPolicy = policy || {
    pluginId: "",
    allowedOrgIds: [],
    allowedUserIds: [],
    failClosed: true,
  };

  if (isCrossOrgDenied(effective, actor)) {
    return { allow: false, reason: "cross_org_denied" };
  }

  const failClosed = effective.failClosed !== false;
  const hasAnyGrant =
    effective.allowedOrgIds.length > 0 || effective.allowedUserIds.length > 0;

  if (!hasAnyGrant) {
    if (!failClosed) return { allow: true };
    return { allow: false, reason: "acl_fail_closed" };
  }

  if (!actorHasCapability(effective, actor, action)) {
    return {
      allow: false,
      reason:
        action === "install"
          ? "acl_install_denied"
          : action === "execute"
            ? "acl_execute_denied"
            : "acl_see_denied",
    };
  }
  return { allow: true };
}

/**
 * L'acteur peut-il voir ce plugin ?
 * - admin → oui ;
 * - org listée (L3) avec cap see → oui ;
 * - user listé (L4) avec cap see → oui ;
 * - sinon non (fail-closed).
 */
export function canActorSeePlugin(
  policy: PluginAclPolicy,
  actor: PluginAclActor,
): boolean {
  return decidePluginAccess(policy, actor, "see").allow;
}

export function canActorInstallPlugin(
  policy: PluginAclPolicy,
  actor: PluginAclActor,
): boolean {
  return decidePluginAccess(policy, actor, "install").allow;
}

export function canActorExecutePlugin(
  policy: PluginAclPolicy,
  actor: PluginAclActor,
): boolean {
  return decidePluginAccess(policy, actor, "execute").allow;
}

/** Filtre ids visibles. */
export function filterVisiblePluginIds(
  pluginIds: string[],
  policies: Map<string, PluginAclPolicy> | PluginAclPolicy[],
  actor: PluginAclActor,
): string[] {
  if (actorIsPluginAdmin(actor)) return pluginIds;
  const map =
    policies instanceof Map
      ? policies
      : new Map(policies.map((p) => [p.pluginId, p]));
  return pluginIds.filter((id) => {
    const policy = map.get(id) || {
      pluginId: id,
      allowedOrgIds: [],
      allowedUserIds: [],
      failClosed: true,
    };
    return canActorSeePlugin(policy, actor);
  });
}

/** Agrège lignes SQL L3+L4 → entrées. */
export function aggregateAclRows(
  rows: Array<{
    plugin_id: string;
    org_id?: string | null;
    user_id?: string | null;
  }>,
): PluginAclEntry[] {
  const map = new Map<string, { orgIds: Set<string>; userIds: Set<string> }>();
  for (const r of rows) {
    const cur = map.get(r.plugin_id) || {
      orgIds: new Set<string>(),
      userIds: new Set<string>(),
    };
    if (r.org_id) cur.orgIds.add(String(r.org_id));
    if (r.user_id) cur.userIds.add(String(r.user_id));
    map.set(r.plugin_id, cur);
  }
  return Array.from(map.entries()).map(([pluginId, sets]) => ({
    pluginId,
    orgIds: Array.from(sets.orgIds).sort(),
    userIds: Array.from(sets.userIds).sort(),
  }));
}

export function aclEntryToPolicy(entry: PluginAclEntry): PluginAclPolicy {
  const capabilitiesBySubject: Record<string, PluginAclCapability[]> = {};
  for (const g of entry.capabilities || []) {
    const key = subjectKey(g.subjectKind, g.subjectId);
    const cur = capabilitiesBySubject[key] || [];
    if (!cur.includes(g.capability)) cur.push(g.capability);
    capabilitiesBySubject[key] = cur;
  }
  return {
    pluginId: entry.pluginId,
    allowedOrgIds: entry.orgIds,
    allowedUserIds: entry.userIds,
    ownerOrgId: entry.ownerOrgId ?? null,
    ...(Object.keys(capabilitiesBySubject).length > 0
      ? { capabilitiesBySubject }
      : {}),
    failClosed: true,
  };
}

/** Headers actor control-plane / API (convention kit H5). */
export const PLUGIN_ACL_ORG_HEADER = "x-creezio-org-id";
export const PLUGIN_ACL_USER_HEADER = "x-creezio-user-id";
export const PLUGIN_ACL_OWNER_HEADER = "x-creezio-is-owner";

export function resolvePluginAclActorFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  opts?: { treatMissingAsServiceKey?: boolean },
): PluginAclActor {
  const get = (name: string): string | null => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    if (v == null) return null;
    const s = Array.isArray(v) ? v[0] : v;
    const t = String(s || "").trim();
    return t || null;
  };
  const orgId = get(PLUGIN_ACL_ORG_HEADER);
  const userId = get(PLUGIN_ACL_USER_HEADER);
  const ownerRaw = get(PLUGIN_ACL_OWNER_HEADER);
  const isOwner = ownerRaw === "1" || ownerRaw === "true";
  if (!orgId && !userId && !isOwner && opts?.treatMissingAsServiceKey) {
    return { isServiceKey: true };
  }
  return {
    orgId,
    userId,
    isOwner,
  };
}

/** Headers actor pour API / MCP / control-plane (I4 — helper marques). */
export function buildPluginAclActorHeaders(
  actor: PluginAclActor,
): Record<string, string> {
  const h: Record<string, string> = {};
  if (actor.orgId) h[PLUGIN_ACL_ORG_HEADER] = String(actor.orgId);
  if (actor.userId) h[PLUGIN_ACL_USER_HEADER] = String(actor.userId);
  if (actor.isOwner) h[PLUGIN_ACL_OWNER_HEADER] = "1";
  return h;
}
