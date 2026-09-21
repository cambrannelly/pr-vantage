import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/accounts";
import { listAccessibleRepos } from "@/lib/github";
import { listRepos } from "@/lib/repos";
import { errorResponse } from "@/lib/api-errors";

/** Repos the selected account can see, filtered by a substring of owner/name, pinned ones marked. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  try {
    const me = await currentAccount();
    const [all, pinned] = await Promise.all([listAccessibleRepos(me.login), listRepos(me.login)]);
    const pinnedKeys = new Set(pinned.map((r) => `${r.owner}/${r.repo}`.toLowerCase()));
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = all
      .filter((r) => {
        const hay = `${r.owner}/${r.repo} ${r.description}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 25)
      .map((r) => ({ ...r, pinned: pinnedKeys.has(`${r.owner}/${r.repo}`.toLowerCase()) }));
    return NextResponse.json({ repos: matches, total: all.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
