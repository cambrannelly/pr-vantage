import Link from "next/link";
import { listOpenPulls } from "@/lib/github";

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

  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <header className="reveal">
        <div className="eyebrow">{owner}</div>
        <h1 className="display mt-1 text-[38px] leading-none">{repo}</h1>
        <p className="mt-3 text-muted">
          {pulls.length} open pull request{pulls.length === 1 ? "" : "s"}
        </p>
      </header>

      {error && (
        <div className="panel mt-8 p-5 text-rust">
          <div className="eyebrow !text-rust">Could not load pull requests</div>
          <p className="mono mt-2 whitespace-pre-wrap">{error}</p>
        </div>
      )}

      <ul className="mt-8 divide-y divide-line">
        {pulls.map((pr, i) => {
          const d = pr.reviewDecision ? DECISION[pr.reviewDecision] : null;
          return (
            <li key={pr.number} className="reveal" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
              <Link
                href={`/${owner}/${repo}/pull/${pr.number}`}
                className="group grid grid-cols-[1fr_auto] items-start gap-6 py-5 transition hover:bg-bg-2/60 -mx-4 px-4 rounded-lg"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="mono text-muted">#{pr.number}</span>
                    {pr.draft && <span className="tag">draft</span>}
                    {d && <span className={`tag ${d.cls}`}>{d.label}</span>}
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
                  <div className="mono">
                    <span className="text-moss">+{pr.additions}</span>{" "}
                    <span className="text-rust">−{pr.deletions}</span>
                  </div>
                  <div className="mono mt-1 text-muted">
                    {pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}
                  </div>
                  <div className="mono mt-1 text-faint">updated {ago(pr.updatedAt)} ago</div>
                </div>
              </Link>
            </li>
          );
        })}
        {!error && pulls.length === 0 && (
          <li className="py-16 text-center text-muted">Nothing open. Enjoy the quiet.</li>
        )}
      </ul>
    </div>
  );
}
