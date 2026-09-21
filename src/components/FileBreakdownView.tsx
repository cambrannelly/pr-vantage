"use client";

import { useEffect, useState } from "react";
import type { FileBreakdown } from "@/lib/filebreakdown";
import { DiffView } from "./DiffView";
import { Rich } from "./Rich";

const KIND: Record<string, string> = {
  behavior: "tag-amber",
  contract: "tag-rust",
  structure: "tag-sky",
  test: "tag-moss",
  mechanical: "",
};

export function FileBreakdownView({ owner, repo, number, path, hunks }: {
  owner: string; repo: string; number: number; path: string; hunks: string[];
}) {
  const [data, setData] = useState<FileBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/file", { method: "POST", body: JSON.stringify({ owner, repo, number, path, force }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json.breakdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/file", { method: "POST", body: JSON.stringify({ owner, repo, number, path }) })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed");
        if (alive) setData(json.breakdown);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [owner, repo, number, path]);

  const assigned = new Set(data?.groups.flatMap((g) => g.hunks) ?? []);
  const orphanHunks = hunks.map((_, i) => i + 1).filter((n) => !assigned.has(n));

  return (
    <div className="space-y-8">
      {loading && (
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
            Reading this file…
          </div>
          <div className="mt-3 space-y-2"><div className="shimmer h-5 w-3/4" /><div className="shimmer h-4 w-1/2" /></div>
          <div className="shimmer mt-6 h-40" />
        </div>
      )}

      {error && (
        <div className="panel p-5">
          <div className="eyebrow !text-rust">Breakdown unavailable</div>
          <p className="mono mt-2 whitespace-pre-wrap text-ink-2">{error}</p>
          <button className="btn mt-4" onClick={() => load()}>Retry</button>
        </div>
      )}

      {data && !loading && (
        <>
          <p className="display max-w-4xl text-[22px] leading-[1.3]"><Rich text={data.purpose} /></p>

          <ol className="space-y-6">
            {data.groups.map((g, i) => (
              <li key={i} className="reveal" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-start gap-4">
                  <span className="display-italic w-6 shrink-0 text-[22px] leading-none text-amber">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="display text-[19px] leading-tight">{g.title}</h2>
                      <span className={`tag ${KIND[g.kind]}`}>{g.kind}</span>
                      <span className="mono text-[11px] text-faint">{g.hunks.length} hunk{g.hunks.length === 1 ? "" : "s"}</span>
                    </div>
                    <p className="mt-2 text-ink-2"><Rich text={g.what} /></p>
                    <p className="mt-1 text-[14px] text-muted"><span className="eyebrow !text-[10px]">why </span><Rich text={g.why} /></p>
                    {g.hunks.length > 0 && (
                      <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-bg">
                        {g.hunks.map((n) => hunks[n - 1] ? <DiffView key={n} patch={hunks[n - 1]} /> : null)}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {orphanHunks.length > 0 && (
            <div className="rounded-lg border border-dashed border-line p-4">
              <div className="eyebrow">Hunks not covered above</div>
              <div className="mt-2 divide-y divide-line rounded-lg border border-line bg-bg">
                {orphanHunks.map((n) => <DiffView key={n} patch={hunks[n - 1]} />)}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 border-t border-line pt-4">
            <button className="mono text-[11px] text-muted hover:text-ink" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "hide full diff" : "show full diff in order"}
            </button>
            <button className="mono text-[11px] text-muted hover:text-ink" onClick={() => load(true)}>regenerate</button>
          </div>
          {showAll && (
            <div className="divide-y divide-line rounded-lg border border-line bg-bg">
              {hunks.map((h, i) => <DiffView key={i} patch={h} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
