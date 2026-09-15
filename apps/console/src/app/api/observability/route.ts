import { NextResponse } from "next/server";
import {
  getConsoleObservabilityStore,
  loadObservabilityConsoleSnapshot,
} from "@/lib/observability-console";
import { OBSERVABILITY_EVENT_KINDS } from "@creezio/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    ...loadObservabilityConsoleSnapshot(),
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      kind?: string;
      action?: string;
      orgId?: string;
      userId?: string;
      brandId?: string;
      pluginId?: string;
      meta?: Record<string, unknown>;
    };
    if (
      !body.kind ||
      !(OBSERVABILITY_EVENT_KINDS as readonly string[]).includes(body.kind)
    ) {
      return NextResponse.json(
        { ok: false, error: "kind invalide" },
        { status: 400 },
      );
    }
    if (!body.action?.trim()) {
      return NextResponse.json(
        { ok: false, error: "action requise" },
        { status: 400 },
      );
    }
    const store = getConsoleObservabilityStore();
    const event = store.record({
      kind: body.kind as (typeof OBSERVABILITY_EVENT_KINDS)[number],
      action: body.action,
      orgId: body.orgId ?? null,
      userId: body.userId ?? null,
      brandId: body.brandId ?? null,
      pluginId: body.pluginId ?? null,
      meta: body.meta || {},
    });
    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
