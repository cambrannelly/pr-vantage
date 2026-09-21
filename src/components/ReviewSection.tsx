"use client";

import { useEffect, useState } from "react";
import type { Review } from "@/lib/schema";
import { Rich } from "./Rich";
import { FileLink } from "./SummaryView";

const SEVERITY: Record<string, string> = { high: "tag-rust", medium: "tag-amber", low: "tag-sky" };
const VERDICT: Record<string, { cls: string; label: string }> = {
  "looks-good": { cls: "tag-moss", label: "looks good" },
  "needs-discussion": { cls: "tag-amber", label: "needs discussion" },
  "needs-changes": { cls: "tag-rust", label: "needs changes" },
};

export function ReviewSection({ owner, repo, number, onVerdict, onTraceFiles }: {
  owner: string; repo: string; number: number;
  onVerdict: (v: Review["verdict"] | null) => void;
  onTraceFiles: (files: string[] | null) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [peeking, setPeeking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRisk, setOpenRisk] = useState<number | null>(null);

  // Peek at the cache only. The model never runs from here without a click.
  useEffect(() => {
    let alive = true;
    fetch("/api/critique", { method: "POST", body: JSON.stringify({ owner, repo, number, cacheOnly: true }) })
      .then((r) => r.json())
      .then((json) => { if (alive && json.review) { setReview(json.review); onVerdict(json.review.verdict); } })
      .catch(() => {})
      .finally(() => { if (alive) setPeeking(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, number]);

  async function run(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/critique", { method: "POST", body: JSON.stringify({ owner, repo, number, force }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Review failed");
      setReview(json.review);
      onVerdict(json.review.verdict);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleRisk(i: number, files: string[]) {
    const next = openRisk === i ? null : i;
    setOpenRisk(next);
    onTraceFiles(next === null ? null : files);
  }

  if (peeking) return null;

  return (
    <section className="reveal" style={{ animationDelay: "200ms" }}>
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Risks and what to fix</div>
        {review && (
          <button className="mono text-[11px] text-muted hover:text-ink" onClick={() => run(true)} disabled={loading}>
            re-run review
          </button>
        )}
      </div>

      {!review && !loading && (
        <div className="panel mt-3 flex flex-wrap items-center justify-between gap-4 border-dashed p-5">
          <div className="min-w-0">
            <p className="text-ink">The summary above describes. This pass judges.</p>
            <p className="mt-1 text-[14px] text-muted">
              Checks new dependencies, bypassed layers, contract and auth boundary changes, duplicated logic, and
              repo conventions. Each finding comes with a concrete fix. Runs only when you ask.
            </p>
            {error && <p className="mono mt-2 text-[12px] text-rust">{error}</p>}
          </div>
          <button className="btn btn-primary shrink-0" onClick={() => run()}>Run review</button>
        </div>
      )}

      {loading && (
        <div className="panel mt-3 p-5">
          <div className="eyebrow flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
            Judging the change…
          </div>
          <div className="mt-3 space-y-2"><div className="shimmer h-4 w-1/2" /><div className="shimmer h-4" /><div className="shimmer h-4 w-3/4" /></div>
        </div>
      )}

      {review && !loading && (
        <div className="mt-3 space-y-3">
          <div className="panel flex flex-wrap items-start gap-3 p-4">
            <span className={`tag mt-0.5 ${VERDICT[review.verdict].cls}`}>{VERDICT[review.verdict].label}</span>
            <p className="min-w-0 flex-1 text-ink-2"><Rich text={review.verdictReason} /></p>
          </div>

          {review.risks.length === 0 && <p className="px-1 text-muted">No risks worth raising.</p>}

          <ul className="space-y-2">
            {review.risks.map((r, i) => {
              const open = openRisk === i;
              return (
                <li
                  key={i}
                  className={`panel cursor-pointer p-4 transition ${open ? "!border-amber/60" : "hover:!border-line-2"}`}
                  onClick={() => toggleRisk(i, r.files)}
                >
                  <div className="flex items-start gap-2">
                    <span className={`tag mt-0.5 ${SEVERITY[r.severity]}`}>{r.severity}</span>
                    <span className="min-w-0 flex-1 font-semibold leading-snug">{r.title}</span>
                    <span className="mono mt-0.5 text-[11px] text-faint">{open ? "hide fix" : "show fix"}</span>
                  </div>
                  <p className="mt-2 text-[14px] text-ink-2"><Rich text={r.detail} /></p>
                  {open && (
                    <div className="mt-3 rounded-lg border border-moss/30 bg-moss/5 p-3">
                      <div className="eyebrow !text-moss">Fix</div>
                      <p className="mt-1 text-[14px] text-ink-2"><Rich text={r.fix} /></p>
                    </div>
                  )}
                  {r.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
                      {r.files.map((f) => <FileLink key={f} owner={owner} repo={repo} number={number} path={f} />)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {review.nits.length > 0 && (
            <div className="px-1">
              <div className="eyebrow">Nits</div>
              <ul className="mt-2 space-y-1 text-[14px] text-muted">
                {review.nits.map((n, i) => <li key={i} className="flex gap-2"><span className="text-faint">·</span><Rich text={n} /></li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
