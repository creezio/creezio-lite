import { NextRequest, NextResponse } from "next/server";
import { type BrandId, listBrandIds } from "@creezio/brand-config";
import { collectDesktopBuildStatus } from "@creezio/desktop-tooling";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const brand = (req.nextUrl.searchParams.get("brand") || "").toLowerCase();
  const remote = req.nextUrl.searchParams.get("remote") === "1";
  const ids = listBrandIds();
  if (brand) {
    if (!ids.includes(brand as BrandId)) {
      return NextResponse.json({ error: `marque inconnue: ${brand}` }, { status: 400 });
    }
    const status = collectDesktopBuildStatus({
      brandId: brand as BrandId,
      remote,
    });
    return NextResponse.json(status);
  }
  const all = ids.map((brandId) =>
    collectDesktopBuildStatus({ brandId, remote }),
  );
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    brands: all,
  });
}
