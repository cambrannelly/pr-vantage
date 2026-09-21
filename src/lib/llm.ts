import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";

/**
 * One structured-output call, any provider. Anthropic is native; OpenAI, Kimi, and any
 * OpenAI-compatible endpoint (DeepSeek, Groq, OpenRouter, Ollama, Gemini's compat URL) go
 * through the OpenAI SDK with a base URL. Auth is always an API key: consumer subscriptions
 * (Claude Max, ChatGPT Plus) are not licensed for third-party tools.
 *
 * Env:
 *   PR_VANTAGE_PROVIDER   anthropic | openai | kimi | custom   (default: first provider with a key)
 *   PR_VANTAGE_MODEL      override the provider's default model
 *   PR_VANTAGE_EFFORT     low | medium | high                  (default medium)
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, KIMI_API_KEY (or MOONSHOT_API_KEY)
 *   PR_VANTAGE_LLM_BASE_URL + PR_VANTAGE_LLM_API_KEY           for custom
 */

export type Provider = "anthropic" | "openai" | "kimi" | "custom";
export type Effort = "low" | "medium" | "high";

export type LlmConfig = {
  provider: Provider;
  model: string;
  effort: Effort;
  apiKey: string | null;
  baseUrl: string | null;
  /** Env var to set when apiKey is missing. */
  keyVar: string;
};

const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-6-astra",
  kimi: "kimi-k3",
  custom: "",
};

const BASE_URL: Record<Provider, string | null> = {
  anthropic: null,
  openai: null,
  kimi: "https://api.moonshot.ai/v1",
  custom: null,
};

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function llmConfig(): LlmConfig {
  const explicit = env("PR_VANTAGE_PROVIDER")?.toLowerCase() as Provider | undefined;
  const keys: Record<Provider, { value: string | null; name: string }> = {
    anthropic: { value: env("ANTHROPIC_API_KEY"), name: "ANTHROPIC_API_KEY" },
    openai: { value: env("OPENAI_API_KEY"), name: "OPENAI_API_KEY" },
    kimi: { value: env("KIMI_API_KEY") ?? env("MOONSHOT_API_KEY"), name: "KIMI_API_KEY" },
    custom: { value: env("PR_VANTAGE_LLM_API_KEY"), name: "PR_VANTAGE_LLM_API_KEY" },
  };
  const provider: Provider =
    explicit && explicit in keys
      ? explicit
      : ((["anthropic", "openai", "kimi", "custom"] as Provider[]).find((p) => keys[p].value) ?? "anthropic");
  const effortRaw = env("PR_VANTAGE_EFFORT")?.toLowerCase();
  const effort: Effort = effortRaw === "low" || effortRaw === "high" ? effortRaw : "medium";
  return {
    provider,
    model: env("PR_VANTAGE_MODEL") ?? DEFAULT_MODEL[provider],
    effort,
    apiKey: keys[provider].value,
    baseUrl: provider === "custom" ? env("PR_VANTAGE_LLM_BASE_URL") : BASE_URL[provider],
    keyVar: keys[provider].name,
  };
}

export class LlmError extends Error {
  constructor(
    message: string,
    public kind: "config" | "auth" | "rate" | "api" | "schema" | "refusal",
    public status?: number,
  ) {
    super(message);
  }
}

export type StructuredResult<T> = {
  parsed: T;
  usage: { input: number; output: number };
  model: string;
};

export type StructuredRequest<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Identifier some providers require for the schema. */
  name: string;
  maxTokens: number;
  /** Raw text deltas of the JSON as it streams, for progressive rendering. */
  onText?: (delta: string) => void;
};

export async function generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const cfg = llmConfig();
  if (!cfg.apiKey) {
    throw new LlmError(`No ${cfg.provider} API key. Set ${cfg.keyVar} in .env.local and restart \`pnpm dev\`.`, "config", 401);
  }
  if (cfg.provider === "custom" && !cfg.baseUrl) {
    throw new LlmError("Custom provider needs PR_VANTAGE_LLM_BASE_URL (an OpenAI-compatible /v1 endpoint).", "config", 500);
  }
  if (!cfg.model) {
    throw new LlmError("Set PR_VANTAGE_MODEL for the custom provider.", "config", 500);
  }
  return cfg.provider === "anthropic" ? viaAnthropic(req, cfg) : viaOpenAICompatible(req, cfg);
}

/* ---------------- Anthropic ---------------- */

async function viaAnthropic<T>(req: StructuredRequest<T>, cfg: LlmConfig): Promise<StructuredResult<T>> {
  const client = new Anthropic({ apiKey: cfg.apiKey! });
  const stream = client.messages.stream({
    model: cfg.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    output_config: { format: zodOutputFormat(req.schema), effort: cfg.effort },
  });
  if (req.onText) stream.on("text", req.onText);

  let response;
  try {
    response = await stream.finalMessage();
  } catch (err) {
    throw mapAnthropicError(err);
  }
  if (response.stop_reason === "refusal") {
    throw new LlmError(`Model declined: ${response.stop_details?.explanation ?? "no explanation"}`, "refusal", 502);
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new LlmError("Model output did not match the schema.", "schema", 502);
  return {
    parsed,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    model: cfg.model,
  };
}

function mapAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.", "auth", 401);
  if (err instanceof Anthropic.RateLimitError) return new LlmError("Anthropic rate limit hit. Try again shortly.", "rate", 429);
  if (err instanceof Anthropic.APIError) return new LlmError(`Anthropic API error ${err.status}: ${err.message}`, "api", 502);
  if (err instanceof Error && /Could not resolve authentication/.test(err.message)) {
    return new LlmError("No Anthropic API key. Set ANTHROPIC_API_KEY in .env.local and restart `pnpm dev`.", "config", 401);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/* ---------------- OpenAI, Kimi, and anything OpenAI-compatible ---------------- */

/** Provider-specific knobs the Chat Completions call needs. Unknown endpoints get none, since many reject extras. */
function reasoningParams(cfg: LlmConfig): Record<string, unknown> {
  if (cfg.provider === "openai") return { reasoning_effort: cfg.effort };
  if (cfg.provider === "kimi") {
    // kimi-k3 takes reasoning_effort (low | high | max); the k2.x line takes a thinking object instead.
    if (/^kimi-k3/.test(cfg.model)) return { reasoning_effort: cfg.effort === "low" ? "low" : "high" };
    return { thinking: { type: cfg.effort === "low" ? "disabled" : "enabled" } };
  }
  return {};
}

async function viaOpenAICompatible<T>(req: StructuredRequest<T>, cfg: LlmConfig): Promise<StructuredResult<T>> {
  const client = new OpenAI({ apiKey: cfg.apiKey!, baseURL: cfg.baseUrl ?? undefined });
  const jsonSchema = z.toJSONSchema(req.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  const run = async (format: "json_schema" | "json_object") => {
    const system =
      format === "json_schema"
        ? req.system
        : `${req.system}\n\nRespond with a single JSON object matching this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`;
    const stream = await client.chat.completions.create({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: req.user },
      ],
      response_format:
        format === "json_schema"
          ? { type: "json_schema", json_schema: { name: req.name, schema: jsonSchema, strict: false } }
          : { type: "json_object" },
      max_completion_tokens: req.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...reasoningParams(cfg),
    });
    let text = "";
    let usage = { input: 0, output: 0 };
    let finish: string | null = null;
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        req.onText?.(delta);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
    }
    return { text, usage, finish };
  };

  let out;
  try {
    out = await run("json_schema");
  } catch (err) {
    // Some compatible endpoints reject json_schema; fall back to json_object with the schema in the prompt.
    if (err instanceof OpenAI.BadRequestError && /response_format|json_schema/i.test(err.message)) {
      out = await run("json_object").catch((e) => { throw mapOpenAIError(e, cfg); });
    } else {
      throw mapOpenAIError(err, cfg);
    }
  }
  if (out.finish === "content_filter") throw new LlmError("Model declined (content filter).", "refusal", 502);
  if (out.finish === "length") throw new LlmError("Model hit the output token limit before finishing.", "api", 502);

  let raw: unknown;
  try {
    raw = JSON.parse(out.text);
  } catch {
    throw new LlmError("Model returned malformed JSON.", "schema", 502);
  }
  const res = req.schema.safeParse(raw);
  if (!res.success) throw new LlmError(`Model output did not match the schema: ${res.error.issues[0]?.message ?? "invalid"}`, "schema", 502);
  return { parsed: res.data, usage: out.usage, model: cfg.model };
}

function mapOpenAIError(err: unknown, cfg: LlmConfig): Error {
  const label = cfg.provider === "custom" ? "LLM endpoint" : cfg.provider === "kimi" ? "Kimi" : "OpenAI";
  if (err instanceof OpenAI.AuthenticationError) return new LlmError(`${label} rejected the API key. Check ${cfg.keyVar}.`, "auth", 401);
  if (err instanceof OpenAI.RateLimitError) return new LlmError(`${label} rate limit hit. Try again shortly.`, "rate", 429);
  if (err instanceof OpenAI.APIError) return new LlmError(`${label} API error ${err.status}: ${err.message}`, "api", 502);
  return err instanceof Error ? err : new Error(String(err));
}
