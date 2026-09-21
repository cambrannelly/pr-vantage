"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { RepoRef } from "@/lib/repos";
import type { Account } from "@/lib/accounts";
import { RepoPicker } from "./RepoPicker";

export function Sidebar({ repos: initial, accounts, active }: { repos: RepoRef[]; accounts: Account[]; active: string | null }) {
  const [repos, setRepos] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function switchAccount(login: string) {
    if (login === active) return;
    setSwitching(true);
    const res = await fetch("/api/account", { method: "POST", body: JSON.stringify({ login }) });
    setSwitching(false);
    if (!res.ok) return;
    // Pins and PR lists are per identity, so start from the top.
    router.push("/");
    router.refresh();
  }

  async function refreshAccounts() {
    setSwitching(true);
    await fetch("/api/account", { method: "POST", body: JSON.stringify({ refresh: true }) });
    setSwitching(false);
    router.refresh();
  }

  const me = accounts.find((a) => a.login === active) ?? null;

  async function add(input: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/repos", { method: "POST", body: JSON.stringify({ input }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Could not add repo");
    setRepos(json.repos);
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
            PR <span className="display-italic text-amber">Vantage</span>
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
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{r.repo}</span>
                  <PendingDot />
                </div>
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
      <div className="border-t border-line p-3">
        <RepoPicker onPick={add} busy={busy} />
        {error && <p className="mt-2 text-[12px] text-rust">{error}</p>}
      </div>
      <div className="border-t border-line px-3 py-3">
        <div className="flex items-baseline justify-between px-2 pb-2">
          <span className="eyebrow">Reviewing as</span>
          <button
            onClick={refreshAccounts}
            disabled={switching}
            title="Re-read accounts from gh. Add one with `gh auth login`, remove one with `gh auth logout -u <login>`."
            className="mono text-[11px] text-faint transition hover:text-ink disabled:opacity-50"
          >
            {switching ? "…" : "↻ refresh"}
          </button>
        </div>
        {accounts.length === 0 ? (
          <p className="px-2 text-[12.5px] leading-snug text-muted">
            No GitHub login found. Run <span className="mono text-ink-2">gh auth login</span>, then refresh.
          </p>
        ) : accounts.length === 1 && me ? (
          <AccountRow account={me} />
        ) : (
          <div className="relative">
            <select
              aria-label="GitHub account"
              value={active ?? ""}
              onChange={(e) => switchAccount(e.target.value)}
              disabled={switching}
              className="mono !text-[12.5px] w-full appearance-none pr-8"
            >
              {accounts.map((a) => (
                <option key={a.login} value={a.login}>
                  {a.login}
                  {a.source === "env" ? " (GITHUB_TOKEN)" : ""}
                </option>
              ))}
            </select>
            {me?.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.avatarUrl} alt="" className="pointer-events-none absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full" />
            )}
          </div>
        )}
        {accounts.length > 0 && (
          <p className="mt-2 px-2 text-[11px] leading-snug text-faint">
            Accounts come from the gh CLI. <span className="mono">gh auth login</span> adds one,{" "}
            <span className="mono">gh auth logout -u name</span> removes one, then refresh.
          </p>
        )}
      </div>
    </aside>
  );
}

/** Pulses while the clicked repo's page is still loading, so a click on the already-active repo visibly does something. */
function PendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber" />;
}

function AccountRow({ account }: { account: Account }) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      {account.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={account.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
      )}
      <div className="min-w-0">
        <div className="mono truncate text-[12.5px] text-ink">{account.login}</div>
        {account.name && <div className="truncate text-[11.5px] text-muted">{account.name}</div>}
      </div>
    </div>
  );
}
