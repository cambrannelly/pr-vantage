"use client";

import { useEffect, useState } from "react";
import type { MergeInfo, MergeMethod } from "@/lib/github";

const LABEL: Record<MergeMethod, string> = { squash: "Squash and merge", merge: "Create a merge commit", rebase: "Rebase and merge" };

const STATE_NOTE: Record<string, string> = {
  blocked: "Blocked by branch protection: required reviews or checks are not satisfied.",
  behind: "Head branch is behind the base branch and must be updated first.",
  dirty: "Merge conflicts with the base branch.",
  draft: "Draft pull requests cannot be merged.",
  unstable: "Merging is allowed, but a non-required check is failing.",
  unknown: "GitHub is still computing mergeability.",
  has_hooks: "Pre-receive hooks will run on merge.",
};

/** Merge with whichever strategies the repo allows. Two clicks: pick, then confirm. Refuses if the head moved. */
export function MergePanel({ owner, repo, number, headSha }: { owner: string; repo: string; number: number; headSha: string }) {
  const [info, setInfo] = useState<MergeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let tries = 0;
    async function load() {
      const res = await fetch(`/api/merge?owner=${owner}&repo=${repo}&number=${number}`, { cache: "no-store" });
      const json = await res.json();
      if (!alive) return;
      if (!res.ok) { setError(json.error ?? "Failed to load merge state"); return; }
      setInfo(json);
      setMethod((m) => m ?? json.allowed[0] ?? null);
      // mergeable is null until GitHub finishes its background computation; ask again briefly.
      if (json.mergeable === null && tries++ < 4) setTimeout(load, 2500);
    }
    load().catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [owner, repo, number]);

  async function merge() {
    if (!method || !info) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/merge", { method: "POST", body: JSON.stringify({ owner, repo, number, method, sha: headSha }) });
    const json = await res.json();
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return setError(json.error ?? "Merge failed");
    setDone(json.sha);
    setInfo({ ...info, merged: true });
  }

  const headMoved = info ? info.headSha !== headSha : false;
  // "blocked" stays clickable: admins can bypass protection, and GitHub returns a clear refusal if not.
  const hardStop = !info || info.merged || info.draft || info.mergeable === false || ["dirty", "behind", "unknown", "draft"].includes(info.state);
  const canMerge = !hardStop && !headMoved && info.allowed.length > 0;
  const note = info ? STATE_NOTE[info.state] : null;
  const warn = info ? ["blocked", "dirty", "behind", "draft"].includes(info.state) || info.mergeable === false : false;

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow">Merge</div>
        {info && (
          <span className="mono text-[11px] text-muted">
            into <span className="text-ink-2">{info.baseRef}</span>
            {info.deleteBranchOnMerge && " · deletes branch"}
          </span>
        )}
      </div>

      {!info && !error && <div className="shimmer mt-3 h-9" />}

      {info?.merged && (
        <p className="mt-3 text-[13px] text-moss">Merged{done ? ` as ${done.slice(0, 7)}` : ""}.</p>
      )}

      {info && !info.merged && (
        <>
          {headMoved && (
            <p className="mt-3 text-[13px] text-amber">New commits were pushed since this page loaded. Reload before merging.</p>
          )}
          {!headMoved && note && (
            <p className={`mt-3 text-[13px] ${warn ? "text-rust" : "text-muted"}`}>{note}</p>
          )}
          {info.allowed.length === 0 && (
            <p className="mt-3 text-[13px] text-muted">This repository allows no merge strategy through the API.</p>
          )}

          {info.allowed.length > 0 && (
            <div className="mt-3 flex gap-2">
              {info.allowed.length > 1 && (
                <select
                  aria-label="Merge strategy"
                  value={method ?? ""}
                  onChange={(e) => { setMethod(e.target.value as MergeMethod); setConfirming(false); }}
                  disabled={busy}
                  className="!w-auto flex-1 !text-[13px]"
                >
                  {info.allowed.map((m) => <option key={m} value={m}>{LABEL[m]}</option>)}
                </select>
              )}
              {!confirming ? (
                <button
                  className={`btn btn-approve justify-center ${info.allowed.length > 1 ? "" : "w-full"}`}
                  disabled={!canMerge || busy}
                  onClick={() => setConfirming(true)}
                >
                  {info.allowed.length > 1 ? "Merge" : LABEL[info.allowed[0]]}
                </button>
              ) : (
                <button className="btn btn-approve justify-center !bg-moss-soft" disabled={busy} onClick={merge}>
                  {busy ? "Merging…" : `Confirm: ${method ? LABEL[method].toLowerCase() : "merge"}`}
                </button>
              )}
            </div>
          )}
          {confirming && !busy && (
            <button className="mono mt-2 text-[11px] text-muted hover:text-ink" onClick={() => setConfirming(false)}>cancel</button>
          )}
        </>
      )}

      {error && <p className="mt-3 text-[13px] text-rust">{error}</p>}
    </div>
  );
}
