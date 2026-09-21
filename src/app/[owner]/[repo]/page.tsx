import Link from "next/link";
import { Suspense } from "react";
import { listOpenPulls, listPullStats, type PullStats } from "@/lib/github";
import { readCachedSummary } from "@/lib/summarize";
import { PrewarmBadge } from "@/components/PrewarmBadge";

export const dynamic = "force-dynamic";

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const DECISION: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "approved", cls: "tag-moss" },
  CHANGES_REQUESTED: { label: "changes requested", cls: "tag-rust" },
  REVIEW_REQUIRED: { label: "review required", cls: "tag-amber" },
};

export default async function RepoPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  let pulls: Awaited<ReturnType<typeof listOpenPulls>> = [];
  let error: string | null = null;
  try {
    pulls = await listOpenPulls(owner, repo);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  // Line counts and review decisions are slow on GitHub's side; start them now and stream them into the rows.
  const stats = error ? null : listPullStats(owner, repo).catch(() => new Map<number, PullStats>());
  const ready = new Set(
    (await Promise.all(pulls.map(async (pr) => ((await readCachedSummary(owner, repo, pr.number, pr.headSha)) ? pr.number : null))))
      .filter((n): n is number => n !== null),
  );

  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <header className="reveal">
        <div className="eyebrow">{owner}</div>
        <h1 className="display mt-1 text-[38px] leading-none">{repo}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          <span>{pulls.length} open pull request{pulls.length === 1 ? "" : "s"}</span>
          {pulls.length > 0 && <span className="mono text-[12px]">{ready.size} of {pulls.length} summaries ready</span>}
          <PrewarmBadge owner={owner} repo={repo} />
        </p>
      </header>

      {error && (
        <div className="panel mt-8 p-5 text-rust">
          <div className="eyebrow !text-rust">Could not load pull requests</div>
          <p className="mono mt-2 whitespace-pre-wrap">{error}</p>
        </div>
      )}

      <ul className="mt-8 divide-y divide-line">
        {pulls.map((pr, i) => (
          <li key={pr.number} className="reveal" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
            <Link
              href={`/${owner}/${repo}/pull/${pr.number}`}
              className="group grid grid-cols-[1fr_auto] items-start gap-6 py-5 transition hover:bg-bg-2/60 -mx-4 px-4 rounded-lg"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="mono text-muted">#{pr.number}</span>
                  {pr.draft && <span className="tag">draft</span>}
                  {ready.has(pr.number) && <span className="tag tag-moss" title="Summary is generated for the current head">ready</span>}
                  {stats && (
                    <Suspense fallback={null}>
                      <Decision stats={stats} number={pr.number} />
                    </Suspense>
                  )}
                  {pr.labels.slice(0, 3).map((l) => (
                    <span key={l} className="tag">{l}</span>
                  ))}
                </div>
                <h2 className="display mt-2 text-[21px] leading-snug text-ink group-hover:text-amber transition">
                  {pr.title}
                </h2>
                <div className="mt-2 flex items-center gap-3 text-[13px] text-muted">
                  {pr.authorAvatar && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pr.authorAvatar} alt="" className="h-5 w-5 rounded-full" />
                  )}
                  <span>{pr.author}</span>
                  <span className="text-faint">·</span>
                  <span className="mono">{pr.headRef}</span>
                  <span className="text-faint">→</span>
                  <span className="mono">{pr.baseRef}</span>
                </div>
              </div>
              <div className="text-right">
                {stats && (
                  <Suspense fallback={<><div className="shimmer ml-auto h-4 w-20" /><div className="shimmer ml-auto mt-1.5 h-4 w-12" /></>}>
                    <Numbers stats={stats} number={pr.number} />
                  </Suspense>
                )}
                <div className="mono mt-1 text-faint">updated {ago(pr.updatedAt)} ago</div>
              </div>
            </Link>
          </li>
        ))}
        {!error && pulls.length === 0 && (
          <li className="py-16 text-center text-muted">Nothing open. Enjoy the quiet.</li>
        )}
      </ul>
    </div>
  );
}

async function Decision({ stats, number }: { stats: Promise<Map<number, PullStats>>; number: number }) {
  const d = (await stats).get(number)?.reviewDecision;
  const tag = d ? DECISION[d] : null;
  return tag ? <span className={`tag ${tag.cls}`}>{tag.label}</span> : null;
}

async function Numbers({ stats, number }: { stats: Promise<Map<number, PullStats>>; number: number }) {
  const s = (await stats).get(number);
  if (!s) return null;
  return (
    <>
      <div className="mono">
        <span className="text-moss">+{s.additions}</span>{" "}
        <span className="text-rust">−{s.deletions}</span>
      </div>
      <div className="mono mt-1 text-muted">
        {s.changedFiles} file{s.changedFiles === 1 ? "" : "s"}
      </div>
    </>
  );
}
