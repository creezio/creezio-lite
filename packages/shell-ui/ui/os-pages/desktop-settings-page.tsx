"use client";

/**
 * Page OS réglages desktop — composition kit (pas de métier marque).
 * Les marques ne font que `export { DesktopSettingsPage as default }`.
 *
 * Parité Configuration TF (onglets Connexion / Hosts / Compte / Support / Système).
 */
import { AccountSettings } from "../settings/account-settings";
import { AgentProfileSettings } from "../settings/agent-profile-settings";
import { ApiKeysSettings } from "../settings/api-keys-settings";
import { DesktopConnectionSettings } from "../settings/desktop-connection-settings";
import { DesktopHermesSettings } from "../settings/desktop-hermes-settings";
import { DesktopN8nSettings } from "../settings/desktop-n8n-settings";
import { DesktopTunnel } from "../settings/desktop-tunnel";
import { DesktopLlmKeys } from "../settings/desktop-llm-keys";
import { DesktopUpdateSettings } from "../settings/desktop-update-settings";
import { DesktopBackgroundSettings } from "../settings/desktop-background-settings";
import { DesktopFleetTelemetrySettings } from "../settings/desktop-fleet-telemetry-settings";
import { FactoryResetSettings } from "../settings/factory-reset-settings";
import { OpsDiagnosticSettings } from "../settings/ops-diagnostic-settings";
import { SearchReindexSettings } from "../settings/search-reindex-settings";
import {
  HostManagedNotice,
  HostOnlySettings,
} from "../settings/host-only-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../primitives/tabs";
import type { ReactNode } from "react";

export type DesktopSettingsExtraTab = {
  value: string;
  label: string;
  content: ReactNode;
};

export type DesktopSettingsPageProps = {
  /**
   * Onglets additionnels injectés par la marque / le wrapper os-ui —
   * ex. Email (`MailSettings` de @creezio/mails/ui, dépendance inverse
   * interdite depuis shell-ui). Insérés avant Support.
   */
  extraTabs?: DesktopSettingsExtraTab[];
  /** Onglet ouvert par défaut (ex. `?tab=email`). Défaut : connexion. */
  defaultTab?: string;
};

export function DesktopSettingsPage({
  extraTabs = [],
  defaultTab,
}: DesktopSettingsPageProps = {}) {
  const known = new Set([
    "connexion",
    "hermes",
    "n8n",
    "tunnel",
    "compte",
    "support",
    "systeme",
    ...extraTabs.map((t) => t.value),
  ]);
  const initial = defaultTab && known.has(defaultTab) ? defaultTab : "connexion";
  return (
    <section className="mx-auto max-w-4xl px-0 py-4">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-slate-900">
        Configuration
      </h1>
      <p className="mb-4 text-sm text-slate-600">
        Chaque service a son onglet — paramètres verrouillés visibles, actions et
        statut
      </p>
      <Tabs defaultValue={initial} className="w-full">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="connexion">Connexion</TabsTrigger>
          <TabsTrigger value="hermes">Hermes</TabsTrigger>
          <TabsTrigger value="n8n">n8n</TabsTrigger>
          <TabsTrigger value="tunnel">Accès distant</TabsTrigger>
          <TabsTrigger value="compte">Compte &amp; clés</TabsTrigger>
          {extraTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="support">Support</TabsTrigger>
          <TabsTrigger value="systeme">Système</TabsTrigger>
        </TabsList>

        <TabsContent value="connexion" className="mt-0 space-y-4">
          <DesktopConnectionSettings />
        </TabsContent>

        <TabsContent value="hermes" className="mt-0 space-y-4">
          <HostOnlySettings
            fallback={<HostManagedNotice label="l'agent Hermes" />}
          >
            <DesktopHermesSettings />
          </HostOnlySettings>
        </TabsContent>

        <TabsContent value="n8n" className="mt-0 space-y-4">
          <HostOnlySettings fallback={<HostManagedNotice label="n8n" />}>
            <DesktopN8nSettings />
          </HostOnlySettings>
        </TabsContent>

        <TabsContent value="tunnel" className="mt-0 space-y-4">
          <HostOnlySettings
            fallback={<HostManagedNotice label="l'accès distant (tunnel)" />}
          >
            <DesktopTunnel />
          </HostOnlySettings>
        </TabsContent>

        <TabsContent value="compte" className="mt-0 space-y-4">
          <HostOnlySettings
            fallback={
              <HostManagedNotice label="le compte propriétaire et les clés IA" />
            }
          >
            <AccountSettings />
            <DesktopLlmKeys />
          </HostOnlySettings>
          <AgentProfileSettings />
          <ApiKeysSettings />
        </TabsContent>

        {extraTabs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-0 space-y-4">
            {t.content}
          </TabsContent>
        ))}

        <TabsContent value="support" className="mt-0 space-y-4">
          <HostOnlySettings
            fallback={<HostManagedNotice label="la télémétrie support" />}
          >
            <DesktopFleetTelemetrySettings />
          </HostOnlySettings>
        </TabsContent>

        <TabsContent value="systeme" className="mt-0 space-y-4">
          <DesktopUpdateSettings />
          <DesktopBackgroundSettings />
          <HostOnlySettings
            fallback={
              <HostManagedNotice label="l'index de recherche et la remise à zéro" />
            }
          >
            <SearchReindexSettings />
            <OpsDiagnosticSettings />
            <FactoryResetSettings />
          </HostOnlySettings>
        </TabsContent>
      </Tabs>
    </section>
  );
}

export default DesktopSettingsPage;
