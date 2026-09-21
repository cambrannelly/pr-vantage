import { promises as fs } from "node:fs";
import path from "node:path";

export type RepoRef = { owner: string; repo: string; description?: string };

const FILE = path.join(process.cwd(), "data", "repos.json");

export async function listRepos(): Promise<RepoRef[]> {
  let stored: RepoRef[] = [];
  try {
    stored = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    stored = [];
  }
  const seeded = (process.env.PR_LENS_REPOS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [owner, repo] = s.split("/");
      return { owner, repo } as RepoRef;
    })
    .filter((r) => r.owner && r.repo);
  const seen = new Set<string>();
  return [...stored, ...seeded].filter((r) => {
    const key = `${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function addRepo(ref: RepoRef): Promise<RepoRef[]> {
  const current = await listRepos();
  if (!current.some((r) => r.owner === ref.owner && r.repo === ref.repo)) current.push(ref);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(current, null, 2));
  return current;
}

export async function removeRepo(owner: string, repo: string): Promise<RepoRef[]> {
  const current = (await listRepos()).filter((r) => !(r.owner === owner && r.repo === repo));
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(current, null, 2));
  return current;
}
