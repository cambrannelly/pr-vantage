import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { attachHeadContents, getPullDetail, getRepoGuidance } from "@/lib/github";
import { buildPrompt, EFFORT, MODEL, readCachedSummary } from "@/lib/summarize";

export const maxDuration = 300;

const ASK_SYSTEM = `You are a principal engineer who has already read this pull request in full. A colleague reviewing it at the architecture level is asking you questions. Answer directly and concretely, citing file paths and symbol names from the PR. If the answer is not determinable from the PR, say what is missing. Keep answers short unless asked to go deep. Use plain prose or short lists, no headers.`;

export async function POST(req: Request) {
  const { owner, repo, number, question, history } = (await req.json()) as {
    owner: string; repo: string; number: number; question: string;
    history: { role: "user" | "assistant"; content: string }[];
  };
  if (!question?.trim()) return NextResponse.json({ error: "Empty question" }, { status: 400 });
  try {
    const detail = await getPullDetail(owner, repo, Number(number));
    const [guidance, summary] = await Promise.all([
      getRepoGuidance(owner, repo, detail.baseRef),
      readCachedSummary(owner, repo, detail.number, detail.headSha),
    ]);
    await attachHeadContents(detail);

    // Stable, cacheable context first; the question varies after the breakpoint.
    const context =
      buildPrompt(detail, guidance) +
      (summary ? `\n\n# Architecture summary already shown to the reviewer\n${JSON.stringify(summary, null, 2)}` : "");

    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = [
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: question },
    ];
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: EFFORT },
      system: [
        { type: "text", text: ASK_SYSTEM },
        { type: "text", text: context, cache_control: { type: "ephemeral" } },
      ],
      messages,
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "Model declined to answer." }, { status: 502 });
    }
    const answer = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return NextResponse.json({ answer });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Anthropic API error ${err.status}: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/Could not resolve authentication/.test(message)) {
      return NextResponse.json({ error: "No Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local and restart `pnpm dev`." }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
