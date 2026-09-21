import { NextResponse } from "next/server";
import { LlmError } from "./llm";

export function errorResponse(err: unknown) {
  if (err instanceof LlmError) {
    return NextResponse.json({ error: err.message, kind: err.kind }, { status: err.status ?? 500 });
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: /credentials|API key/i.test(message) ? 401 : 500 });
}
