import { NextResponse } from "next/server";
import { getMergeInfo, mergePull, type MergeMethod } from "@/lib/github";
import { errorResponse } from "@/lib/api-errors";

const METHODS: MergeMethod[] = ["merge", "squash", "rebase"];

export async function GET(req: Request) {
  const u = new URL(req.url);
  const owner = u.searchParams.get("owner"), repo = u.searchParams.get("repo"), number = Number(u.searchParams.get("number"));
  if (!owner || !repo || !number) return NextResponse.json({ error: "owner, repo, number required" }, { status: 400 });
  try {
    return NextResponse.json(await getMergeInfo(owner, repo, number), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const { owner, repo, number, method, sha } = (await req.json()) as {
    owner: string; repo: string; number: number; method: MergeMethod; sha: string;
  };
  if (!METHODS.includes(method)) return NextResponse.json({ error: "Invalid merge method" }, { status: 400 });
  if (!sha) return NextResponse.json({ error: "Head SHA required" }, { status: 400 });
  try {
    return NextResponse.json(await mergePull(owner, repo, Number(number), method, sha));
  } catch (err) {
    // GitHub explains refusals well (405 not mergeable, 409 head moved); pass its message through.
    const e = err as { status?: number; message?: string };
    if (e.status) return NextResponse.json({ error: e.message ?? "Merge refused" }, { status: e.status });
    return errorResponse(err);
  }
}
