import { z } from "zod";

export const LAYERS = ["ui", "api", "domain", "data", "infra", "config", "test", "other"] as const;

export const SummarySchema = z.object({
  intent: z.string().describe("One sentence, under 30 words: what this PR does and why. The reader has already seen the PR title, so do not restate it."),
  changes: z
    .array(
      z.object({
        title: z.string().describe("Short imperative title of one logical change, e.g. 'Introduce warranty validation'."),
        narrative: z.string().describe("What this change does and why. 1-2 sentences."),
        importance: z.enum(["high", "medium", "low"]).describe("high: design decisions or behavior the reviewer must understand. medium: worth reading. low: mechanical, supporting, generated, or boilerplate."),
        files: z.array(z.string()).describe("Files that implement this change. Every changed file belongs to exactly one change."),
        componentIds: z.array(z.string()).describe("Component ids involved."),
      }),
    )
    .describe("The PR told as an ordered story of 2-6 logical changes, most important first. Put all mechanical or supporting work (renames, imports, lockfiles, generated code, test scaffolding, docs) into a single low-importance change at the end."),
  components: z
    .array(
      z.object({
        id: z.string().describe("Short stable slug, e.g. 'order-service'."),
        name: z.string().describe("Human name, e.g. 'OrderService' or 'POST /orders'."),
        kind: z.enum(["module", "class", "function", "api-endpoint", "data-model", "migration", "config", "test", "ui-component", "job", "other"]),
        layer: z.enum(LAYERS),
        change: z.enum(["added", "modified", "removed", "unchanged"]).describe("'unchanged' marks an existing component that is NOT edited but is in the blast radius: it calls, or is called by, something that changed."),
        summary: z.string().describe("What changed about it, or for 'unchanged' nodes, why it is affected. One sentence."),
        files: z.array(z.string()).describe("File paths that implement this component. May be empty for 'unchanged' components outside the diff."),
      }),
    )
    .describe("The meaningful units of design in this PR: services, classes, endpoints, models, jobs. Group small helpers into their parent. Include 0-2 'unchanged' neighbors for blast radius. 3-8 items."),
  relationships: z
    .array(
      z.object({
        from: z.string().describe("component id"),
        to: z.string().describe("component id"),
        label: z.string().describe("One or two words, e.g. 'calls', 'persists to'."),
      }),
    )
    .describe("Directed edges between components that show how the design fits together."),
  files: z
    .array(
      z.object({
        path: z.string(),
        role: z.string().describe("What this file is for, 2-5 words."),
        summary: z.string().describe("What changed here. One short sentence."),
        attention: z.enum(["skim", "read", "scrutinize"]).describe("skim: routine/boilerplate. read: worth understanding. scrutinize: design-critical, subtle, or risky."),
      }),
    )
    .describe("One entry per changed file."),
  questions: z.array(z.string()).describe("Questions to ask the author about intent or design. 0-3, only if genuinely unclear."),
});

export type Summary = z.infer<typeof SummarySchema>;

/** The opinionated pass. Only runs when the reviewer asks for it. */
export const ReviewSchema = z.object({
  verdict: z.enum(["looks-good", "needs-discussion", "needs-changes"]),
  verdictReason: z.string().describe("One sentence naming the deciding factor."),
  risks: z
    .array(
      z.object({
        severity: z.enum(["high", "medium", "low"]),
        title: z.string(),
        detail: z.string().describe("What is wrong, where, and why it matters. 1-2 sentences citing symbols."),
        fix: z.string().describe("The concrete change that resolves it. One sentence."),
        files: z.array(z.string()),
      }),
    )
    .describe("Design or correctness concerns a senior reviewer would raise, most severe first. Empty if none."),
  nits: z.array(z.string()).describe("One-line mentions that could bite later. 0-3."),
});

export type Review = z.infer<typeof ReviewSchema>;
