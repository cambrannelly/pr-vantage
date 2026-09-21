"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { RepoRef } from "@/lib/repos";

export function Sidebar({ repos: initial }: { repos: RepoRef[] }) {
  const [repos, setRepos] = useState(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/repos", { method: "POST", body: JSON.stringify({ input }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Could not add repo");
    setRepos(json.repos);
    setInput("");
    router.push(`/${json.added.owner}/${json.added.repo}`);
  }

  async function remove(r: RepoRef) {
    const res = await fetch("/api/repos", { method: "DELETE", body: JSON.stringify(r) });
    setRepos(await res.json());
    if (pathname.startsWith(`/${r.owner}/${r.repo}`)) router.push("/");
  }

  return (
    <aside className="sticky top-0 flex h-screen w-[260px] shrink-0 flex-col border-r border-line bg-bg-2/70 backdrop-blur">
      <div className="px-5 pt-6 pb-4">
        <Link href="/" className="block">
          <div className="display text-[26px] leading-none">
            PR <span className="display-italic text-amber">Lens</span>
          </div>
          <div className="eyebrow mt-2">architecture-first review</div>
        </Link>
      </div>
      <div className="hairline" />
      <div className="eyebrow px-5 pt-4 pb-2">Repositories</div>
      <nav className="flex-1 overflow-y-auto px-2">
        {repos.length === 0 && (
          <p className="px-3 py-2 text-[13px] text-muted">No repos yet. Add one below.</p>
        )}
        {repos.map((r) => {
          const href = `/${r.owner}/${r.repo}`;
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <div key={href} className="group relative">
              <Link
                href={href}
                className={`block rounded-lg px-3 py-2 transition ${active ? "bg-bg-4 text-ink" : "text-ink-2 hover:bg-bg-3"}`}
              >
                <div className="mono text-[11px] text-muted">{r.owner}/</div>
                <div className="truncate text-[14px] font-medium">{r.repo}</div>
                {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded bg-amber" />}
              </Link>
              <button
                onClick={() => remove(r)}
                title="Remove from sidebar"
                className="absolute right-2 top-2 hidden rounded px-1.5 text-[12px] text-faint hover:text-rust group-hover:block"
              >
                ×
              </button>
            </div>
          );
        })}
      </nav>
      <form onSubmit={add} className="border-t border-line p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repo or URL"
          className="mono !text-[12.5px]"
          disabled={busy}
        />
        {error && <p className="mt-2 text-[12px] text-rust">{error}</p>}
        <button type="submit" className="btn mt-2 w-full justify-center" disabled={busy || !input.trim()}>
          {busy ? "Checking…" : "Add repository"}
        </button>
      </form>
    </aside>
  );
}
