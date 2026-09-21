import { NextResponse } from "next/server";
import { prewarmStatus, tick } from "@/lib/prewarm";

export async function GET() {
  return NextResponse.json(prewarmStatus());
}

/** Poll now instead of waiting for the next interval. */
export async function POST() {
  await tick();
  return NextResponse.json(prewarmStatus());
}
