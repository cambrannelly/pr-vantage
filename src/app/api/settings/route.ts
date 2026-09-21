import { NextResponse } from "next/server";
import { llmConfig } from "@/lib/llm";
import { codexCredential } from "@/lib/codex-auth";
import { keyFor, keyHint, PROVIDER_META, PROVIDERS, readSettings, updateSettings, type Effort, type OpenAIAuth, type Provider } from "@/lib/settings";

/** Settings with keys masked to their last four characters. */
async function view() {
  const s = await readSettings();
  const cfg = await llmConfig();
  const c = await codexCredential().catch(() => null);
  return {
    provider: cfg.provider,
    model: cfg.model,
    effort: cfg.effort,
    openaiAuth: s.openaiAuth ?? "key",
    keys: Object.fromEntries(
      PROVIDERS.map((p) => {
        const k = keyFor(s, p);
        return [p, k ? { set: true, hint: keyHint(k) } : { set: false, hint: null }];
      }),
    ),
    codex: c ? { signedIn: true, email: c.email ?? null, plan: c.planType ?? null } : { signedIn: false, email: null, plan: null },
    providers: PROVIDER_META,
  };
}

export async function GET() {
  return NextResponse.json(await view(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as {
    provider?: Provider; model?: string; effort?: Effort; openaiAuth?: OpenAIAuth;
    keys?: Partial<Record<Provider, string | null>>;
  };
  if (body.provider && !PROVIDERS.includes(body.provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (body.effort && !["low", "medium", "high"].includes(body.effort)) return NextResponse.json({ error: "Unknown effort" }, { status: 400 });
  if (body.openaiAuth && !["key", "chatgpt"].includes(body.openaiAuth)) return NextResponse.json({ error: "Unknown auth mode" }, { status: 400 });
  await updateSettings(body);
  return NextResponse.json(await view());
}
