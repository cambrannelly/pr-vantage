import Anthropic from "@anthropic-ai/sdk";
import { Allow, parse as parsePartial } from "partial-json";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ModelSummarySchema, ReviewSchema, resolveSummary, type Review, type Summary } from "./schema";
import { getRepoGuidance, type PullDetail } from "./github";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const MAX_PATCH_CHARS = 12_000;
const MAX_TOTAL_CHARS = 450_000;

export const SYSTEM = `You are a principal engineer reviewing a pull request for a colleague who trusts AI-generated code to get the small things right. They do not want to read every line. They want to understand the architecture, the design decisions, and the intent, and to know exactly which files deserve their scrutiny.

Tell the PR as a story: system and architecture first, then the behavioral changes in order of importance, then suspicious patterns, and only then the mechanics. Group mechanical work (renames, imports, lockfiles, generated code, boilerplate, test scaffolding) into one low-importance change so it stays out of the way.

Describe, do not judge. This pass explains the change so the reviewer understands it. Do not list risks, bugs, or fixes here; a separate review pass does that when asked. Questions for the author are fine when intent is genuinely unclear.

Show blast radius: include a few existing components that are not edited but depend on, or are depended on by, what changed, marked 'unchanged'.

If the repository provides architecture notes or rules, treat them as the team's conventions and judge the PR against them explicitly.

Be brief. The reader wants the shape of the change in under a minute of reading: aim for well under 500 words of prose across the whole response. Name real components from the code. Prefer concrete nouns over adjectives. Never pad, never enumerate every step. When the PR is trivial, say so briefly and mark everything as skim.

Component ids in relationships and changes must match ids in components. Files are referred to by the bracketed index from the numbered file list, never by path. Every changed file index must appear in files exactly once and in exactly one change.

Emit the keys in schema order: intent, components, relationships, changes, questions, files. The reader sees intent and the architecture first while the rest is still arriving.`;

export const MODEL = process.env.PR_VANTAGE_MODEL?.trim() || "claude-opus-5";
export const EFFORT = (process.env.PR_VANTAGE_EFFORT?.trim() || "medium") as "low" | "medium" | "high";

const SCHEMA_VERSION = "v6";
const REVIEW_VERSION = "r1";

export const REVIEW_SYSTEM = `You are a principal engineer doing the opinionated review pass on a pull request. The reviewer has already read an architecture summary of it and now wants to know what is risky and what to fix.

Focus on architecture and correctness rather than implementation detail. Flag: new service or module dependencies, violations of existing abstractions, duplicated business logic, changes in data ownership, direct database or external access that bypasses established layers, inconsistent patterns versus the surrounding code, new or changed API contracts, auth or security boundary changes, missing failure handling on new boundaries, and unnecessary architectural complexity. Do not comment on style or minor implementation choices unless they introduce a bug.

If the repository provides architecture notes or rules, judge the PR against them explicitly and say which rule applies.

Be brief: at most 5 risks, one or two sentences each, one-sentence fixes. Cite file paths and symbol names. If there is nothing worth raising, return an empty risks list and say so in the verdict reason. Never invent a concern to fill space.`;

function cachePath(owner: string, repo: string, number: number, sha: string) {
  return path.join(CACHE_DIR, `${owner}__${repo}__${number}__${sha}__${SCHEMA_VERSION}.json`);
}
function reviewCachePath(owner: string, repo: string, number: number, sha: string) {
  return path.join(CACHE_DIR, `${owner}__${repo}__${number}__${sha}__${REVIEW_VERSION}.json`);
}

export async function readCachedReview(owner: string, repo: string, number: number, sha: string): Promise<Review | null> {
  try {
    return JSON.parse(await fs.readFile(reviewCachePath(owner, repo, number, sha), "utf8"));
  } catch {
    return null;
  }
}

export async function clearCachedReview(owner: string, repo: string, number: number, sha: string) {
  await fs.rm(reviewCachePath(owner, repo, number, sha), { force: true });
}

export async function clearCachedSummary(owner: string, repo: string, number: number, sha: string) {
  await fs.rm(cachePath(owner, repo, number, sha), { force: true });
}

export async function readCachedSummary(owner: string, repo: string, number: number, sha: string): Promise<Summary | null> {
  try {
    return JSON.parse(await fs.readFile(cachePath(owner, repo, number, sha), "utf8"));
  } catch {
    return null;
  }
}

export function buildPrompt(pr: PullDetail, guidance: { path: string; text: string }[] = []): string {
  const parts: string[] = [];
  parts.push(`# PR #${pr.number}: ${pr.title}`);
  if (guidance.length > 0) {
    parts.push(
      "## Repository architecture notes and rules\n" +
        guidance.map((g) => `### ${g.path}\n${g.text}`).join("\n\n"),
    );
  }
  parts.push(`Author: ${pr.author}\nBranch: ${pr.headRef} -> ${pr.baseRef}\nStats: +${pr.additions} -${pr.deletions} across ${pr.files.length} files`);
  if (pr.body.trim()) parts.push(`## Author's description\n${pr.body.trim()}`);

  parts.push(
    `## Changed files (refer to files by the bracketed index)\n` +
      pr.files.map((f, i) => `- [${i}] ${f.status.padEnd(8)} ${f.path} (+${f.additions} -${f.deletions})`).join("\n"),
  );

  let budget = MAX_TOTAL_CHARS;
  for (const [i, f] of pr.files.entries()) {
    const section: string[] = [`## File [${i}]: ${f.path} (${f.status})`];
    if (f.patch) {
      const patch = f.patch.length > MAX_PATCH_CHARS ? f.patch.slice(0, MAX_PATCH_CHARS) + "\n... [patch truncated]" : f.patch;
      section.push("### Diff\n```diff\n" + patch + "\n```");
    } else {
      section.push("### Diff\n(no textual diff available: binary, generated, or too large)");
    }
    if (f.headContent && f.status !== "added") {
      section.push("### Full file at PR head\n```\n" + f.headContent + "\n```");
    }
    const text = section.join("\n");
    if (text.length > budget) {
      parts.push(`## File [${i}]: ${f.path} (${f.status})\n(omitted for size)`);
      continue;
    }
    budget -= text.length;
    parts.push(text);
  }
  return parts.join("\n\n");
}

export type PartialListener = (partial: Summary) => void;

type InFlight = { promise: Promise<Summary>; latest: Summary | null; listeners: Set<PartialListener> };

/** One generation per PR head at a time, so a page load and the pre-warm job never pay twice for the same SHA. */
const inFlight = new Map<string, InFlight>();

/**
 * Generate (or join an in-progress generation of) the summary. `onPartial` receives
 * progressively resolved snapshots as the model streams, so the UI can render the
 * intent and architecture while files are still arriving.
 */
export async function generateSummary(owner: string, repo: string, pr: PullDetail, login?: string, onPartial?: PartialListener): Promise<Summary> {
  const cached = await readCachedSummary(owner, repo, pr.number, pr.headSha);
  if (cached) return cached;

  const key = `${owner}/${repo}#${pr.number}@${pr.headSha}`;
  let entry = inFlight.get(key);
  if (!entry) {
    const e: InFlight = { promise: Promise.resolve(null as unknown as Summary), latest: null, listeners: new Set() };
    e.promise = generateSummaryUncached(owner, repo, pr, login, (partial) => {
      e.latest = partial;
      for (const l of e.listeners) l(partial);
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, e);
    entry = e;
  }
  if (onPartial) {
    entry.listeners.add(onPartial);
    if (entry.latest) onPartial(entry.latest);
    return entry.promise.finally(() => entry!.listeners.delete(onPartial));
  }
  return entry.promise;
}

const PARTIAL_INTERVAL_MS = 400;

async function generateSummaryUncached(owner: string, repo: string, pr: PullDetail, login?: string, onPartial?: PartialListener): Promise<Summary> {
  const guidance = await getRepoGuidance(owner, repo, pr.baseRef, login);
  const paths = pr.files.map((f) => f.path);
  const client = new Anthropic();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(pr, guidance) }],
    output_config: { format: zodOutputFormat(ModelSummarySchema), effort: EFFORT },
  });

  if (onPartial) {
    let text = "";
    let last = 0;
    stream.on("text", (delta) => {
      text += delta;
      const now = Date.now();
      if (now - last < PARTIAL_INTERVAL_MS) return;
      last = now;
      try {
        onPartial(resolveSummary(parsePartial(text, Allow.ALL), paths, { partial: true }));
      } catch {
        // half-written JSON that even the tolerant parser rejects; the next delta will do
      }
    });
  }

  const started = Date.now();
  let response;
  try {
    response = await stream.finalMessage();
  } catch (err) {
    mapAuthError(err);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[summary] ${owner}/${repo}#${pr.number} ${MODEL} effort=${EFFORT} in=${response.usage.input_tokens} out=${response.usage.output_tokens} ${secs}s`);
  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined to summarize: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  const raw = response.parsed_output;
  if (!raw) throw new Error("Model returned output that did not match the summary schema.");
  const summary = resolveSummary(raw, paths);

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(owner, repo, pr.number, pr.headSha), JSON.stringify(summary, null, 2));
  return summary;
}

function mapAuthError(err: unknown): never {
  if (err instanceof Error && /Could not resolve authentication/.test(err.message)) {
    throw new Error("No Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local and restart `pnpm dev`.");
  }
  throw err;
}

export async function generateReview(owner: string, repo: string, pr: PullDetail, summary: Summary | null): Promise<Review> {
  const cached = await readCachedReview(owner, repo, pr.number, pr.headSha);
  if (cached) return cached;

  const guidance = await getRepoGuidance(owner, repo, pr.baseRef);
  const prompt =
    buildPrompt(pr, guidance) +
    (summary ? `\n\n# Architecture summary already shown to the reviewer\n${JSON.stringify(summary, null, 2)}` : "");

  const client = new Anthropic();
  let response;
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: REVIEW_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(ReviewSchema), effort: EFFORT },
    });
  } catch (err) {
    mapAuthError(err);
  }
  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined to review: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  const review = response.parsed_output;
  if (!review) throw new Error("Model returned output that did not match the review schema.");

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(reviewCachePath(owner, repo, pr.number, pr.headSha), JSON.stringify(review, null, 2));
  return review;
}
