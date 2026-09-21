import { redirect } from "next/navigation";
import { listRepos } from "@/lib/repos";
import { currentAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentAccount().catch(() => null);
  const repos = await listRepos(me?.login);
  if (repos.length > 0) redirect(`/${repos[0].owner}/${repos[0].repo}`);
  return (
    <div className="flex min-h-screen items-center justify-center p-12">
      <div className="max-w-md reveal">
        <div className="eyebrow">Getting started</div>
        <h1 className="display mt-3 text-[40px] leading-[1.05]">
          Review the <span className="display-italic text-amber">shape</span> of a change, not every line.
        </h1>
        <p className="mt-5 text-ink-2">
          Add a repository in the sidebar. PR Vantage pulls its open pull requests, reads the diffs and the
          surrounding code, and lays out the architecture, intent, and the few files that deserve your eyes.
        </p>
      </div>
    </div>
  );
}
