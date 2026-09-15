"use client";

/**
 * Bandeau impersonation « Voir comme » — module natif kit.
 * Rendu par WorkspaceRoot au-dessus du slot `banners` : visible dès que la
 * session est impersonifiée (`me.impersonating`), quel que soit le câblage
 * marque. « Revenir à mon compte » = stopImpersonate (redirect
 * stopImpersonateRedirect du SessionProvider, défaut /collaborateurs).
 * Le nom produit vient de getShellUiBrand().productName (CreezioUiBoot) —
 * aucun libellé marque en dur ici.
 */

import { Undo2 } from "lucide-react";
import { useSession } from "@creezio/auth/ui";
import { getShellUiBrand } from "@creezio/shell-ui";
import { Button } from "../primitives/button";
import { aidProps } from "../lib/aid";

export function ImpersonationBanner() {
  const { me, stopImpersonate } = useSession();
  if (!me?.impersonating) return null;
  const productName = getShellUiBrand().productName;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <span className="min-w-0 truncate">
        Vous voyez {productName} comme <strong>{me.user}</strong>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => void stopImpersonate()}
        {...aidProps("impersonation-stop")}
      >
        <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Revenir à mon compte
      </Button>
    </div>
  );
}