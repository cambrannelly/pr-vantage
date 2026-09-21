import { NextResponse } from "next/server";
import { validateRepo } from "@/lib/github";
import { addRepo, listRepos, removeRepo } from "@/lib/repos";

export async function GET() {
  return NextResponse.json(await listRepos());
}

export async function POST(req: Request) {
  const { input } = (await req.json()) as { input: string };
  const match = input.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").match(/^([^/\s]+)\/([^/\s]+)/);
  if (!match) return NextResponse.json({ error: "Use owner/repo or a GitHub URL." }, { status: 400 });
  try {
    const info = await validateRepo(match[1], match[2]);
    const repos = await addRepo({ owner: info.owner, repo: info.repo, description: info.description });
    return NextResponse.json({ repos, added: info });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function DELETE(req: Request) {
  const { owner, repo } = (await req.json()) as { owner: string; repo: string };
  return NextResponse.json(await removeRepo(owner, repo));
}
