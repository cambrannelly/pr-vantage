import Link from "next/link";
import { listRepos } from "@/lib/repos";
import { currentAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/** Neutral landing: nothing selected. Shown on first load and after an account switch. */
export default async function Home() {
  const me = await currentAccount().catch(() => null);
  const repos = await listRepos(me?.login);

  return (
    <div className="flex min-h-screen items-center justify-center p-12">
      <div className="w-full max-w-xl reveal">
        {repos.length === 0 ? (
          <>
            <div className="eyebrow">Getting started</div>
            <h1 className="display mt-3 text-[40px] leading-[1.05]">
              Review the <span className="display-italic text-amber">shape</span> of a change, not every line.
            </h1>
            <p className="mt-5 text-ink-2">
              Add a repository in the sidebar. PR Vantage pulls its open pull requests, reads the diffs and the
              surrounding code, and lays out the architecture, intent, and the few files that deserve your eyes.
            </p>
            {me && <p className="mono mt-6 text-[12px] text-faint">reviewing as {me.login}</p>}
          </>
        ) : (
          <>
            <div className="eyebrow">{me ? `Reviewing as ${me.login}` : "Repositories"}</div>
            <h1 className="display mt-3 text-[40px] leading-[1.05]">
              Pick a <span className="display-italic text-amber">repository</span>.
            </h1>
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {repos.map((r, i) => (
                <li key={`${r.owner}/${r.repo}`} className="reveal" style={{ animationDelay: `${i * 40}ms` }}>
                  <Link href={`/${r.owner}/${r.repo}`} className="group flex items-baseline gap-3 py-4 transition hover:text-amber">
                    <span className="mono text-[12px] text-muted">{r.owner}/</span>
                    <span className="display text-[22px] leading-none">{r.repo}</span>
                    {r.description && <span className="ml-auto truncate text-[13px] text-faint">{r.description}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
