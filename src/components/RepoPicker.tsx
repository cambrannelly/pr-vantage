"use client";

import { useEffect, useRef, useState } from "react";

export type Candidate = { owner: string; repo: string; description: string; private: boolean; pushedAt: string | null; pinned: boolean };

function ago(iso: string | null) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1) return "today";
  if (d < 30) return `${Math.floor(d)}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/**
 * Find a repository the selected account can see and pin it. Type to filter; the list
 * comes from GitHub, most recently pushed first. Pasting owner/repo or a URL still works
 * for anything outside the first few hundred repos.
 */
export function RepoPicker({ onPick, busy }: { onPick: (input: string) => Promise<void>; busy: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/repos/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) { setError(json.error ?? "Could not list repositories"); setItems([]); return; }
        setItems(json.repos);
        setTotal(json.total);
        setError(null);
        setCursor(0);
      } finally {
        if (alive) setLoading(false);
      }
    }, q ? 120 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const typedRef = q.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").match(/^([^/\s]+)\/([^/\s]+)$/);
  const typedKey = typedRef ? `${typedRef[1]}/${typedRef[2]}`.toLowerCase() : null;
  const showTyped = !!typedKey && !(items ?? []).some((r) => `${r.owner}/${r.repo}`.toLowerCase() === typedKey);
  const rows = (items ?? []).filter((r) => !r.pinned);
  const optionCount = rows.length + (showTyped ? 1 : 0);

  async function pick(input: string) {
    setOpen(false);
    setQ("");
    await onPick(input);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) { if (e.key === "ArrowDown") setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, optionCount - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter") {
      e.preventDefault();
      if (showTyped && cursor === 0) return void pick(q);
      const r = rows[cursor - (showTyped ? 1 : 0)];
      if (r) void pick(`${r.owner}/${r.repo}`);
    }
  }

  return (
    <div ref={box} className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Find a repository…"
        className="mono !text-[12.5px]"
        disabled={busy}
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[420px] overflow-y-auto rounded-lg border border-line-2 bg-bg-2 shadow-[0_-12px_40px_rgba(0,0,0,0.45)]">
          <div className="eyebrow flex items-center justify-between px-3 pt-3 pb-1">
            <span>{q ? "Matches" : "Recently pushed"}</span>
            <span className="text-faint normal-case tracking-normal">
              {loading ? "…" : total ? `${total} visible` : ""}
            </span>
          </div>
          {error && <p className="px-3 pb-3 text-[12px] text-rust">{error}</p>}
          <ul className="pb-1">
            {showTyped && (
              <li>
                <button
                  onMouseEnter={() => setCursor(0)}
                  onClick={() => pick(q)}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left ${cursor === 0 ? "bg-bg-4" : "hover:bg-bg-3"}`}
                >
                  <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{typedRef![2]}</span>
                  <span className="mono truncate text-[11px] text-muted">{typedRef![1]}/</span>
                  <span className="mono ml-auto shrink-0 text-[11px] text-faint">add by name</span>
                </button>
              </li>
            )}
            {rows.map((r, i) => {
              const idx = i + (showTyped ? 1 : 0);
              return (
                <li key={`${r.owner}/${r.repo}`}>
                  <button
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => pick(`${r.owner}/${r.repo}`)}
                    className={`block w-full px-3 py-2 text-left ${cursor === idx ? "bg-bg-4" : "hover:bg-bg-3"}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{r.repo}</span>
                      {r.private && <span className="tag !px-1.5 !py-0 !text-[9.5px]">private</span>}
                      <span className="mono ml-auto shrink-0 text-[11px] text-faint">{ago(r.pushedAt)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">
                      <span className="mono">{r.owner}/</span>
                      {r.description && <span className="text-faint"> · {r.description}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
            {items && rows.length === 0 && !showTyped && !error && (
              <li className="px-3 py-3 text-[12px] text-muted">
                {q ? "Nothing matches. Paste owner/repo to add one directly." : "Everything you can see is already pinned."}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
