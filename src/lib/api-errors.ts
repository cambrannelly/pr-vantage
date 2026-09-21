import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export function errorResponse(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) {
    return NextResponse.json({ error: "Anthropic auth failed. Check ANTHROPIC_API_KEY in .env.local and restart the dev server." }, { status: 401 });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return NextResponse.json({ error: "Anthropic rate limit hit. Try again shortly." }, { status: 429 });
  }
  if (err instanceof Anthropic.APIError) {
    return NextResponse.json({ error: `Anthropic API error ${err.status}: ${err.message}` }, { status: 502 });
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: /credentials/.test(message) ? 401 : 500 });
}
