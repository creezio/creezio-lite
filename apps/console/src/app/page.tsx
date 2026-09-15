import { BrandCard } from "@/components/BrandCard";
import { GatesPanel } from "@/components/GatesPanel";
import { KitVersionsPanel } from "@/components/KitVersionsPanel";
import { OrgPluginsPanel } from "@/components/OrgPluginsPanel";
import { ObservabilityPanel } from "@/components/ObservabilityPanel";
import { PluginFactoryPanel } from "@/components/PluginFactoryPanel";
import { loadKitSnapshot } from "@/lib/kit";
import { loadObservabilityConsoleSnapshot } from "@/lib/observability-console";
import { loadOrgPluginRegistrySnapshot } from "@/lib/org-plugin-registry";
import { listFactorySessionsSnapshot } from "@/lib/plugin-factory-demo";
import { loadParc } from "@/lib/parc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomePage() {
  const parc = loadParc();
  const kit = loadKitSnapshot();
  const orgPlugins = loadOrgPluginRegistrySnapshot();
  const factory = listFactorySessionsSnapshot();
  const obs = loadObservabilityConsoleSnapshot();
  const generatedAt = new Date().toISOString();

  return (
    <main>
      <header className="top">
        <div>
          <h1>Creezio Console</h1>
          <p>
            Pilotage du parc desktop + inventaire kit @creezio/* — feeds
            Client/Serveur, versions locales, gates G1/G2/G3 (docs).
          </p>
        </div>
        <div className="meta">généré {generatedAt}</div>
      </header>

      <KitVersionsPanel snap={kit} />
      <PluginFactoryPanel
        sessions={factory.sessions}
        filePath={factory.filePath}
        updatedAt={factory.updatedAt}
      />
      <ObservabilityPanel
        summary={obs.summary}
        usage={obs.usage}
        orgs={obs.orgs}
        recent={obs.recent}
        filePath={obs.filePath}
        updatedAt={obs.updatedAt}
      />
      <OrgPluginsPanel snap={orgPlugins} filePath={orgPlugins.filePath} />
      <GatesPanel snap={kit} />

      <h2 className="section-title">Parc marques</h2>
      <div className="grid">
        {parc.map((row) => (
          <BrandCard key={row.brandId} row={row} />
        ))}
      </div>

      <footer className="foot">
        <p>
          Lecture seule des feeds publics (<code>latest.yml</code>). Triggers
          destructifs (build/publish) restent CLI — voir{" "}
          <code>apps/console/README.md</code>,{" "}
          <a
            href="https://github.com/creezio/creezio/blob/main/docs/PROPAGATION.md"
            target="_blank"
            rel="noreferrer"
          >
            docs/PROPAGATION.md
          </a>{" "}
          et{" "}
          <a
            href="https://github.com/creezio/creezio/blob/main/docs/archive/PHASE-F.md"
            target="_blank"
            rel="noreferrer"
          >
            docs/archive/PHASE-F.md
          </a>
          .
        </p>
        <p>
          Suite : <strong>Phase G</strong> — bascule gated{" "}
          <strong>G1 Certivan</strong> d&apos;abord (pas exécutée ici).
        </p>
      </footer>
    </main>
  );
}
