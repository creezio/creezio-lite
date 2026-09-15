import type { KitConsoleSnapshot } from "@/lib/kit";

export function KitVersionsPanel({ snap }: { snap: KitConsoleSnapshot }) {
  return (
    <section className="kit-panel">
      <div className="brand-head">
        <div>
          <h2>Packages kit @creezio/*</h2>
          <div className="meta">
            inventaire local · canal workspace-local · root v
            {snap.inventory.rootVersion || "—"}
            {" · "}
            <code>ARCHITECTURE_VERSION={snap.architectureVersion || "—"}</code>
          </div>
        </div>
        <span className="badge idle">
          {snap.architectureVersion || "kit"}
        </span>
      </div>

      <div className="kit-table-wrap">
        <table className="kit-table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Version</th>
              <th>Couche</th>
              <th>Publié</th>
              <th>Résumé</th>
            </tr>
          </thead>
          <tbody>
            {snap.inventory.packages.map((p) => {
              const pub = snap.published.find((x) => x.name === p.name);
              return (
                <tr key={p.name}>
                  <td>
                    <code>{p.name}</code>
                  </td>
                  <td>
                    <code>{p.version}</code>
                  </td>
                  <td>{p.layer}</td>
                  <td className="meta">{pub?.publishChannel || "—"}</td>
                  <td className="meta">{p.summary}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="meta" style={{ marginTop: 10 }}>
        Registry npm privé hors scope Phase F — la version locale workspace est
        la source de vérité. API : <code>GET /api/kit-versions</code>.
      </p>
    </section>
  );
}
