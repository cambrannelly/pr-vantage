"use client";

import { useState } from "react";
import type { ReviewEvent } from "@/lib/github";
import { Markdown } from "./Markdown";

type Existing = { author: string; state: string; body: string; submittedAt: string };

const STATE_CLS: Record<string, string> = {
  APPROVED: "tag-moss",
  CHANGES_REQUESTED: "tag-rust",
  COMMENTED: "tag-sky",
  DISMISSED: "",
};

export function ReviewPanel({ owner, repo, number, reviews, verdictHint }: {
  owner: string; repo: string; number: number; reviews: Existing[]; verdictHint?: string;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<ReviewEvent | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [posted, setPosted] = useState<Existing[]>(reviews);
  const [showExisting, setShowExisting] = useState(false);

  async function submit(event: ReviewEvent) {
    setBusy(event);
    setResult(null);
    const res = await fetch("/api/review", {
      method: "POST",
      body: JSON.stringify({ owner, repo, number, event, body }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setResult({ ok: false, text: json.error ?? "Failed" });
    setResult({ ok: true, text: `Posted ${event.toLowerCase().replace("_", " ")}.` });
    setPosted((p) => [...p, { author: "you", state: json.state, body, submittedAt: new Date().toISOString() }]);
    setBody("");
  }

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">Your review</div>
        {verdictHint && (
          <span className={`tag ${verdictHint === "looks-good" ? "tag-moss" : verdictHint === "needs-changes" ? "tag-rust" : "tag-amber"}`}>
            review: {verdictHint.replace("-", " ")}
          </span>
        )}
      </div>
      <textarea
        className="mt-3 min-h-[120px] resize-y"
        placeholder="Leave a note for the author. Required for comments and change requests."
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button className="btn btn-approve justify-center" disabled={!!busy} onClick={() => submit("APPROVE")}>
          {busy === "APPROVE" ? "…" : "Approve"}
        </button>
        <button className="btn justify-center" disabled={!!busy || !body.trim()} onClick={() => submit("COMMENT")}>
          {busy === "COMMENT" ? "…" : "Comment"}
        </button>
        <button className="btn btn-changes justify-center" disabled={!!busy || !body.trim()} onClick={() => submit("REQUEST_CHANGES")}>
          {busy === "REQUEST_CHANGES" ? "…" : "Request changes"}
        </button>
      </div>
      {result && (
        <p className={`mt-3 text-[13px] ${result.ok ? "text-moss" : "text-rust"}`}>{result.text}</p>
      )}

      {posted.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setShowExisting((v) => !v)}>
            <span className="eyebrow">Existing reviews</span>
            <span className="mono text-[11px] text-muted">
              {summarize(posted)} · {showExisting ? "hide" : "show"}
            </span>
          </button>
          {showExisting && (
          <ul className="mt-2 divide-y divide-line">
            {posted.map((r, i) => (
              <li key={i} className="py-3 text-[13px] first:pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium">{r.author}</span>
                  <span className={`tag ${STATE_CLS[r.state] ?? ""}`}>{r.state.toLowerCase().replace("_", " ")}</span>
                </div>
                {r.body && (
                  <details className="mt-1 group">
                    <summary className="mono cursor-pointer list-none text-[11px] text-muted hover:text-ink">
                      <span className="group-open:hidden">show note</span><span className="hidden group-open:inline">hide note</span>
                    </summary>
                    <div className="mt-2 max-h-[320px] overflow-y-auto pr-1"><Markdown text={r.body} /></div>
                  </details>
                )}
              </li>
            ))}
          </ul>
          )}
        </div>
      )}
    </div>
  );
}

function summarize(reviews: Existing[]) {
  const approved = reviews.filter((r) => r.state === "APPROVED").length;
  const changes = reviews.filter((r) => r.state === "CHANGES_REQUESTED").length;
  const parts = [`${reviews.length} total`];
  if (approved) parts.push(`${approved} approved`);
  if (changes) parts.push(`${changes} changes requested`);
  return parts.join(" · ");
}
