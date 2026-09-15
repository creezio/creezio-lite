import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  type BrandId,
  getManifest,
  listBrandIds,
} from "@creezio/brand-config";

export const dynamic = "force-dynamic";

function resolveRemoteBuildScript(): string {
  const candidates = [
    path.resolve(
      process.cwd(),
      "packages/desktop-tooling/scripts/remote-build-win.sh",
    ),
    path.resolve(
      process.cwd(),
      "../../packages/desktop-tooling/scripts/remote-build-win.sh",
    ),
    "/opt/docker/creezio/packages/desktop-tooling/scripts/remote-build-win.sh",
  ];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) {
    throw new Error(
      `remote-build-win.sh introuvable (cwd=${process.cwd()})`,
    );
  }
  return hit;
}

/**
 * Wrapper remote-build.
 * Par défaut : dry-run uniquement.
 * `dryRun:false` exige CREEZIO_CONSOLE_ALLOW_BUILD=1 (ops explicite).
 */
export async function POST(req: NextRequest) {
  let body: { brandId?: string; dryRun?: boolean; appRoot?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const brandId = (body.brandId || "").toLowerCase() as BrandId;
  if (!listBrandIds().includes(brandId)) {
    return NextResponse.json(
      { error: `marque inconnue: ${body.brandId}` },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun !== false ? true : false;
  if (!dryRun && process.env.CREEZIO_CONSOLE_ALLOW_BUILD !== "1") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Build réel refusé. Utilisez dryRun:true, ou exportez CREEZIO_CONSOLE_ALLOW_BUILD=1 + CLI documentée.",
      },
      { status: 403 },
    );
  }

  const manifest = getManifest(brandId);
  const appRoot = body.appRoot || manifest.publish.defaultAppRoot;
  let script: string;
  try {
    script = resolveRemoteBuildScript();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const args = [`--brand=${brandId}`, `--app-root=${appRoot}`];
  if (dryRun) args.push("--dry-run");

  const command = `bash ${script} ${args.join(" ")}`;
  const res = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    timeout: dryRun ? 120_000 : 3_600_000,
    env: { ...process.env, CREEZIO_BRAND: brandId },
  });

  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  const ok = res.status === 0;

  return NextResponse.json(
    {
      ok,
      dryRun,
      brandId,
      appRoot,
      command,
      status: res.status,
      stdout: stdout.slice(-8000),
      stderr: stderr.slice(-4000),
      error: ok
        ? null
        : stderr || `exit ${res.status}${res.error ? `: ${res.error.message}` : ""}`,
    },
    { status: ok ? 200 : 500 },
  );
}
