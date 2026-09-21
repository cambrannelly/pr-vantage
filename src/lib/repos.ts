import { promises as fs } from "node:fs";
import path from "node:path";
import { gh } from "./github";

/**
 * A pinned repository. `account` is the GitHub login that pinned it; pins without one show for
 * every account. `hidden` keeps it out of the nav and the pre-warm poller until unhidden.
 */
export type RepoRef = { owner: string; repo: string; description?: string; account?: string; hidden?: boolean };

const FILE = path.join(process.cwd(), "data", "repos.json");

async function readStored(): Promise<RepoRef[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}

async function writeStored(repos: RepoRef[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(repos, null, 2));
}

function seeded(): RepoRef[] {
  return (process.env.PR_VANTAGE_REPOS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [owner, repo] = s.split("/");
      return { owner, repo } as RepoRef;
    })
    .filter((r) => r.owner && r.repo);
}

function dedupe(repos: RepoRef[]): RepoRef[] {
  const seen = new Set<string>();
  return repos.filter((r) => {
    const key = `${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every pin plus env seeds, across all accounts, hidden ones included. Stored records win over seeds. */
export async function listAllRepos(): Promise<RepoRef[]> {
  return dedupe([...(await readStored()), ...seeded()]);
}

/** What the pre-warm poller should watch: everything that is not hidden. */
export async function listActiveRepos(): Promise<RepoRef[]> {
  return (await listAllRepos()).filter((r) => !r.hidden);
}

/** Hide or unhide a pin. Env-seeded repos get a stored record so the flag sticks. */
export async function setHidden(owner: string, repo: string, hidden: boolean, account?: string): Promise<RepoRef[]> {
  const stored = await readStored();
  const existing = stored.find((r) => r.owner === owner && r.repo === repo);
  if (existing) existing.hidden = hidden || undefined;
  else stored.push({ owner, repo, hidden: hidden || undefined });
  await writeStored(stored);
  return listRepos(account);
}

/**
 * Pins visible to one account: pins it made, plus untagged pins (env seeds, pins from
 * before accounts existed) that GitHub confirms it can actually reach.
 */
export async function listRepos(account?: string): Promise<RepoRef[]> {
  const all = await listAllRepos();
  if (!account) return all;
  const visible = await Promise.all(
    all.map(async (r) => {
      if (r.account) return r.account === account ? r : null;
      return (await canAccess(account, r)) ? r : null;
    }),
  );
  return visible.filter((r): r is RepoRef => r !== null);
}

const ACCESS_TTL_MS = 10 * 60_000;
const access = new Map<string, { at: number; ok: Promise<boolean> }>();

/** Does this login see this repo? Memoized per process; a GitHub hiccup errs toward showing the pin. */
function canAccess(login: string, r: RepoRef): Promise<boolean> {
  const key = `${login}:${r.owner}/${r.repo}`.toLowerCase();
  const hit = access.get(key);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.ok;
  const ok = (async () => {
    try {
      await (await gh(login)).rest.repos.get({ owner: r.owner, repo: r.repo });
      return true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      return !(status === 404 || status === 403);
    }
  })();
  access.set(key, { at: Date.now(), ok });
  return ok;
}

export async function addRepo(ref: RepoRef): Promise<RepoRef[]> {
  const stored = await readStored();
  if (!stored.some((r) => r.owner === ref.owner && r.repo === ref.repo)) stored.push(ref);
  await writeStored(stored);
  return listRepos(ref.account);
}

export async function removeRepo(owner: string, repo: string, account?: string): Promise<RepoRef[]> {
  const stored = (await readStored()).filter((r) => !(r.owner === owner && r.repo === repo));
  await writeStored(stored);
  return listRepos(account);
}
