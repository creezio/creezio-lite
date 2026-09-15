import { NextResponse } from "next/server";
import {
  listFactorySessionsSnapshot,
  runFactoryDemo,
} from "@/lib/plugin-factory-demo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    ...listFactorySessionsSnapshot(),
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      text?: string;
      name?: string;
      approve?: boolean;
      materialize?: boolean;
    };
    if (!body.text?.trim()) {
      return NextResponse.json(
        { ok: false, error: "text requis" },
        { status: 400 },
      );
    }
    const result = await runFactoryDemo({
      text: body.text,
      name: body.name,
      approve: body.approve,
      materialize: body.materialize,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
