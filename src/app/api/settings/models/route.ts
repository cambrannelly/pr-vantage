import { NextResponse } from "next/server";
import { listModels } from "@/lib/llm";
import { keyFor, PROVIDERS, readSettings, type Provider } from "@/lib/settings";
import { errorResponse } from "@/lib/api-errors";

/** List models for a provider using a key typed into the form (unsaved) or the saved/env one. */
export async function POST(req: Request) {
  const { provider, apiKey, baseUrl } = (await req.json()) as { provider: Provider; apiKey?: string; baseUrl?: string };
  if (!PROVIDERS.includes(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  const key = apiKey?.trim() || keyFor(await readSettings(), provider).value;
  if (!key) return NextResponse.json({ error: "Enter an API key first." }, { status: 400 });
  if (provider === "custom" && !baseUrl?.trim()) return NextResponse.json({ error: "Enter the base URL first." }, { status: 400 });
  try {
    const models = await listModels(provider, key, baseUrl?.trim() || null);
    return NextResponse.json({ models });
  } catch (err) {
    return errorResponse(err);
  }
}
