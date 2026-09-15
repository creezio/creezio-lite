"use client";

import { useState } from "react";
import type { BrandId } from "@creezio/brand-config";

export function RemoteBuildButton({ brandId }: { brandId: BrandId }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function runDryRun() {
    setBusy(true);
    setOut(null);
    setErr(null);
    try {
      const res = await fetch("/api/remote-build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, dryRun: true }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        stdout?: string;
        stderr?: string;
        error?: string;
        command?: string;
      };
      if (!res.ok || data.ok === false) {
        setErr(data.error || data.stderr || `HTTP ${res.status}`);
        setOut(
          [data.command, data.stdout, data.stderr].filter(Boolean).join("\n\n"),
        );
      } else {
        setOut(
          [data.command, data.stdout, data.stderr].filter(Boolean).join("\n\n"),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="actions">
        <button type="button" disabled={busy} onClick={runDryRun}>
          {busy ? "Dry-run…" : "Remote-build dry-run"}
        </button>
        <span className="meta">
          SSH + rsync -n uniquement — jamais de publish depuis l’UI
        </span>
      </div>
      {err ? <pre className="out">ERROR: {err}</pre> : null}
      {out ? <pre className="out">{out}</pre> : null}
    </div>
  );
}
