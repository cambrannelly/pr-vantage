import Link from "next/link";
import { getPullDetail } from "@/lib/github";
import { SummaryView } from "@/components/SummaryView";
import { CopyButton } from "@/components/CopyButton";

export const dynamic = "force-dynamic";

export default async function PullPage({ params }: { params: Promise<{ owner: string; repo: string; number: string }> }) {
  const { owner, repo, number } = await params;
  const pr = await getPullDetail(owner, repo, Number(number));

  return (
    <div className="mx-auto max-w-[1600px] px-10 py-8">
      <header className="reveal">
        <div className="flex items-center gap-3 text-[13px]">
          <Link href={`/${owner}/${repo}`} className="text-muted hover:text-ink">← {owner}/{repo}</Link>
          <span className="text-faint">·</span>
          <span className="mono text-muted">#{pr.number}</span>
          {pr.draft && <span className="tag">draft</span>}
          <a href={pr.url} target="_blank" rel="noreferrer" className="mono ml-auto text-muted hover:text-amber">open on github ↗</a>
        </div>
        <h1 className="display mt-3 max-w-4xl text-[34px] leading-[1.15]">{pr.title}</h1>
        <div className="mt-3 flex items-center gap-3 text-[13px] text-muted">
          {pr.authorAvatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pr.authorAvatar} alt="" className="h-5 w-5 rounded-full" />
          )}
          <span>{pr.author}</span>
          <span className="text-faint">·</span>
          <span className="mono">{pr.headRef}</span>
          <span className="text-faint">→</span>
          <span className="mono">{pr.baseRef}</span>
          <span className="text-faint">·</span>
          <span className="mono"><span className="text-moss">+{pr.additions}</span> <span className="text-rust">−{pr.deletions}</span> in {pr.files.length} files</span>
          {pr.mergeable === false && <span className="tag tag-rust">conflicts</span>}
          <span className="text-faint">·</span>
          <CopyButton text={pr.url} label="copy pr url" />
        </div>
      </header>

      <div className="hairline my-8" />

      <SummaryView
        owner={owner}
        repo={repo}
        number={pr.number}
        headSha={pr.headSha}
        files={pr.files}
        reviews={pr.reviews}
      />
    </div>
  );
}
