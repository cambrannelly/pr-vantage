import Link from "next/link";
import { notFound } from "next/navigation";
import { getPullDetail } from "@/lib/github";
import { readCachedSummary } from "@/lib/summarize";
import { splitHunks } from "@/lib/filebreakdown";
import { fileHref } from "@/lib/links";
import { FileBreakdownView } from "@/components/FileBreakdownView";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

const ATTENTION_CLS: Record<string, string> = { scrutinize: "tag-rust", read: "tag-amber", skim: "" };
const ORDER: Record<string, number> = { scrutinize: 0, read: 1, skim: 2 };

export default async function FilePage({ params }: {
  params: Promise<{ owner: string; repo: string; number: string; path: string[] }>;
}) {
  const { owner, repo, number, path } = await params;
  const filePath = path.map(decodeURIComponent).join("/");
  const pr = await getPullDetail(owner, repo, Number(number));
  const file = pr.files.find((f) => f.path === filePath);
  if (!file) notFound();

  const summary = await readCachedSummary(owner, repo, pr.number, pr.headSha);
  const meta = summary?.files.find((f) => f.path === filePath);
  const ordered = summary
    ? [...summary.files].sort((a, b) => ORDER[a.attention] - ORDER[b.attention]).map((f) => f.path)
    : pr.files.map((f) => f.path);
  const idx = ordered.indexOf(filePath);
  const prev = idx > 0 ? ordered[idx - 1] : null;
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;
  const hunks = file.patch ? splitHunks(file.patch) : [];
  const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";
  const base = filePath.slice(dir.length);
  const blobUrl = `https://github.com/${pr.headRepo.owner}/${pr.headRepo.repo}/blob/${pr.headSha}/${filePath}`;
  const diffUrl = `${pr.url}/files#diff-${createHash("sha256").update(filePath).digest("hex")}`;

  return (
    <div className="mx-auto max-w-[1200px] px-10 py-8">
      <header className="reveal">
        <div className="flex items-center gap-3 text-[13px]">
          <Link href={`/${owner}/${repo}/pull/${pr.number}`} className="text-muted hover:text-ink">← #{pr.number} {pr.title}</Link>
          <span className="mono ml-auto text-muted">
            {idx >= 0 && `${idx + 1} of ${ordered.length}`}
          </span>
          {prev ? <Link href={fileHref(owner, repo, pr.number, prev)} className="mono text-muted hover:text-amber">‹ prev</Link> : <span className="mono text-faint">‹ prev</span>}
          {next ? <Link href={fileHref(owner, repo, pr.number, next)} className="mono text-muted hover:text-amber">next ›</Link> : <span className="mono text-faint">next ›</span>}
        </div>
        <h1 className="mono mt-4 !text-[20px] leading-tight">
          <span className="text-muted">{dir}</span><span className="text-ink">{base}</span>
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-muted">
          {meta && <span className={`tag ${ATTENTION_CLS[meta.attention]}`}>{meta.attention}</span>}
          <span className="tag">{file.status}</span>
          <span className="mono"><span className="text-moss">+{file.additions}</span> <span className="text-rust">−{file.deletions}</span></span>
          <span className="mono">{hunks.length} hunk{hunks.length === 1 ? "" : "s"}</span>
          {meta && <span>· {meta.role}</span>}
          <span className="ml-auto flex items-center gap-4">
            <a href={blobUrl} target="_blank" rel="noreferrer" className="mono text-muted hover:text-amber">file on github ↗</a>
            <a href={diffUrl} target="_blank" rel="noreferrer" className="mono text-muted hover:text-amber">diff on github ↗</a>
          </span>
        </div>
      </header>

      <div className="hairline my-8" />

      <FileBreakdownView owner={owner} repo={repo} number={pr.number} path={filePath} hunks={hunks} />
    </div>
  );
}
