import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { gh, type ChangedFile, type PullDetail } from "./github";
import { EFFORT, MODEL } from "./summarize";

const CACHE_DIR = path.join(process.cwd(), "data", "cache", "files");
const VERSION = "f1";

export const FileBreakdownSchema = z.object({
  purpose: z.string().describe("What this file is for in the system. One sentence."),
  groups: z
    .array(
      z.object({
        title: z.string().describe("Short imperative title for one purpose, e.g. 'Make executeWait transition the claim'."),
        what: z.string().describe("What changed, in terms of behavior or structure. 1-2 sentences."),
        why: z.string().describe("Why, as far as the PR reveals. One sentence. Say 'not stated' if unclear."),
        kind: z.enum(["behavior", "structure", "contract", "mechanical", "test"]),
        hunks: z.array(z.number().int()).describe("1-based hunk numbers from the diff that implement this purpose. Every hunk belongs to exactly one group."),
      }),
    )
    .describe("The file's changes grouped by purpose, most important first. 1-6 groups. Merge trivial hunks (imports, formatting) into one 'mechanical' group."),
});
export type FileBreakdown = z.infer<typeof FileBreakdownSchema>;

const SYSTEM = `You are explaining the changes in one file of a pull request to a reviewer who trusts the code's small details and wants to understand the purpose of each change. Group the diff hunks by purpose, not by position. Be concrete: name the functions, types, and values involved. Be brief. Never pad.`;

export function splitHunks(patch: string): string[] {
  const lines = patch.split("\n");
  const hunks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("@@")) hunks.push([line]);
    else if (hunks.length) hunks[hunks.length - 1].push(line);
  }
  return hunks.map((h) => h.join("\n"));
}

function cachePath(owner: string, repo: string, number: number, sha: string, filePath: string) {
  const h = createHash("sha1").update(filePath).digest("hex").slice(0, 12);
  return path.join(CACHE_DIR, `${owner}__${repo}__${number}__${sha}__${h}__${VERSION}.json`);
}

export async function readCachedBreakdown(owner: string, repo: string, number: number, sha: string, filePath: string): Promise<FileBreakdown | null> {
  try {
    return JSON.parse(await fs.readFile(cachePath(owner, repo, number, sha, filePath), "utf8"));
  } catch {
    return null;
  }
}

async function headContent(pr: PullDetail, file: ChangedFile): Promise<string | null> {
  if (file.status === "removed") return null;
  try {
    const { data } = await (await gh()).rest.repos.getContent({ owner: pr.headRepo.owner, repo: pr.headRepo.repo, path: file.path, ref: pr.headSha });
    if (!Array.isArray(data) && "content" in data && data.content) {
      const text = Buffer.from(data.content, "base64").toString("utf8");
      return text.length <= 40_000 ? text : null;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function generateFileBreakdown(owner: string, repo: string, pr: PullDetail, file: ChangedFile, force = false): Promise<FileBreakdown> {
  const cp = cachePath(owner, repo, pr.number, pr.headSha, file.path);
  if (force) await fs.rm(cp, { force: true });
  else {
    const cached = await readCachedBreakdown(owner, repo, pr.number, pr.headSha, file.path);
    if (cached) return cached;
  }
  if (!file.patch) {
    return { purpose: "No textual diff is available for this file.", groups: [] };
  }
  const hunks = splitHunks(file.patch);
  const full = await headContent(pr, file);

  const parts = [
    `# PR #${pr.number}: ${pr.title}`,
    pr.body.trim() ? `## PR description\n${pr.body.trim().slice(0, 4000)}` : "",
    `## File: ${file.path} (${file.status}, +${file.additions} -${file.deletions})`,
    ...hunks.map((h, i) => `### Hunk ${i + 1}\n\`\`\`diff\n${h}\n\`\`\``),
    full ? `## Full file at PR head\n\`\`\`\n${full}\n\`\`\`` : "",
  ].filter(Boolean);

  const client = new Anthropic();
  let response;
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
      output_config: { format: zodOutputFormat(FileBreakdownSchema), effort: EFFORT },
    });
  } catch (err) {
    if (err instanceof Error && /Could not resolve authentication/.test(err.message)) {
      throw new Error("No Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local and restart `pnpm dev`.");
    }
    throw err;
  }
  if (response.stop_reason === "refusal") throw new Error("Model declined to explain this file.");
  const out = response.parsed_output;
  if (!out) throw new Error("Model output did not match the file breakdown schema.");

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cp, JSON.stringify(out, null, 2));
  return out;
}
