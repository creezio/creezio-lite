"use client";

/**
 * Client d'édition de la landing (page admin OS) — patron module natif
 * hybride : tout le contenu (textes + images) vit en DB brand et s'édite ici.
 *
 * API : /api/v1/modules/landing (sections CRUD + reorder, settings, media).
 * Images : upload JSON base64 → /api/v1/modules/landing/media → URL
 * `/lp-media/{file}` insérée dans le champ.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input } from "@creezio/shell-ui/ui/kit";
import type { LandingSectionView, LandingSettingsView } from "./types";

const API = "/api/v1/modules/landing";

export type LandingAdminLabels = {
  title?: string;
  subtitle?: string;
  publicHref?: string;
};

const IMAGE_FIELD_RE = /(image|logo|img|photo|icon)url$/i;

function isImageField(key: string): boolean {
  return IMAGE_FIELD_RE.test(key.toLowerCase());
}

async function uploadImage(file: File): Promise<string | null> {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const r = await fetch(`${API}/media`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, dataBase64 }),
  });
  const j = await r.json();
  return j?.ok ? String(j.url) : null;
}

function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ fontSize: 12, opacity: 0.7 }}>{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {value ? (
          <img
            src={value}
            alt=""
            style={{
              height: 40,
              width: 40,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid rgba(127,127,127,.3)",
            }}
          />
        ) : null}
        <Input
          value={value}
          placeholder="/lp-media/… ou https://…"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value)
          }
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "…" : "Uploader"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            try {
              const url = await uploadImage(f);
              if (url) onChange(url);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </div>
  );
}

function ContentField({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (typeof value === "string" && isImageField(fieldKey)) {
    return <ImageField label={fieldKey} value={value} onChange={onChange} />;
  }
  if (typeof value === "string") {
    const long = value.length > 80;
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12, opacity: 0.7 }}>{fieldKey}</label>
        {long ? (
          <textarea
            value={value}
            rows={3}
            style={{
              width: "100%",
              borderRadius: 8,
              padding: 8,
              background: "transparent",
              border: "1px solid rgba(127,127,127,.3)",
              color: "inherit",
              font: "inherit",
            }}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange(e.target.value)
            }
          />
        )}
      </div>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12, opacity: 0.7 }}>{fieldKey}</label>
        <Input
          value={String(value)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const raw = e.target.value;
            if (typeof value === "number") onChange(Number(raw) || 0);
            else onChange(raw === "true");
          }}
        />
      </div>
    );
  }
  // Listes / objets (items features, plans pricing, links…) : JSON éditable.
  return (
    <JsonField fieldKey={fieldKey} value={value} onChange={onChange} />
  );
}

function JsonField({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(JSON.stringify(value ?? null, null, 2));
  }, [value]);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ fontSize: 12, opacity: 0.7 }}>
        {fieldKey} (JSON){error ? " — invalide" : ""}
      </label>
      <textarea
        value={text}
        rows={Math.min(12, text.split("\n").length + 1)}
        style={{
          width: "100%",
          borderRadius: 8,
          padding: 8,
          background: "transparent",
          border: `1px solid ${error ? "#e5484d" : "rgba(127,127,127,.3)"}`,
          color: "inherit",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
        }}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError(false);
          } catch {
            setError(true);
          }
        }}
      />
    </div>
  );
}

const SETTINGS_FIELDS: Array<{ key: string; label: string; image?: boolean }> = [
  { key: "title", label: "Titre (onglet/SEO)" },
  { key: "brandName", label: "Nom de marque" },
  { key: "tagline", label: "Tagline" },
  { key: "accent", label: "Couleur accent (hex)" },
  { key: "background", label: "Couleur fond (hex)" },
  { key: "logoUrl", label: "Logo", image: true },
];

export function LandingAdminClient({ labels }: { labels?: LandingAdminLabels }) {
  const [sections, setSections] = useState<LandingSectionView[]>([]);
  const [settings, setSettings] = useState<LandingSettingsView>({});
  const [kinds, setKinds] = useState<string[]>([]);
  const [newKind, setNewKind] = useState("hero");
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rs, rg, rk] = await Promise.all([
        fetch(`${API}/sections`, { cache: "no-store" }),
        fetch(`${API}/settings`, { cache: "no-store" }),
        fetch(`${API}/kinds`, { cache: "no-store" }),
      ]);
      const js = await rs.json();
      const jg = await rg.json();
      const jk = await rk.json();
      if (js?.ok) setSections(js.sections || []);
      if (jg?.ok) setSettings(jg.settings || {});
      if (jk?.ok) setKinds(jk.kinds || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markSaved = () =>
    setSavedAt(new Date().toLocaleTimeString("fr-FR"));

  const saveSection = useCallback(async (s: LandingSectionView) => {
    await fetch(`${API}/sections/${encodeURIComponent(s.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: s.kind,
        position: s.position,
        enabled: s.enabled,
        content: s.content,
      }),
    });
    markSaved();
  }, []);

  const saveSettings = useCallback(async () => {
    await fetch(`${API}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    markSaved();
  }, [settings]);

  const addSection = useCallback(async () => {
    if (!newKind.trim()) return;
    await fetch(`${API}/sections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: newKind.trim(), content: { title: "" } }),
    });
    await refresh();
  }, [newKind, refresh]);

  const removeSection = useCallback(
    async (id: string) => {
      await fetch(`${API}/sections/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refresh();
    },
    [refresh],
  );

  const move = useCallback(
    async (index: number, dir: -1 | 1) => {
      const next = [...sections];
      const target = index + dir;
      if (target < 0 || target >= next.length) return;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      setSections(next);
      await fetch(`${API}/sections/reorder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: next.map((s) => s.id) }),
      });
      markSaved();
    },
    [sections],
  );

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>
          {labels?.title || "Landing page"}
        </h1>
        <span style={{ fontSize: 13, opacity: 0.7 }}>
          {labels?.subtitle ||
            "Contenu 100 % éditable — publié sur la page publique."}
        </span>
        <a
          href={labels?.publicHref || "/lp"}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: "auto", fontSize: 13 }}
        >
          Voir la page publique ↗
        </a>
        {savedAt ? (
          <Badge variant="secondary">Enregistré {savedAt}</Badge>
        ) : null}
      </div>

      <Card style={{ padding: 16, display: "grid", gap: 12 }}>
        <strong>Réglages</strong>
        {SETTINGS_FIELDS.map((f) =>
          f.image ? (
            <ImageField
              key={f.key}
              label={f.label}
              value={String(settings[f.key] ?? "")}
              onChange={(url) => setSettings((s) => ({ ...s, [f.key]: url }))}
            />
          ) : (
            <div key={f.key} style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.7 }}>{f.label}</label>
              <Input
                value={String(settings[f.key] ?? "")}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSettings((s) => ({ ...s, [f.key]: e.target.value }))
                }
              />
            </div>
          ),
        )}
        <div>
          <Button onClick={() => void saveSettings()}>
            Enregistrer les réglages
          </Button>
        </div>
      </Card>

      {loading ? (
        <Card style={{ padding: 16 }}>Chargement…</Card>
      ) : (
        sections.map((s, i) => (
          <Card key={s.id} style={{ padding: 16, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Badge>{s.kind}</Badge>
              <label
                style={{
                  fontSize: 13,
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    const next = { ...s, enabled: e.target.checked };
                    setSections((prev) =>
                      prev.map((x) => (x.id === s.id ? next : x)),
                    );
                    void saveSection(next);
                  }}
                />
                Visible
              </label>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <Button variant="outline" onClick={() => void move(i, -1)}>
                  ↑
                </Button>
                <Button variant="outline" onClick={() => void move(i, 1)}>
                  ↓
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void removeSection(s.id)}
                >
                  Supprimer
                </Button>
              </div>
            </div>
            {Object.entries(s.content).map(([k, v]) => (
              <ContentField
                key={k}
                fieldKey={k}
                value={v}
                onChange={(nv) =>
                  setSections((prev) =>
                    prev.map((x) =>
                      x.id === s.id
                        ? { ...x, content: { ...x.content, [k]: nv } }
                        : x,
                    ),
                  )
                }
              />
            ))}
            <div>
              <Button
                onClick={() =>
                  void saveSection(
                    sections.find((x) => x.id === s.id) || s,
                  )
                }
              >
                Enregistrer la section
              </Button>
            </div>
          </Card>
        ))
      )}

      <Card style={{ padding: 16, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 13 }}>Ajouter une section :</span>
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value)}
          style={{
            background: "transparent",
            border: "1px solid rgba(127,127,127,.3)",
            borderRadius: 8,
            padding: "6px 10px",
            color: "inherit",
          }}
        >
          {[...new Set([...kinds, newKind])].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <Input
          value={newKind}
          placeholder="kind custom marque…"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setNewKind(e.target.value)
          }
          style={{ maxWidth: 220 }}
        />
        <Button onClick={() => void addSection()}>Ajouter</Button>
      </Card>
    </div>
  );
}
