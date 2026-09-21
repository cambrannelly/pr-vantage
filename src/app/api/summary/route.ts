import { NextResponse } from "next/server";
import { attachHeadContents, getPullDetail } from "@/lib/github";
import { clearCachedSummary, generateSummary, readCachedSummary } from "@/lib/summarize";
import { errorResponse } from "@/lib/api-errors";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { owner, repo, number, force } = (await req.json()) as {
    owner: string; repo: string; number: number; force?: boolean;
  };
  try {
    const detail = await getPullDetail(owner, repo, Number(number));
    if (force) {
      await clearCachedSummary(owner, repo, detail.number, detail.headSha);
    } else {
      const cached = await readCachedSummary(owner, repo, detail.number, detail.headSha);
      if (cached) return NextResponse.json({ summary: cached, cached: true });
    }
    await attachHeadContents(detail);
    const summary = await generateSummary(owner, repo, detail);
    return NextResponse.json({ summary, cached: false });
  } catch (err) {
    return errorResponse(err);
  }
}
