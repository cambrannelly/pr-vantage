"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";

type Turn = { role: "user" | "assistant"; content: string };

export function AskPanel({ owner, repo, number, disabled }: { owner: string; repo: string; number: number; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    setQ("");
    const history = turns;
    setTurns((t) => [...t, { role: "user", content: question }]);
    const res = await fetch("/api/ask", {
      method: "POST",
      body: JSON.stringify({ owner, repo, number, question, history }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Failed");
      setTurns(history);
      setQ(question);
      return;
    }
    setTurns((t) => [...t, { role: "assistant", content: json.answer }]);
  }

  return (
    <div className="panel p-5">
      <div className="eyebrow">Ask about this change</div>
      {turns.length > 0 && (
        <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "text-ink" : "text-ink-2"}>
              <div className={`eyebrow !text-[10px] ${t.role === "user" ? "!text-amber" : ""}`}>{t.role === "user" ? "you" : "lens"}</div>
              {t.role === "user" ? <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed">{t.content}</p> : <div className="mt-1"><Markdown text={t.content} /></div>}
            </div>
          ))}
          {busy && <div className="shimmer h-4 w-2/3" />}
        </div>
      )}
      <form onSubmit={ask} className="mt-3">
        <textarea
          className="min-h-[72px] resize-y"
          placeholder={disabled ? "Summary first, then questions." : "Why does the service bypass the repository here? What else calls this?"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(e); }}
          disabled={busy}
        />
        {error && <p className="mt-2 text-[12px] text-rust">{error}</p>}
        <div className="mt-2 flex items-center justify-between">
          <span className="mono text-[11px] text-faint">⌘↵ to send</span>
          <button type="submit" className="btn" disabled={busy || !q.trim()}>{busy ? "Thinking…" : "Ask"}</button>
        </div>
      </form>
    </div>
  );
}
