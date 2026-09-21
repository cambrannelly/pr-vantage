import { promises as fs } from "node:fs";
import path from "node:path";

/** A pinned repository. `account` is the GitHub login that pinned it; pins without one show for every account. */
export type RepoRef = { owner: string; repo: string; description?: string; account?: string };

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

/** Every pin plus env seeds, across all accounts. Used by the pre-warm job. */
export async function listAllRepos(): Promise<RepoRef[]> {
  return dedupe([...(await readStored()), ...seeded()]);
}

/** Pins visible to one account: its own pins plus untagged pins and env seeds. */
export async function listRepos(account?: string): Promise<RepoRef[]> {
  const all = await listAllRepos();
  if (!account) return all;
  return all.filter((r) => !r.account || r.account === account);
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
