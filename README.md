# PR Lens

Architecture-first pull request review. Pulls open PRs from GitHub, has Claude read the diff plus the
surrounding code, and lays out intent, approach, components, relationships, risks, and which files
actually deserve your eyes. Approve, comment, or request changes without leaving the page.

## Run it

```bash
cp .env.local.example .env.local   # add ANTHROPIC_API_KEY; GITHUB_TOKEN is optional if `gh auth login` is done
pnpm install
pnpm dev
```

Open http://localhost:4747 and add a repo in the sidebar as `owner/repo` or a GitHub URL.

## What you get per PR

1. Headline, intent, and approach in prose.
2. The story: 2-8 logical changes in order of importance, each with its narrative and files. Mechanical
   work (renames, lockfiles, generated code, docs) is folded into one collapsed low-importance group.
3. An architecture map grouped by layer. Green added, amber modified, red removed, dashed grey for
   existing components in the blast radius that were not edited. Click a node or a story step to trace
   its files.
4. Components, risks judged against architectural rules (new dependencies, bypassed layers, contract
   changes, auth boundaries, duplicated logic), and questions to ask the author.
5. Files sorted by how much attention they deserve, with the raw diff behind a toggle.
6. Ask questions about the change. Answers come from the full PR context plus the summary, with prompt
   caching so follow-ups are cheap.
7. Approve, comment, or request changes without leaving the page. Nothing is posted to the PR unless
   you do it.

If the repo has `.pr-lens.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, or `.cursorrules` on the
base branch, it is fed to the model as the team's conventions and the PR is judged against it.

## How it works

- `src/lib/github.ts` talks to GitHub over HTTPS with Octokit. No SSH, no `gh` dependency at runtime
  beyond an optional `gh auth token` fallback for the token.
- `src/lib/summarize.ts` builds one prompt from the PR (patches plus full head contents of changed
  files) and asks Claude for a structured summary matching `src/lib/schema.ts`. Results cache on disk in
  `data/cache/` keyed by head SHA, so a summary is generated once per push.
- `data/repos.json` holds the sidebar. `PR_LENS_REPOS=owner/a,owner/b` seeds it.

## Known POC limits

- Summaries are non-streaming; a large PR can take a minute. The UI shows a skeleton until it lands.
- Reviews are PR-level only. Inline line comments are the obvious next step.
- GitHub blocks approving your own PR; the error surfaces in the review panel.
