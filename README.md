# PR Vantage

Architecture-first pull request review. Instead of a wall of diffs, each PR opens as a one-screen brief:
what it is for, how the pieces fit, the story of the change in order of importance, and the handful of
files that actually deserve your attention. Approve, comment, request changes, watch CI, and merge
without leaving the page.

It runs on your machine, uses your own GitHub login, and talks to the model provider you pick.

## What you get for each PR

- **Summary.** One sentence of intent, then an architecture map grouped by layer: green added, amber
  modified, red removed, dashed grey for untouched components in the blast radius. Click a node to
  trace its files.
- **What changed, in order.** Two to six logical changes, most important first, each with a short
  narrative and its files. Renames, lockfiles, generated code, and scaffolding fold into one low-priority
  group at the end.
- **Files by attention.** Every file tagged scrutinize, read, or skim, with the raw diff a click away.
  Each file opens a breakdown page that groups its hunks by purpose and links back to GitHub.
- **Risks, on request.** A second pass that judges the PR against architectural rules: new dependencies,
  bypassed layers, contract and auth boundary changes, duplicated logic, and your repo's own conventions.
  It runs only when you ask.
- **Review, checks, merge.** Post a review as yourself. See CI rolled up on one line and expandable.
  Merge with whatever strategy the repo allows, with a refusal if commits landed since you loaded the page.

Summaries stream in as they are written, and a background poller pre-generates them for fresh PRs in
your pinned repos, so most pages are ready before you click.

## Requirements

- Node 20 or newer and [pnpm](https://pnpm.io).
- The [GitHub CLI](https://cli.github.com), signed in with `gh auth login`. You can have several accounts
  signed in; the app lets you switch between them.
- One of: an Anthropic API key, an OpenAI API key, a Kimi (Moonshot) API key, or a ChatGPT Plus/Pro/Team
  plan with Codex access (see the note on subscriptions below).

## Get started

```bash
git clone https://github.com/cambrannelly/pr-vantage.git
cd pr-vantage
pnpm install
pnpm start
```

`pnpm start` builds on first run (and again whenever the source has changed), serves on port 4747, and
opens your browser to it. Later runs skip the build and start in a couple of seconds. Add `--no-open`
to keep the browser closed. `pnpm dev` runs the hot-reloading development server instead, for working
on the app itself.

1. **Pick a model.** The home page points you to Settings. Choose a provider, paste an API key (or sign
   in with ChatGPT), pick a model, and click **Use &lt;model&gt;**. "Verify & list models" checks the key
   and shows every model it can use. Defaults are each provider's mid tier.
2. **Add a repository.** Click **+ Add repository** at the bottom of the sidebar. It lists every repo
   your GitHub account can see, most recently pushed first. Type to filter, or paste `owner/repo` or a
   GitHub URL.
3. **Open a pull request.** The repo page lists open PRs; a green "ready" tag means its summary is
   already generated. Open one. If nothing is cached yet, the summary streams in over a minute or so
   for a large PR, and the intent and architecture appear within seconds.

That is the whole setup. Nothing is posted to GitHub unless you click Approve, Comment, Request changes,
or Merge.

## Switching GitHub accounts

The **Reviewing as** picker at the bottom of the sidebar lists every account `gh` is signed into.
Reviews and merges post as the selected account, and the repo list and pinned repos follow it. Add an
account with `gh auth login`, remove one with `gh auth logout -u <login>`, then click **refresh** next
to the picker. The app never stores GitHub credentials itself.

## Providers and how they are paid for

| Provider | Auth | Default model |
| --- | --- | --- |
| Anthropic | API key | claude-sonnet-5 |
| OpenAI | API key **or** ChatGPT subscription | gpt-5.6-terra |
| Kimi (Moonshot) | API key | kimi-k2.6 |

**ChatGPT subscription is unofficial.** It signs in through the OAuth client of OpenAI's own Codex CLI
and sends requests to the Codex backend, the same way tools like pi and opencode do. OpenAI has neither
approved nor blocked third-party use of this, so it could stop working without notice. Prefer an API key
for anything you cannot afford to have interrupted. The default sign-in opens your browser; the
device-code alternative requires "device code authorization for Codex" to be enabled in your ChatGPT
security settings.

**Anthropic subscriptions are not offered.** Anthropic's terms forbid third-party tools from using them,
and since April 2026 such use is billed per token against the account's extra usage anyway, so an API key
costs the same and is allowed.

## Teaching the model your conventions

If the base branch has any of `.pr-vantage.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`,
`.cursorrules`, or `docs/ARCHITECTURE.md`, its contents are given to the model as the team's rules, and
both the summary and the risk review judge the PR against them. `.pr-vantage.md` is the place for notes
meant only for review.

## Configuration

Model settings live on the Settings page and in `data/settings.json`. The environment file is optional
and covers only the machine-level knobs. Copy `.env.local.example` to `.env.local` if you need any of
them:

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Use a token instead of, or alongside, `gh`. Fine-grained tokens need Pull requests (read/write), Contents (read), Metadata (read). |
| `PR_VANTAGE_REPOS` | Seed the sidebar for everyone: `owner/a,owner/b`. |
| `PR_VANTAGE_PREWARM` | `off` disables background pre-generation. |
| `PR_VANTAGE_PREWARM_INTERVAL` | Seconds between polls of pinned repos. Default 90. |
| `PR_VANTAGE_PREWARM_DAYS` | Only pre-generate PRs updated within this many days. Default 7. |
| `PR_VANTAGE_PREWARM_CONCURRENCY` | Parallel generations. Default 1. |

The app serves on port 4747. Set `PORT` to change it.

## Where your data goes

Everything the app keeps is in `data/`, which is gitignored:

- `settings.json`, owner-only permissions: provider choice, API keys, and the ChatGPT login if you used it.
- `cache/`: generated summaries, reviews, and file breakdowns, keyed by repo, PR, and head commit.
- `repos.json`: pinned repositories per account.

Two things leave your machine. GitHub API calls are made with your own token. The PR's diff, the full
contents of changed files, and any convention files are sent to the model provider you chose, once per
PR head. Nothing is sent anywhere else.

## Cost and speed

A summary is generated once per PR head and cached. Re-opening a PR is free; a new push costs one more
run. A large PR sends roughly 50K to 110K input tokens and gets back a few thousand, so budget on the order
of tens of cents to a dollar per run at mid-tier pricing, less on cheaper models. The **Effort** setting
maps to the provider's reasoning level; low is noticeably faster on big PRs.

Cold generation of a 40-file PR takes 30 to 80 seconds depending on model and effort. The page shows the
intent and architecture within a few seconds and fills in the rest as it streams. With pre-warm on, PRs
in your pinned repos are usually ready before you open them.

## Troubleshooting

- **"No GitHub login found."** Run `gh auth login`, then click refresh in the sidebar.
- **A repo you expect is missing from the sidebar.** The selected account cannot see it. Switch accounts
  in the picker.
- **"Not signed in to ChatGPT" or the model panel says no key.** Open Settings and finish the sign-in or
  paste a key. The sidebar footer always shows what is in use.
- **"Port 1455 is busy" when signing in with ChatGPT.** Another Codex sign-in or the Codex CLI holds the
  callback port. Close it, or use the device-code option.
- **Merge button disabled.** GitHub reports conflicts, an out-of-date branch, or a draft. "Blocked by
  branch protection" stays clickable for admins; the link opens GitHub's own explanation.
- **A summary looks off after a schema change.** Click "regenerate summary" at the top of the files list.
- **`pnpm start` says "already running".** Something is serving on the port, probably an earlier
  `pnpm dev`. It opens the browser to that instead of starting a second server.

## How it is built

Next.js App Router, TypeScript, Tailwind. GitHub via Octokit. Models via the Anthropic SDK and the
OpenAI SDK, with every pass requesting JSON that matches a zod schema so providers are interchangeable.

- `src/lib/accounts.ts`: GitHub identities from `gh`, selected per browser session.
- `src/lib/github.ts`: PR listing, details, file contents, checks, merge.
- `src/lib/llm.ts`: the single place a model is called, with Anthropic, OpenAI, Codex, and Kimi routes.
- `src/lib/summarize.ts`: prompt building, streaming generation, the on-disk cache, and the risk pass.
- `src/lib/filebreakdown.ts`: per-file purpose grouping.
- `src/lib/prewarm.ts`: the background poller.
- `src/lib/settings.ts` and `src/lib/codex-auth.ts`: model settings and the ChatGPT sign-in.

## Known limits

- Reviews are PR-level. Inline line comments are the obvious next step.
- The cache is per machine. Two teammates opening the same PR each pay for a run; a shared store is the
  planned fix.
- GitHub does not allow approving your own PR; the error surfaces in the review panel.
