import { NextResponse } from "next/server";
import { getChecks } from "@/lib/github";
import { errorResponse } from "@/lib/api-errors";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const owner = u.searchParams.get("owner"), repo = u.searchParams.get("repo"), sha = u.searchParams.get("sha");
  if (!owner || !repo || !sha) return NextResponse.json({ error: "owner, repo, sha required" }, { status: 400 });
  try {
    return NextResponse.json(await getChecks(owner, repo, sha), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
