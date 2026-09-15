import { NextResponse } from "next/server";
import { fetchAllBrandFeeds } from "@creezio/desktop-tooling";

export const dynamic = "force-dynamic";

export async function GET() {
  const feeds = fetchAllBrandFeeds();
  return NextResponse.json({ generatedAt: new Date().toISOString(), feeds });
}
