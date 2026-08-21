import { NextResponse } from "next/server";
import { buildBrief, renderBrief } from "@/lib/brief";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const brief = await buildBrief();
  const wantsText = new URL(req.url).searchParams.get("format") === "text";

  if (wantsText) {
    return new NextResponse(renderBrief(brief), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json(brief);
}
