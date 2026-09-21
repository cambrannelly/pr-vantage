import { NextResponse } from "next/server";
import { attachHeadContents, getPullDetail } from "@/lib/github";
import { clearCachedSummary, generateSummary, readCachedSummary } from "@/lib/summarize";
import { errorResponse } from "@/lib/api-errors";
import type { Summary } from "@/lib/schema";

export const maxDuration = 300;

/**
 * Cached: plain JSON. Otherwise: newline-delimited JSON, one `{partial}` per snapshot
 * while the model streams, then `{summary, cached:false}` or `{error}`.
 */
export async function POST(req: Request) {
  const { owner, repo, number, force, headSha } = (await req.json()) as {
    owner: string; repo: string; number: number; force?: boolean; headSha?: string;
  };
  try {
    // The page just rendered this head, so trust it for the cache probe and skip a GitHub round trip.
    if (!force && headSha) {
      const cached = await readCachedSummary(owner, repo, Number(number), headSha);
      if (cached) return NextResponse.json({ summary: cached, cached: true });
    }
    const detail = await getPullDetail(owner, repo, Number(number));
    if (force) {
      await clearCachedSummary(owner, repo, detail.number, detail.headSha);
    } else {
      const cached = await readCachedSummary(owner, repo, detail.number, detail.headSha);
      if (cached) return NextResponse.json({ summary: cached, cached: true });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          await attachHeadContents(detail);
          const summary = await generateSummary(owner, repo, detail, undefined, (partial: Summary) => send({ partial }));
          send({ summary, cached: false });
        } catch (err) {
          const res = errorResponse(err);
          send({ error: ((await res.json()) as { error: string }).error, status: res.status });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
