import { NextResponse } from "next/server";
import {
  getConsoleAutomationEngine,
  loadAutomationsConsoleSnapshot,
} from "@/lib/automations-console";
import { AUTOMATION_TRIGGER_TYPES } from "@creezio/automations";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    ...loadAutomationsConsoleSnapshot(),
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      op?: string;
      type?: string;
      trigger?: string;
      name?: string;
      actions?: unknown[];
      orgId?: string;
      pluginId?: string;
      brandId?: string;
      payload?: Record<string, unknown>;
    };
    const engine = getConsoleAutomationEngine();
    const op = body.op || "dispatch";

    if (op === "dispatch") {
      const type = String(body.type || body.trigger || "");
      if (!(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json(
          { ok: false, error: "trigger invalide" },
          { status: 400 },
        );
      }
      const runs = await engine.dispatch({
        type: type as (typeof AUTOMATION_TRIGGER_TYPES)[number],
        orgId: body.orgId ?? "org-console",
        brandId: body.brandId ?? "console",
        pluginId: body.pluginId,
        payload: body.payload || {},
      });
      return NextResponse.json({ ok: true, runs }, { status: 201 });
    }

    return NextResponse.json({ ok: false, error: "op inconnue" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
