import { Octokit } from "@octokit/rest";
import { execSync } from "node:child_process";

let cachedToken: string | null = null;

export function resolveGitHubToken(): string {
  if (cachedToken) return cachedToken;
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return (cachedToken = fromEnv);
  try {
    const fromGh = execSync("gh auth token", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (fromGh) return (cachedToken = fromGh);
  } catch {
    // gh not installed or not logged in
  }
  throw new Error(
    "No GitHub token. Set GITHUB_TOKEN in .env.local or run `gh auth login`.",
  );
}

export function gh(): Octokit {
  return new Octokit({ auth: resolveGitHubToken() });
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
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
};

export async function listOpenPulls(owner: string, repo: string): Promise<PullSummaryRow[]> {
  const octokit = gh();
  // GraphQL gives us review decision + line stats in one round trip.
  const query = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            number title createdAt updatedAt isDraft url
            headRefName baseRefName headRefOid
            additions deletions changedFiles
            reviewDecision
            author { login avatarUrl }
            labels(first: 10) { nodes { name } }
          }
        }
      }
    }`;
  type Node = {
    number: number; title: string; createdAt: string; updatedAt: string; isDraft: boolean; url: string;
    headRefName: string; baseRefName: string; headRefOid: string;
    additions: number; deletions: number; changedFiles: number;
    reviewDecision: string | null;
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
    reviewDecision: n.reviewDecision,
    additions: n.additions,
    deletions: n.deletions,
    changedFiles: n.changedFiles,
    url: n.url,
  }));
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
  reviews: { author: string; state: string; body: string; submittedAt: string }[];
  comments: { author: string; body: string; createdAt: string }[];
};

export async function getPullDetail(owner: string, repo: string, number: number): Promise<PullDetail> {
  const octokit = gh();
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
export async function attachHeadContents(detail: PullDetail): Promise<PullDetail> {
  const octokit = gh();
  const { owner, repo } = detail.headRepo;
  const targets = detail.files.filter((f) => f.status !== "removed" && !isBinaryish(f.path));
  const chunk = 8;
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
  const octokit = gh();
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
  const octokit = gh();
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return { owner: data.owner.login, repo: data.name, description: data.description ?? "", private: data.private };
}

const GUIDANCE_FILES = [".pr-vantage.md", "ARCHITECTURE.md", "CLAUDE.md", "AGENTS.md", ".cursorrules", "docs/ARCHITECTURE.md"];
const MAX_GUIDANCE_CHARS = 20_000;

/** Repo-authored architecture notes and rules, read from the base branch. Same idea as Greptile consuming CLAUDE.md. */
export async function getRepoGuidance(owner: string, repo: string, ref: string): Promise<{ path: string; text: string }[]> {
  const octokit = gh();
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
