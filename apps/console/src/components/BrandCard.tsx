import type { BrandParcRow } from "@/lib/parc";
import { ArtifactCard } from "./ArtifactCard";
import { RemoteBuildButton } from "./RemoteBuildButton";

export function BrandCard({ row }: { row: BrandParcRow }) {
  const state = row.buildStatus.state || "idle";
  return (
    <article className="brand">
      <div className="brand-head">
        <div>
          <h2>{row.label}</h2>
          <div className="meta">
            {row.brandId} · env {row.envPrefix} · {row.defaultAppRoot}
            {row.sandbox ? " · sandbox factory" : ""}
          </div>
        </div>
        <span className={`badge ${state}`}>
          {row.sandbox ? "sandbox" : `build ${state}`}
        </span>
      </div>

      <div className="arts">
        <ArtifactCard title="Client" feed={row.feeds.client} />
        <ArtifactCard
          title="Serveur"
          feed={row.feeds.server}
          targetNote={
            row.brandId === "fidu"
              ? "Cible kit (feed serveur pas encore publié)"
              : undefined
          }
        />
      </div>

      <div className="actions" style={{ marginTop: 12 }}>
        <span className="meta">
          phase {row.buildStatus.phase || "—"}
          {row.buildStatus.codeVersion
            ? ` · code ${row.buildStatus.codeVersion}`
            : ""}
          {row.buildStatus.message ? ` · ${row.buildStatus.message}` : ""}
          {row.buildServerArtifact
            ? " · remote-build = client+serveur"
            : " · remote-build = client only"}
        </span>
      </div>

      <RemoteBuildButton brandId={row.brandId} />
    </article>
  );
}
