import type { FactorySessionSnapshot } from "@creezio/product-hub";

export function PluginFactoryPanel({
  sessions,
  filePath,
  updatedAt,
}: {
  sessions: FactorySessionSnapshot[];
  filePath: string;
  updatedAt: string;
}) {
  return (
    <section className="kit-panel">
      <div className="brand-head">
        <div>
          <h2>Fabrique plugins (V1)</h2>
          <div className="meta">
            intention → analyse → PRD → scaffold → DB plugin — API{" "}
            <code>GET/POST /api/plugin-factory</code>
          </div>
        </div>
        <span className="badge idle">V1</span>
      </div>
      <p className="meta" style={{ marginBottom: 10 }}>
        Sessions : <code>{filePath}</code> · maj {updatedAt}
      </p>
      {sessions.length === 0 ? (
        <p className="meta">
          Aucune session —{" "}
          <code>
            POST /api/plugin-factory {"{"} &quot;text&quot;: &quot;…&quot; {"}"}
          </code>
        </p>
      ) : (
        <div className="kit-table-wrap">
          <table className="kit-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Plugin</th>
                <th>Phase</th>
                <th>Lifecycle</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.productId}>
                  <td>
                    <code>{s.product.name}</code>
                  </td>
                  <td>
                    <code>{s.pluginId || s.suggestedPluginId || "—"}</code>
                  </td>
                  <td>{s.phase}</td>
                  <td>{s.product.lifecycle_state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
