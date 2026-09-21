import { NextResponse } from "next/server";
import { submitReview, type ReviewEvent } from "@/lib/github";

const EVENTS: ReviewEvent[] = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];

export async function POST(req: Request) {
  const { owner, repo, number, event, body } = (await req.json()) as {
    owner: string; repo: string; number: number; event: ReviewEvent; body: string;
  };
  if (!EVENTS.includes(event)) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  if (event !== "APPROVE" && !body?.trim()) {
    return NextResponse.json({ error: "GitHub requires a body for comments and change requests." }, { status: 400 });
  }
  try {
    const result = await submitReview(owner, repo, Number(number), event, body ?? "");
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
