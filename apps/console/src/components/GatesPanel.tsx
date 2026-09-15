import type { KitConsoleSnapshot } from "@/lib/kit";

export function GatesPanel({ snap }: { snap: KitConsoleSnapshot }) {
  return (
    <section className="kit-panel">
      <div className="brand-head">
        <div>
          <h2>Gates Phase G (docs)</h2>
          <div className="meta">
            checklists prêtes — non exécutées en Phase F · ordre G1 → G2 → G3
          </div>
        </div>
        <span className="badge warn">gated</span>
      </div>

      <div className="gates">
        {snap.docs
          .filter((d) => d.id.startsWith("g") || d.id === "propagation" || d.id === "phase-f")
          .map((d) => (
            <a key={d.id} className="gate-link" href={d.href} target="_blank" rel="noreferrer">
              <strong>{d.label}</strong>
              <span className="meta">ouvrir sur GitHub</span>
            </a>
          ))}
      </div>

      <ol className="gate-order">
        {snap.gates.map((g) => (
          <li key={g.id}>
            <strong>
              {g.id} — {g.label}
            </strong>{" "}
            <span className="meta">({g.brandId})</span>
            {" · "}
            <a
              href={`https://github.com/creezio/creezio/blob/main/${g.doc}`}
              target="_blank"
              rel="noreferrer"
            >
              {g.doc}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
