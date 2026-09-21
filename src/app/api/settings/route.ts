import { NextResponse } from "next/server";
import { llmConfig } from "@/lib/llm";
import { keyFor, keyHint, PROVIDER_META, PROVIDERS, readSettings, updateSettings, type Effort, type Provider } from "@/lib/settings";

/** Settings with keys masked to their last four characters. */
async function view() {
  const s = await readSettings();
  const cfg = await llmConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    effort: cfg.effort,
    customBaseUrl: cfg.provider === "custom" ? cfg.baseUrl : s.customBaseUrl ?? process.env.PR_VANTAGE_LLM_BASE_URL ?? null,
    keys: Object.fromEntries(
      PROVIDERS.map((p) => {
        const k = keyFor(s, p);
        return [p, k.value ? { set: true, hint: keyHint(k.value), source: k.source } : { set: false, hint: null, source: null }];
      }),
    ),
    providers: PROVIDER_META,
  };
}

export async function GET() {
  return NextResponse.json(await view(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as {
    provider?: Provider; model?: string; effort?: Effort; customBaseUrl?: string;
    keys?: Partial<Record<Provider, string | null>>;
  };
  if (body.provider && !PROVIDERS.includes(body.provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (body.effort && !["low", "medium", "high"].includes(body.effort)) return NextResponse.json({ error: "Unknown effort" }, { status: 400 });
  await updateSettings(body);
  return NextResponse.json(await view());
}
