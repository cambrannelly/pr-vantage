"use client";

import { useEffect, useState } from "react";
import type { ChecksSummary, CheckState } from "@/lib/github";

const DOT: Record<CheckState | "none", string> = {
  failed: "bg-rust",
  running: "bg-amber animate-pulse",
  passed: "bg-moss",
  neutral: "bg-faint",
  none: "bg-faint",
};
const TAG: Record<CheckState, string> = { failed: "tag-rust", running: "tag-amber", passed: "tag-moss", neutral: "" };

function duration(a: string | null, b: string | null) {
  if (!a) return null;
  const s = Math.max(0, ((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 1000);
  return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Collapsed: one line with the roll-up. Expanded: every check with its state and a link. Polls while anything runs. */
export function ChecksPanel({ owner, repo, sha, onChange }: { owner: string; repo: string; sha: string; onChange?: (s: ChecksSummary) => void }) {
  const [data, setData] = useState<ChecksSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      try {
        const res = await fetch(`/api/checks?owner=${owner}&repo=${repo}&sha=${sha}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) { setError(json.error ?? "Failed to load checks"); return; }
        setData(json);
        setError(null);
        onChange?.(json);
        if (json.overall === "running") timer = setTimeout(load, 20_000);
      } catch {
        if (alive) timer = setTimeout(load, 30_000);
      }
    }
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // onChange is a parent callback; re-subscribing on its identity would restart polling every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, sha]);

  const summary = data
    ? data.overall === "none"
      ? "no checks"
      : [
          data.counts.failed ? `${data.counts.failed} failed` : null,
          data.counts.running ? `${data.counts.running} running` : null,
          data.counts.passed ? `${data.counts.passed} passed` : null,
          data.counts.neutral ? `${data.counts.neutral} skipped` : null,
        ].filter(Boolean).join(" · ")
    : error ?? "loading…";

  return (
    <div className="panel p-5">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((v) => !v)} disabled={!data || data.checks.length === 0}>
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[data?.overall ?? "none"]}`} />
        <span className="eyebrow">Checks</span>
        <span className={`mono min-w-0 flex-1 truncate text-[11px] ${error ? "text-rust" : "text-muted"}`}>{summary}</span>
        {data && data.checks.length > 0 && <span className="mono text-[11px] text-faint">{open ? "hide" : "show"}</span>}
      </button>
      {open && data && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {data.checks.map((c, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5 text-[13px]">
              <span className={`tag ${TAG[c.state]} w-[76px] justify-center`}>{c.detail.replace("_", " ")}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{c.name}</span>
                {c.app && <span className="mono block truncate text-[11px] text-faint">{c.app}</span>}
              </span>
              <span className="mono shrink-0 text-[11px] text-muted">{duration(c.startedAt, c.completedAt)}</span>
              {c.url && (
                <a href={c.url} target="_blank" rel="noreferrer" className="mono shrink-0 text-[11px] text-muted hover:text-amber">↗</a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
