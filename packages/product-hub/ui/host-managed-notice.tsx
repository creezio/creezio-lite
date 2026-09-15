"use client";

import { ServerCog } from "lucide-react";
import { getProductHubUiBrand } from "../dist/plugin-ui/index.js";

/** Encart « géré par l'app Serveur » (client distant). */
export function HostManagedNotice({
  label = "cette section",
}: {
  label?: string;
}) {
  const server = getProductHubUiBrand().serverLabel;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      <ServerCog className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
      <div>
        <p className="font-medium text-slate-700">
          Géré par l&apos;app {server}
        </p>
        <p className="mt-1">
          Vous êtes connecté à un serveur distant : {label} se configure sur le
          poste qui héberge le serveur, pas depuis ce client.
        </p>
      </div>
    </div>
  );
}
