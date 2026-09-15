import type { FeedSnapshot } from "@creezio/desktop-tooling";

function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Go`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mo`;
  return `${n} o`;
}

export function ArtifactCard({
  title,
  feed,
  targetNote,
}: {
  title: string;
  feed: FeedSnapshot;
  targetNote?: string;
}) {
  const missing = !feed.ok || !feed.meta.version;
  return (
    <section className="art">
      <h3>{title}</h3>
      {missing ? (
        <div className="ver missing">
          {targetNote || feed.error || "Feed indisponible"}
        </div>
      ) : (
        <div className="ver">{feed.meta.version}</div>
      )}
      <div className="sub">
        {feed.meta.releaseDate
          ? `release ${feed.meta.releaseDate}`
          : "pas de releaseDate"}
        {" · "}
        {fmtSize(feed.meta.size)}
      </div>
      <div className="links">
        {feed.downloadUrl ? (
          <a href={feed.downloadUrl} target="_blank" rel="noreferrer">
            Télécharger l’exe
          </a>
        ) : (
          <span className="sub">Pas de lien exe</span>
        )}
        <a href={feed.latestYmlUrl} target="_blank" rel="noreferrer">
          latest.yml
        </a>
        <span className="sub">{feed.feedUrl}</span>
      </div>
    </section>
  );
}
