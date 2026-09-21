import { NextResponse } from "next/server";
import { getPullDetail } from "@/lib/github";
import { generateFileBreakdown } from "@/lib/filebreakdown";
import { errorResponse } from "@/lib/api-errors";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { owner, repo, number, path, force } = (await req.json()) as {
    owner: string; repo: string; number: number; path: string; force?: boolean;
  };
  try {
    const pr = await getPullDetail(owner, repo, Number(number));
    const file = pr.files.find((f) => f.path === path);
    if (!file) return NextResponse.json({ error: `File not in this PR: ${path}` }, { status: 404 });
    const breakdown = await generateFileBreakdown(owner, repo, pr, file, force);
    return NextResponse.json({ breakdown });
  } catch (err) {
    return errorResponse(err);
  }
}
