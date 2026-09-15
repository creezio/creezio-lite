import type { OrgPluginRegistrySnapshot } from "@creezio/propagation";

export function OrgPluginsPanel({
  snap,
  filePath,
}: {
  snap: OrgPluginRegistrySnapshot;
  filePath: string;
}) {
  return (
    <section className="kit-panel">
      <div className="brand-head">
        <div>
          <h2>Registre plugins org (L3)</h2>
          <div className="meta">
            persisté fichier · {snap.count} plugin(s) · API{" "}
            <code>GET/POST /api/org-plugins</code>
          </div>
        </div>
        <span className="badge idle">I6</span>
      </div>
      <p className="meta" style={{ marginBottom: 10 }}>
        Fichier : <code>{filePath}</code>
      </p>
      {snap.plugins.length === 0 ? (
        <p className="meta">Aucun enregistrement — upsert via API.</p>
      ) : (
        <div className="kit-table-wrap">
          <table className="kit-table">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Marque</th>
                <th>Org</th>
                <th>Visibilité</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {snap.plugins.map((p) => (
                <tr key={p.pluginId}>
                  <td>
                    <code>{p.pluginId}</code>
                  </td>
                  <td>{p.brandId}</td>
                  <td>{p.orgId}</td>
                  <td>{p.visibility}</td>
                  <td>
                    <code>{p.version}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
