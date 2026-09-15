type Summary = {
  activity: number;
  plugin_usage: number;
  control_plane: number;
  total: number;
};

type UsageRow = {
  pluginId: string;
  orgId: string | null;
  count: number;
  lastAt: string;
};

type OrgRow = {
  orgId: string;
  count: number;
  lastAt: string;
};

type EventRow = {
  id: string;
  kind: string;
  action: string;
  orgId: string | null;
  pluginId: string | null;
  createdAt: string;
};

export function ObservabilityPanel({
  summary,
  usage,
  orgs,
  recent,
  filePath,
  updatedAt,
}: {
  summary: Summary;
  usage: UsageRow[];
  orgs: OrgRow[];
  recent: EventRow[];
  filePath: string;
  updatedAt: string;
}) {
  return (
    <section className="kit-panel">
      <div className="brand-head">
        <div>
          <h2>Observabilité (V2)</h2>
          <div className="meta">
            activité · usages plugins · control-plane — API{" "}
            <code>GET/POST /api/observability</code>
          </div>
        </div>
        <span className="badge idle">V2</span>
      </div>
      <p className="meta" style={{ marginBottom: 10 }}>
        <code>{filePath}</code> · maj {updatedAt} · total {summary.total} (
        act {summary.activity} · usage {summary.plugin_usage} · cp{" "}
        {summary.control_plane})
      </p>

      <div className="kit-table-wrap" style={{ marginBottom: 16 }}>
        <table className="kit-table">
          <thead>
            <tr>
              <th>Org</th>
              <th>Activités</th>
              <th>Dernier</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 ? (
              <tr>
                <td colSpan={3} className="meta">
                  Aucune activité org — POST un événement.
                </td>
              </tr>
            ) : (
              orgs.map((o) => (
                <tr key={o.orgId}>
                  <td>
                    <code>{o.orgId}</code>
                  </td>
                  <td>{o.count}</td>
                  <td className="meta">{o.lastAt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="kit-table-wrap" style={{ marginBottom: 16 }}>
        <table className="kit-table">
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Org</th>
              <th>Usages</th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 ? (
              <tr>
                <td colSpan={3} className="meta">
                  Aucun usage plugin.
                </td>
              </tr>
            ) : (
              usage.map((u) => (
                <tr key={`${u.pluginId}-${u.orgId || ""}`}>
                  <td>
                    <code>{u.pluginId}</code>
                  </td>
                  <td>{u.orgId || "—"}</td>
                  <td>{u.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {recent.length > 0 ? (
        <div className="kit-table-wrap">
          <table className="kit-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Action</th>
                <th>Org</th>
                <th>Plugin</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td>{e.kind}</td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td>{e.orgId || "—"}</td>
                  <td>{e.pluginId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
