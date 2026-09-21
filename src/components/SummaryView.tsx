"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Summary } from "@/lib/schema";
import type { ChangedFile } from "@/lib/github";
import { ArchMap } from "./ArchMap";
import { DiffView } from "./DiffView";
import { ReviewPanel } from "./ReviewPanel";
import { AskPanel } from "./AskPanel";
import { Rich } from "./Rich";
import { ReviewSection } from "./ReviewSection";
import Link from "next/link";
import { fileHref } from "@/lib/links";
import type { Review } from "@/lib/schema";

type Props = {
  owner: string;
  repo: string;
  number: number;
  files: ChangedFile[];
  reviews: { author: string; state: string; body: string; submittedAt: string }[];
};

const ATTENTION: Record<string, { cls: string; label: string; weight: number }> = {
  scrutinize: { cls: "tag-rust", label: "scrutinize", weight: 0 },
  read: { cls: "tag-amber", label: "read", weight: 1 },
  skim: { cls: "", label: "skim", weight: 2 },
};

const IMPORTANCE: Record<string, string> = { high: "tag-amber", medium: "tag-sky", low: "" };

export function SummaryView({ owner, repo, number, files, reviews }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<Set<string>>(new Set());
  const [showMechanical, setShowMechanical] = useState(false);
  const [showComponents, setShowComponents] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [openChange, setOpenChange] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<Review["verdict"] | null>(null);
  const [riskFiles, setRiskFiles] = useState<string[] | null>(null);

  const fetchSummary = useCallback(async (force: boolean) => {
    const res = await fetch("/api/summary", {
      method: "POST",
      body: JSON.stringify({ owner, repo, number, force }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to summarize");
    return json as { summary: Summary; cached: boolean };
  }, [owner, repo, number]);

  useEffect(() => {
    let alive = true;
    fetchSummary(false)
      .then((json) => { if (alive) { setSummary(json.summary); setCached(json.cached); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fetchSummary]);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchSummary(force);
      setSummary(json.summary);
      setCached(json.cached);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const fileMap = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const sortedFiles = useMemo(() => {
    if (!summary) return [];
    return [...summary.files].sort((a, b) => ATTENTION[a.attention].weight - ATTENTION[b.attention].weight);
  }, [summary]);

  const selectedComponent = summary?.components.find((c) => c.id === selected) ?? null;
  const changes = summary?.changes ?? [];
  const openChangeObj = openChange !== null ? changes[openChange] : null;
  const highlightedFiles = new Set(selectedComponent?.files ?? openChangeObj?.files ?? riskFiles ?? []);
  const isTracing = !!selectedComponent || !!openChangeObj || !!riskFiles;
  const importantChanges = changes.filter((c) => c.importance !== "low");
  const mechanicalChanges = changes.filter((c) => c.importance === "low");
  const mechanicalFileCount = mechanicalChanges.reduce((n, c) => n + c.files.length, 0);
  const attentionCounts = { scrutinize: 0, read: 0, skim: 0 } as Record<string, number>;
  for (const f of summary?.files ?? []) attentionCounts[f.attention]++;
  const filesOpen = showFiles || isTracing;

  function toggleDiff(path: string) {
    setOpenDiff((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-8">
      <div className="min-w-0 space-y-9">
        {loading && <Skeleton />}

        {error && (
          <div className="panel p-5">
            <div className="eyebrow !text-rust">Summary unavailable</div>
            <p className="mono mt-2 whitespace-pre-wrap text-ink-2">{error}</p>
            <button className="btn mt-4" onClick={() => load()}>Retry</button>
          </div>
        )}

        {summary && !loading && (
          <>
            {/* ---------- Landing: the whole PR in one screen ---------- */}
            <section className="reveal">
              <div className="eyebrow">Summary</div>
              <p className="display mt-3 text-[24px] leading-[1.3] text-ink"><Rich text={summary.intent} /></p>
            </section>

            <section className="reveal" style={{ animationDelay: "60ms" }}>
              <div className="flex items-baseline justify-between">
                <div className="eyebrow">Architecture</div>
                <div className="mono text-[11px] text-faint">
                  <span className="text-moss">■</span> added&nbsp;&nbsp;
                  <span className="text-amber">■</span> modified&nbsp;&nbsp;
                  <span className="text-rust">■</span> removed&nbsp;&nbsp;
                  <span className="text-faint">▢</span> blast radius&nbsp;&nbsp;· click a node to trace it
                </div>
              </div>
              <div className="panel mt-3 p-3">
                <ArchMap summary={summary} selected={selected} onSelect={(id) => { setSelected(id); setOpenChange(null); setRiskFiles(null); }} />
              </div>
              {selectedComponent && (
                <div className="mt-3 rounded-lg border border-amber/30 bg-amber/5 p-4 reveal">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold">{selectedComponent.name}</span>
                    <span className="tag">{selectedComponent.kind}</span>
                    <span className="tag">{selectedComponent.layer}</span>
                  </div>
                  <p className="mt-2 text-ink-2"><Rich text={selectedComponent.summary} /></p>
                  {selectedComponent.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
                      {selectedComponent.files.map((f) => <FileLink key={f} owner={owner} repo={repo} number={number} path={f} />)}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="reveal" style={{ animationDelay: "80ms" }}>
              <div className="mono flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
                <span>{changes.length} change{changes.length === 1 ? "" : "s"}</span>
                <span>{summary.components.length} components</span>
                <span>{files.length} files</span>
                {attentionCounts.scrutinize > 0 && <span className="text-rust">{attentionCounts.scrutinize} to scrutinize</span>}
                {attentionCounts.read > 0 && <span className="text-amber">{attentionCounts.read} to read</span>}
                {attentionCounts.skim > 0 && <span>{attentionCounts.skim} to skim</span>}
              </div>
            </section>

            {changes.length > 0 && (
              <section className="reveal" style={{ animationDelay: "100ms" }}>
                <div className="eyebrow">What changed, in order</div>
                <ol className="mt-3 divide-y divide-line border-y border-line">
                  {importantChanges.map((c) => {
                    const idx = changes.indexOf(c);
                    const open = openChange === idx;
                    return (
                      <li key={idx} className={`transition ${open ? "bg-bg-2/60" : "hover:bg-bg-2/40"}`}>
                        <button
                          className="flex w-full items-center gap-4 px-3 py-3 text-left"
                          onClick={() => { setOpenChange(open ? null : idx); setSelected(null); setRiskFiles(null); }}
                        >
                          <span className="display-italic w-6 text-[20px] leading-none text-amber">{idx + 1}.</span>
                          <span className="display min-w-0 flex-1 text-[17px] leading-tight">{c.title}</span>
                          <span className={`tag ${IMPORTANCE[c.importance]}`}>{c.importance}</span>
                          <span className="mono w-14 text-right text-muted">{c.files.length} file{c.files.length === 1 ? "" : "s"}</span>
                          <span className="mono w-4 text-faint">{open ? "−" : "+"}</span>
                        </button>
                        {open && (
                          <div className="reveal px-3 pb-4 pl-[52px]">
                            <p className="text-ink-2"><Rich text={c.narrative} /></p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
                              {c.files.map((f) => <FileLink key={f} owner={owner} repo={repo} number={number} path={f} />)}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {mechanicalChanges.length > 0 && (
                    <li>
                      <button className="flex w-full items-center gap-4 px-3 py-3 text-left" onClick={() => setShowMechanical((v) => !v)}>
                        <span className="display-italic w-6 text-[20px] leading-none text-faint">{importantChanges.length + 1}.</span>
                        <span className="min-w-0 flex-1 text-muted">Supporting and mechanical changes</span>
                        <span className="tag">low</span>
                        <span className="mono w-14 text-right text-faint">{mechanicalFileCount} file{mechanicalFileCount === 1 ? "" : "s"}</span>
                        <span className="mono w-4 text-faint">{showMechanical ? "−" : "+"}</span>
                      </button>
                      {showMechanical && (
                        <div className="reveal space-y-3 px-3 pb-4 pl-[52px]">
                          {mechanicalChanges.map((c, i) => (
                            <div key={i}>
                              <div className="font-medium text-ink-2">{c.title}</div>
                              <p className="mt-1 text-[14px] text-muted"><Rich text={c.narrative} /></p>
                              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-faint">
                                {c.files.map((f) => <FileLink key={f} owner={owner} repo={repo} number={number} path={f} />)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  )}
                </ol>
              </section>
            )}

            {/* ---------- Drill-down: collapsed by default ---------- */}
            <section className="reveal" style={{ animationDelay: "140ms" }}>
              <Fold
                label="Components"
                meta={`${summary.components.length}`}
                open={showComponents}
                onToggle={() => setShowComponents((v) => !v)}
              >
                <ul className="mt-3 grid grid-cols-2 gap-3">
                  {summary.components.map((c) => (
                    <li
                      key={c.id}
                      onClick={() => { setSelected(selected === c.id ? null : c.id); setOpenChange(null); setRiskFiles(null); }}
                      className={`panel cursor-pointer p-4 transition ${selected === c.id ? "!border-amber/60" : "hover:!border-line-2"}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full ${c.change === "added" ? "bg-moss" : c.change === "removed" ? "bg-rust" : c.change === "unchanged" ? "border border-faint" : "bg-amber"}`} />
                        <span className="min-w-0 flex-1 break-words font-semibold leading-snug">{c.name}</span>
                        <span className="tag mt-0.5">{c.kind}</span>
                      </div>
                      <p className="mt-2 text-[14px] text-ink-2"><Rich text={c.summary} /></p>
                    </li>
                  ))}
                </ul>
              </Fold>
            </section>

            {summary.questions.length > 0 && (
              <section className="reveal" style={{ animationDelay: "160ms" }}>
                <Fold
                  label="Questions for the author"
                  meta={`${summary.questions.length}`}
                  open={showQuestions}
                  onToggle={() => setShowQuestions((v) => !v)}
                >
                  <ol className="mt-3 space-y-3">
                    {summary.questions.map((q, i) => (
                      <li key={i} className="flex gap-3 text-ink-2">
                        <span className="display-italic text-amber">{i + 1}.</span>
                        <span><Rich text={q} /></span>
                      </li>
                    ))}
                  </ol>
                </Fold>
              </section>
            )}

            <ReviewSection
              owner={owner}
              repo={repo}
              number={number}
              onVerdict={setVerdict}
              onTraceFiles={(files) => { setRiskFiles(files); if (files) { setSelected(null); setOpenChange(null); } }}
            />

            <section className="reveal" style={{ animationDelay: "220ms" }}>
              <Fold
                label="Files, most important first"
                meta={[
                  attentionCounts.scrutinize ? `${attentionCounts.scrutinize} scrutinize` : null,
                  attentionCounts.read ? `${attentionCounts.read} read` : null,
                  attentionCounts.skim ? `${attentionCounts.skim} skim` : null,
                ].filter(Boolean).join(" · ")}
                open={filesOpen}
                onToggle={() => setShowFiles((v) => !v)}
                extra={
                  <button className="mono text-[11px] text-muted hover:text-ink" onClick={(e) => { e.stopPropagation(); load(true); }}>
                    {cached ? "regenerate summary" : "fresh summary"}
                  </button>
                }
              >
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {sortedFiles.map((f) => {
                    const raw = fileMap.get(f.path);
                    const a = ATTENTION[f.attention];
                    const hl = highlightedFiles.has(f.path);
                    const open = openDiff.has(f.path);
                    return (
                      <li key={f.path} className={`transition ${hl ? "bg-amber/5" : ""} ${isTracing && !hl ? "opacity-40" : ""}`}>
                        <div className="grid grid-cols-[110px_1fr_auto] items-start gap-4 py-3">
                          <span className={`tag ${a.cls} mt-0.5 justify-center`}>{a.label}</span>
                          <div className="min-w-0">
                            <div className="truncate"><FileLink owner={owner} repo={repo} number={number} path={f.path} className="text-ink" /></div>
                            <p className="mt-1 text-[14px] text-ink-2"><span className="text-muted">{f.role} · </span><Rich text={f.summary} /></p>
                          </div>
                          <div className="text-right">
                            {raw && (
                              <div className="mono">
                                <span className="text-moss">+{raw.additions}</span> <span className="text-rust">−{raw.deletions}</span>
                              </div>
                            )}
                            <button className="mono mt-1 text-[11px] text-muted hover:text-amber" onClick={() => toggleDiff(f.path)}>
                              {open ? "hide diff" : "show diff"}
                            </button>
                          </div>
                        </div>
                        {open && (
                          <div className="mb-4 rounded-lg border border-line bg-bg">
                            <DiffView patch={raw?.patch} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Fold>
            </section>
          </>
        )}
      </div>

      <aside className="sticky top-8 self-start space-y-4">
        <ReviewPanel owner={owner} repo={repo} number={number} reviews={reviews} verdictHint={verdict ?? undefined} />
        <AskPanel owner={owner} repo={repo} number={number} disabled={!summary} />
      </aside>
    </div>
  );
}

/** A file path that opens the per-file breakdown page. */
export function FileLink({ owner, repo, number, path, className }: { owner: string; repo: string; number: number; path: string; className?: string }) {
  return (
    <Link
      href={fileHref(owner, repo, number, path)}
      onClick={(e) => e.stopPropagation()}
      className={`mono underline decoration-line-2 underline-offset-[3px] transition hover:text-amber hover:decoration-amber ${className ?? ""}`}
    >
      {path}
    </Link>
  );
}

/** A section header that hides its body until asked. */
function Fold({ label, meta, open, onToggle, extra, children }: {
  label: string; meta?: string; open: boolean; onToggle: () => void; extra?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <button className="group flex items-baseline gap-3 text-left" onClick={onToggle}>
          <span className="eyebrow group-hover:!text-ink transition">{label}</span>
          {meta && <span className="mono text-[11px] text-faint">{meta}</span>}
          <span className="mono text-[11px] text-faint">{open ? "hide" : "show"}</span>
        </button>
        {extra}
      </div>
      {open && <div className="reveal">{children}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
          Reading the change…
        </div>
        <div className="shimmer mt-3 h-8 w-4/5" />
        <div className="mt-6 grid grid-cols-2 gap-8">
          <div className="space-y-2"><div className="shimmer h-4 w-1/3" /><div className="shimmer h-4" /><div className="shimmer h-4" /><div className="shimmer h-4 w-2/3" /></div>
          <div className="space-y-2"><div className="shimmer h-4 w-1/3" /><div className="shimmer h-4" /><div className="shimmer h-4" /><div className="shimmer h-4 w-1/2" /></div>
        </div>
      </div>
      <div className="shimmer h-64" />
      <div className="grid grid-cols-2 gap-3"><div className="shimmer h-24" /><div className="shimmer h-24" /><div className="shimmer h-24" /><div className="shimmer h-24" /></div>
    </div>
  );
}
