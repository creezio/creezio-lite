import { NextResponse } from "next/server";
import { loadKitSnapshot } from "@/lib/kit";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = loadKitSnapshot();
  return NextResponse.json({
    generatedAt: snap.inventory.generatedAt,
    kitRoot: snap.inventory.kitRoot,
    rootVersion: snap.inventory.rootVersion,
    architectureVersion: snap.architectureVersion,
    packages: snap.inventory.packages.map((p) => ({
      name: p.name,
      version: p.version,
      layer: p.layer,
      summary: p.summary,
      dependsOn: p.dependsOn,
      local: p.local,
    })),
    published: snap.published,
    gates: snap.gates.map((g) => ({
      id: g.id,
      brandId: g.brandId,
      label: g.label,
      doc: g.doc,
      order: g.order,
      githubUrl: `https://github.com/creezio/creezio/blob/main/${g.doc}`,
    })),
    docs: snap.docs,
  });
}
