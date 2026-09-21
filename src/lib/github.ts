import { Octokit } from "@octokit/rest";
import { currentAccount, tokenFor } from "./accounts";

/**
 * An Octokit for a GitHub identity. With no argument, uses the account the
 * browser session selected (cookie), falling back to the default account.
 * Background work passes an explicit login.
 */
export async function gh(login?: string): Promise<Octokit> {
  const who = login ?? (await currentAccount()).login;
  return new Octokit({ auth: await tokenFor(who) });
}

export type PullSummaryRow = {
  number: number;
  title: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  labels: string[];
  url: string;
};

/** Per-PR numbers GitHub computes on demand. Fetched separately because they make the list query 4-5x slower. */
export type PullStats = {
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
};

const LIST_TTL_MS = 20_000;
const listCache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Short-lived memo so sidebar back-and-forth does not re-query GitHub every time. */
function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.value as Promise<T>;
  const value = fn();
  listCache.set(key, { at: Date.now(), value });
  value.catch(() => listCache.delete(key));
  return value;
}

export async function listOpenPulls(owner: string, repo: string, login?: string): Promise<PullSummaryRow[]> {
  const octokit = await gh(login);
  return memo(`pulls:${login ?? "-"}:${owner}/${repo}`, async () => {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              number title createdAt updatedAt isDraft url
              headRefName baseRefName headRefOid
              author { login avatarUrl }
              labels(first: 10) { nodes { name } }
            }
          }
        }
      }`;
    type Node = {
      number: number; title: string; createdAt: string; updatedAt: string; isDraft: boolean; url: string;
      headRefName: string; baseRefName: string; headRefOid: string;
      author: { login: string; avatarUrl: string } | null;
      labels: { nodes: { name: string }[] };
    };
    const res = await octokit.graphql<{ repository: { pullRequests: { nodes: Node[] } } }>(query, { owner, repo });
    return res.repository.pullRequests.nodes.map((n) => ({
      number: n.number,
      title: n.title,
      author: n.author?.login ?? "ghost",
      authorAvatar: n.author?.avatarUrl ?? "",
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      draft: n.isDraft,
      headRef: n.headRefName,
      baseRef: n.baseRefName,
      headSha: n.headRefOid,
      labels: n.labels.nodes.map((l) => l.name),
      url: n.url,
    }));
  });
}

export async function listPullStats(owner: string, repo: string, login?: string): Promise<Map<number, PullStats>> {
  const octokit = await gh(login);
  return memo(`stats:${login ?? "-"}:${owner}/${repo}`, async () => {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { number additions deletions changedFiles reviewDecision }
          }
        }
      }`;
    type Node = { number: number; additions: number; deletions: number; changedFiles: number; reviewDecision: string | null };
    const res = await octokit.graphql<{ repository: { pullRequests: { nodes: Node[] } } }>(query, { owner, repo });
    return new Map(res.repository.pullRequests.nodes.map((n) => [n.number, { additions: n.additions, deletions: n.deletions, changedFiles: n.changedFiles, reviewDecision: n.reviewDecision }]));
  });
}

export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  headContent?: string;
};

export type PullDetail = {
  number: number;
  title: string;
  body: string;
  author: string;
  authorAvatar: string;
  state: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  headRepo: { owner: string; repo: string };
  additions: number;
  deletions: number;
  url: string;
  createdAt: string;
  mergeable: boolean | null;
  files: ChangedFile[];
  reviews: { author: string; state: string; body: string; submittedAt: string; url: string }[];
  comments: { author: string; body: string; createdAt: string }[];
};

export async function getPullDetail(owner: string, repo: string, number: number, login?: string): Promise<PullDetail> {
  const octokit = await gh(login);
  const [{ data: pr }, files, { data: reviews }, { data: comments }] = await Promise.all([
    octokit.rest.pulls.get({ owner, repo, pull_number: number }),
    octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number: number, per_page: 100 }),
    octokit.rest.pulls.listReviews({ owner, repo, pull_number: number, per_page: 100 }),
    octokit.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 100 }),
  ]);
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user?.login ?? "ghost",
    authorAvatar: pr.user?.avatar_url ?? "",
    state: pr.state,
    draft: !!pr.draft,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    headSha: pr.head.sha,
    headRepo: {
      owner: pr.head.repo?.owner.login ?? owner,
      repo: pr.head.repo?.name ?? repo,
    },
    additions: pr.additions,
    deletions: pr.deletions,
    url: pr.html_url,
    createdAt: pr.created_at,
    mergeable: pr.mergeable,
    files: files.map((f) => ({
      path: f.filename,
      previousPath: f.previous_filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
    reviews: reviews
      .filter((r) => r.state !== "PENDING")
      .map((r) => ({
        author: r.user?.login ?? "ghost",
        state: r.state,
        body: r.body ?? "",
        submittedAt: r.submitted_at ?? "",
        url: r.html_url,
      })),
    comments: comments.map((c) => ({
      author: c.user?.login ?? "ghost",
      body: c.body ?? "",
      createdAt: c.created_at,
    })),
  };
}

const MAX_FILE_CHARS = 16_000;

/** Full file contents at the PR head, so the model sees symbols in context, not just hunks. */
export async function attachHeadContents(detail: PullDetail, login?: string): Promise<PullDetail> {
  const octokit = await gh(login);
  const { owner, repo } = detail.headRepo;
  const targets = detail.files.filter((f) => f.status !== "removed" && !isBinaryish(f.path));
  const chunk = 16;
  for (let i = 0; i < targets.length; i += chunk) {
    await Promise.all(
      targets.slice(i, i + chunk).map(async (f) => {
        try {
          const { data } = await octokit.rest.repos.getContent({ owner, repo, path: f.path, ref: detail.headSha });
          if (!Array.isArray(data) && "content" in data && data.content) {
            const text = Buffer.from(data.content, "base64").toString("utf8");
            if (text.length <= MAX_FILE_CHARS) f.headContent = text;
          }
        } catch {
          // Too large, submodule, or missing. The patch alone will have to do.
        }
      }),
    );
  }
  return detail;
}

function isBinaryish(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|otf|zip|gz|lock|lockb|snap)$/i.test(path) ||
    /pnpm-lock\.yaml$|package-lock\.json$|yarn\.lock$/.test(path);
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export async function submitReview(
  owner: string,
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
) {
  const octokit = await gh();
  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: number,
    event,
    body: body || undefined,
  });
  return { id: data.id, state: data.state, url: data.html_url };
}

export async function validateRepo(owner: string, repo: string) {
  const octokit = await gh();
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return { owner: data.owner.login, repo: data.name, description: data.description ?? "", private: data.private };
}

const GUIDANCE_FILES = [".pr-vantage.md", "ARCHITECTURE.md", "CLAUDE.md", "AGENTS.md", ".cursorrules", "docs/ARCHITECTURE.md"];
const MAX_GUIDANCE_CHARS = 20_000;

/** Repo-authored architecture notes and rules, read from the base branch. Same idea as Greptile consuming CLAUDE.md. */
export async function getRepoGuidance(owner: string, repo: string, ref: string, login?: string): Promise<{ path: string; text: string }[]> {
  const octokit = await gh(login);
  const results = await Promise.all(
    GUIDANCE_FILES.map(async (path) => {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
        if (!Array.isArray(data) && "content" in data && data.content) {
          const text = Buffer.from(data.content, "base64").toString("utf8");
          return { path, text: text.slice(0, MAX_GUIDANCE_CHARS) };
        }
      } catch {
        // not present
      }
      return null;
    }),
  );
  return results.filter((r): r is { path: string; text: string } => r !== null);
}

/* ---------------- Checks (GitHub Actions and commit statuses) ---------------- */

export type CheckState = "running" | "passed" | "failed" | "neutral";

export type CheckRow = {
  name: string;
  app: string;
  state: CheckState;
  /** GitHub's raw conclusion or status, e.g. "in_progress", "success", "timed_out". */
  detail: string;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type ChecksSummary = {
  sha: string;
  checks: CheckRow[];
  counts: Record<CheckState, number>;
  /** Roll-up: failed if any failed, running if any still going, passed if all done and none failed. */
  overall: CheckState | "none";
};

function checkState(status: string, conclusion: string | null): CheckState {
  if (status !== "completed") return "running";
  switch (conclusion) {
    case "success":
      return "passed";
    case "failure":
    case "timed_out":
    case "cancelled":
    case "action_required":
    case "startup_failure":
      return "failed";
    default:
      return "neutral"; // neutral, skipped, stale
  }
}

export async function getChecks(owner: string, repo: string, sha: string, login?: string): Promise<ChecksSummary> {
  const octokit = await gh(login);
  const [runs, combined] = await Promise.all([
    octokit.paginate(octokit.rest.checks.listForRef, { owner, repo, ref: sha, per_page: 100 }),
    octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha }).then((r) => r.data).catch(() => null),
  ]);
  const checks: CheckRow[] = runs.map((r) => ({
    name: r.name,
    app: r.app?.name ?? "",
    state: checkState(r.status, r.conclusion),
    detail: r.status === "completed" ? (r.conclusion ?? "completed") : r.status,
    url: r.html_url ?? r.details_url ?? null,
    startedAt: r.started_at ?? null,
    completedAt: r.completed_at ?? null,
  }));
  for (const s of combined?.statuses ?? []) {
    checks.push({
      name: s.context,
      app: "status",
      state: s.state === "success" ? "passed" : s.state === "pending" ? "running" : "failed",
      detail: s.state,
      url: s.target_url ?? null,
      startedAt: s.created_at,
      completedAt: s.state === "pending" ? null : s.updated_at,
    });
  }
  const order: Record<CheckState, number> = { failed: 0, running: 1, passed: 2, neutral: 3 };
  checks.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  const counts: Record<CheckState, number> = { running: 0, passed: 0, failed: 0, neutral: 0 };
  for (const c of checks) counts[c.state]++;
  const overall: ChecksSummary["overall"] =
    checks.length === 0 ? "none" : counts.failed > 0 ? "failed" : counts.running > 0 ? "running" : counts.passed > 0 ? "passed" : "neutral";
  return { sha, checks, counts, overall };
}

/* ---------------- Merge ---------------- */

export type MergeMethod = "merge" | "squash" | "rebase";

export type MergeInfo = {
  merged: boolean;
  /** null while GitHub is still computing it. */
  mergeable: boolean | null;
  /** GitHub's mergeable_state: clean, unstable, blocked, behind, dirty, draft, unknown, has_hooks. */
  state: string;
  draft: boolean;
  headSha: string;
  baseRef: string;
  allowed: MergeMethod[];
  deleteBranchOnMerge: boolean;
};

export async function getMergeInfo(owner: string, repo: string, number: number, login?: string): Promise<MergeInfo> {
  const octokit = await gh(login);
  const [{ data: pr }, { data: r }] = await Promise.all([
    octokit.rest.pulls.get({ owner, repo, pull_number: number }),
    octokit.rest.repos.get({ owner, repo }),
  ]);
  const allowed: MergeMethod[] = [];
  if (r.allow_squash_merge) allowed.push("squash");
  if (r.allow_merge_commit) allowed.push("merge");
  if (r.allow_rebase_merge) allowed.push("rebase");
  return {
    merged: pr.merged,
    mergeable: pr.mergeable,
    state: pr.mergeable_state,
    draft: !!pr.draft,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    allowed,
    deleteBranchOnMerge: !!r.delete_branch_on_merge,
  };
}

/** Merge with the given strategy. `sha` guards against merging a head that moved since the reviewer looked. */
export async function mergePull(owner: string, repo: string, number: number, method: MergeMethod, sha: string) {
  const octokit = await gh();
  const { data } = await octokit.rest.pulls.merge({ owner, repo, pull_number: number, merge_method: method, sha });
  return { merged: data.merged, sha: data.sha, message: data.message };
}
