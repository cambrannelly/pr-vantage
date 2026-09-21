import { NextResponse } from "next/server";
import { attachHeadContents, getPullDetail } from "@/lib/github";
import { clearCachedReview, generateReview, readCachedReview, readCachedSummary } from "@/lib/summarize";
import { errorResponse } from "@/lib/api-errors";

export const maxDuration = 300;

/** The opinionated pass: risks and what to fix. Only runs on explicit request; cacheOnly just peeks. */
export async function POST(req: Request) {
  const { owner, repo, number, force, cacheOnly } = (await req.json()) as {
    owner: string; repo: string; number: number; force?: boolean; cacheOnly?: boolean;
  };
  try {
    const detail = await getPullDetail(owner, repo, Number(number));
    if (force) {
      await clearCachedReview(owner, repo, detail.number, detail.headSha);
    } else {
      const cached = await readCachedReview(owner, repo, detail.number, detail.headSha);
      if (cached) return NextResponse.json({ review: cached, cached: true });
      if (cacheOnly) return NextResponse.json({ review: null, cached: false });
    }
    const summary = await readCachedSummary(owner, repo, detail.number, detail.headSha);
    await attachHeadContents(detail);
    const review = await generateReview(owner, repo, detail, summary);
    return NextResponse.json({ review, cached: false });
  } catch (err) {
    return errorResponse(err);
  }
}
