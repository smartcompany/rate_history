import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "data", "kimchi-fx-delta.json");
    const raw = readFileSync(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    return NextResponse.json(json, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    console.error("[kimchi-fx-delta]", e);
    return NextResponse.json(
      { error: "Failed to load kimchi-fx-delta.json" },
      { status: 500 },
    );
  }
}
