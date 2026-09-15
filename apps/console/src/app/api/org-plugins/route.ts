import { NextResponse } from "next/server";
import {
  getOrgPluginRegistry,
  loadOrgPluginRegistrySnapshot,
} from "@/lib/org-plugin-registry";
import type { OrgPluginRecord, OrgPluginVisibility } from "@creezio/propagation";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(loadOrgPluginRegistrySnapshot());
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action?: string;
    plugin?: Partial<OrgPluginRecord> & {
      pluginId?: string;
      brandId?: string;
      orgId?: string;
      createdByUserId?: string;
      name?: string;
      version?: string;
    };
    pluginId?: string;
  };
  const reg = getOrgPluginRegistry();
  const action = body.action || "upsert";

  try {
    if (action === "upsert") {
      const p = body.plugin;
      if (!p?.pluginId || !p.brandId || !p.orgId || !p.name) {
        return NextResponse.json(
          { ok: false, error: "plugin_fields_required" },
          { status: 400 },
        );
      }
      const now = new Date().toISOString();
      const record = reg.upsert({
        pluginId: p.pluginId,
        brandId: p.brandId,
        orgId: p.orgId,
        createdByUserId: p.createdByUserId || "console",
        name: p.name,
        version: p.version || "0.1.0",
        visibility: (p.visibility as OrgPluginVisibility) || "owner_only",
        deployedAt: p.deployedAt || ["L3-org"],
        createdAt: p.createdAt || now,
        notes: p.notes,
        n8nTag: p.n8nTag,
        minKitVersion: p.minKitVersion,
      });
      return NextResponse.json({ ok: true, plugin: record });
    }
    if (action === "submitForOrgReview" && body.pluginId) {
      return NextResponse.json({
        ok: true,
        plugin: reg.submitForOrgReview(body.pluginId),
      });
    }
    if (action === "proposeVerticalPromotion" && body.pluginId) {
      return NextResponse.json({
        ok: true,
        plugin: reg.proposeVerticalPromotion(body.pluginId),
      });
    }
    if (action === "proposeKitPromotion" && body.pluginId) {
      return NextResponse.json({
        ok: true,
        plugin: reg.proposeKitPromotion(body.pluginId),
      });
    }
    return NextResponse.json(
      { ok: false, error: "unknown_action" },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "error",
      },
      { status: 400 },
    );
  }
}
