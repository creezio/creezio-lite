"use client";

/**
 * AdminModuleGate — état EXPLICITE en accès URL direct sans permission.
 *
 * La sidebar cache déjà les modules non permis et l'API renvoie 403
 * (authorizeModuleAccess), mais une URL tapée directement rendrait sinon
 * une page « vide » (les clients admin avalent les erreurs fetch). Ce
 * wrapper lit `/api/v1/auth/me` et applique la MÊME règle que la sidebar
 * kit (`hasItemPermission`) : owner non impersonné = tout ; sinon la
 * permission du module doit être dans `me.permissions` (résolues par
 * @creezio/access-control quand configuré).
 *
 * Usage (page Next d'une app admin) :
 *   <AdminModuleGate permission={ADMIN_MODULE_PERMISSIONS.billing}>
 *     <BillingAdminClient />
 *   </AdminModuleGate>
 */

import React, { useEffect, useState } from "react";

type MePayload = {
  user?: string;
  role?: string;
  permissions?: string[];
  impersonating?: boolean;
  auth_disabled?: boolean;
};

type GateState = "loading" | "allowed" | "denied";

function meAllows(me: MePayload | null, permission: string): boolean {
  if (!me) return false;
  if (me.auth_disabled === true) return true;
  if (me.role === "owner" && me.impersonating !== true) return true;
  const permissions = Array.isArray(me.permissions) ? me.permissions : [];
  return permissions.includes(permission);
}

export function AdminModuleGate({
  permission,
  label,
  children,
}: {
  /** Permission canonique du module (ex. ADMIN_MODULE_PERMISSIONS.billing). */
  permission: string;
  /** Nom lisible du module pour le message (défaut : la permission). */
  label?: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/auth/me")
      .then(async (r) => (r.ok ? ((await r.json()) as MePayload) : null))
      .then((me) => {
        if (cancelled) return;
        setState(meAllows(me, permission) ? "allowed" : "denied");
      })
      .catch(() => {
        // /me injoignable : fail-closed visuel (l'API reste la frontière réelle).
        if (!cancelled) setState("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [permission]);

  if (state === "allowed") return <>{children}</>;
  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        Vérification des accès…
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <div className="text-4xl" aria-hidden>
        🔒
      </div>
      <h2 className="text-lg font-semibold">Accès refusé</h2>
      <p className="text-sm text-muted-foreground">
        Votre compte n&apos;a pas la permission du module
        {" "}
        <span className="font-medium">{label || permission}</span>.
        Demandez à un administrateur de vous l&apos;attribuer
        (Admin → Rôles &amp; accès → Comptes).
      </p>
    </div>
  );
}
