# PR Vantage

Architecture-first pull request review. Pulls open PRs from GitHub, has Claude read the diff plus the
surrounding code, and lays out intent, approach, components, relationships, risks, and which files
actually deserve your eyes. Approve, comment, or request changes without leaving the page.

## Run it

```bash
cp .env.local.example .env.local   # optional; model keys are entered on the Settings page in the app
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
   caching so follow-ups are cheap.
7. Approve, comment, or request changes without leaving the page. Nothing is posted to the PR unless
   you do it.
8. See CI at a glance: a collapsed Checks line rolls up GitHub Actions and commit statuses for the head
   SHA, expands to every check with a link, and polls while anything is running.
9. Merge with whichever strategy the repo allows (squash, merge commit, rebase). Two clicks, and the
   merge is refused if new commits landed after the page loaded.

If the repo has `.pr-vantage.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, or `.cursorrules` on the
base branch, it is fed to the model as the team's conventions and the PR is judged against it.

## How it works

- `src/lib/accounts.ts` discovers every account you are logged into with `gh auth login` (plus
  `GITHUB_TOKEN` if set). The sidebar switches between them; reviews post as whichever is selected.
  Pinned repos are remembered per account. Add an account with `gh auth login`, remove one with
  `gh auth logout -u <login>`, then hit refresh in the sidebar. The app never stores tokens itself.
- The sidebar picker lists every repo the selected account can see (own, collaborator, and org),
  most recently pushed first, and filters as you type. Pasting `owner/repo` or a URL still works.
- `src/lib/github.ts` talks to GitHub over HTTPS with Octokit using the selected account's token.
- `src/lib/llm.ts` is the only place a model is called. Anthropic is native; OpenAI, Kimi, and any
  OpenAI-compatible endpoint go through the OpenAI SDK with a base URL. Every pass asks for JSON
  matching a zod schema and validates it, so providers are interchangeable.
- The Settings page (`/settings`) is the only place model configuration lives: provider, API key,
  model, and effort, stored in `data/settings.json` (owner-only, gitignored). It can list the models a
  key can use. Defaults are the mid-tier model of each provider. On first run, a model key found in
  the environment is imported once so older setups keep working.
- `src/lib/summarize.ts` builds one prompt from the PR (patches plus full head contents of changed
  files) and streams a structured summary from the model. The model refers to files by index so it
  does not spend output tokens repeating long paths; `resolveSummary` maps them back. Snapshots are
  pushed to the page as they arrive, so the intent and architecture show while files are still being
  classified. Results cache on disk in `data/cache/` keyed by head SHA, so a summary is generated
  once per push. `PR_VANTAGE_EFFORT` trades quality for speed.
- `data/repos.json` holds the sidebar. `PR_VANTAGE_REPOS=owner/a,owner/b` seeds it.
- `src/lib/prewarm.ts` polls pinned repos while the app runs and generates summaries for PR heads
  that do not have one yet, so pages open instantly. Drafts and PRs untouched for a few days are
  skipped. Tune or disable it with the `PR_VANTAGE_PREWARM_*` variables in `.env.local.example`.

## Known POC limits

- Summaries are non-streaming; a large PR can take a minute. The UI shows a skeleton until it lands.
- Reviews are PR-level only. Inline line comments are the obvious next step.
- GitHub blocks approving your own PR; the error surfaces in the review panel.
