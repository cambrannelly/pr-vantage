import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";
import { keyFor, PROVIDER_META, PROVIDERS, readSettings, type Effort, type Provider } from "./settings";
import { codexCredential } from "./codex-auth";

/**
 * One structured-output call, any provider. Anthropic is native; OpenAI, Kimi, and any
 * OpenAI-compatible endpoint (DeepSeek, Groq, OpenRouter, Ollama, Gemini's compat URL) go
 * through the OpenAI SDK with a base URL. Auth is always an API key: consumer subscriptions
 * (Claude Max, ChatGPT Plus) are not licensed for third-party tools.
 *
 * Configured on the /settings page, stored in data/settings.json.
 */

export type { Provider, Effort } from "./settings";

/** Which wire protocol a request takes. OpenAI splits by how it is paid for. */
export type Route = "anthropic" | "openai" | "codex" | "kimi";

export type LlmConfig = {
  /** Null until someone picks a provider on the Settings page. Nothing is assumed. */
  provider: Provider | null;
  route: Route | null;
  model: string;
  effort: Effort;
  /** API key, or on the codex route the current ChatGPT access token. */
  apiKey: string | null;
  baseUrl: string | null;
  /** ChatGPT account id, codex route only. */
  accountId?: string;
};

export const NO_PROVIDER_MESSAGE = "No LLM provider set. Choose one on the Settings page.";

/** Effective configuration from the settings store. */
export async function llmConfig(): Promise<LlmConfig> {
  const s = await readSettings();
  const effort = s.effort ?? "medium";
  const provider = s.provider && PROVIDERS.includes(s.provider) ? s.provider : null;
  if (!provider) return { provider: null, route: null, model: "", effort, apiKey: null, baseUrl: null };
  const meta = PROVIDER_META[provider];
  const route: Route = provider === "openai" && s.openaiAuth === "chatgpt" ? "codex" : provider;
  const base = { provider, route, model: s.model?.trim() || meta.defaultModel, effort };
  if (route === "codex") {
    const cred = await codexCredential().catch(() => null);
    return { ...base, apiKey: cred?.access ?? null, accountId: cred?.accountId, baseUrl: "https://chatgpt.com/backend-api" };
  }
  return { ...base, apiKey: keyFor(s, provider), baseUrl: meta.baseUrl };
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
  const cfg = await llmConfig();
  if (!cfg.provider || !cfg.route) throw new LlmError(NO_PROVIDER_MESSAGE, "config", 401);
  if (!cfg.apiKey) {
    throw new LlmError(
      cfg.route === "codex"
        ? "Not signed in to ChatGPT. Sign in on the Settings page."
        : `No ${PROVIDER_META[cfg.provider].label} API key. Add one on the Settings page.`,
      "config",
      401,
    );
  }
  if (!cfg.model) {
    throw new LlmError("Pick a model on the Settings page.", "config", 500);
  }
  if (cfg.route === "anthropic") return viaAnthropic(req, cfg);
  if (cfg.route === "codex") return viaCodex(req, cfg);
  return viaOpenAICompatible(req, cfg);
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
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("Anthropic rejected the API key. Check it on the Settings page.", "auth", 401);
  if (err instanceof Anthropic.RateLimitError) return new LlmError("Anthropic rate limit hit. Try again shortly.", "rate", 429);
  if (err instanceof Anthropic.APIError) return new LlmError(`Anthropic API error ${err.status}: ${err.message}`, "api", 502);
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
  const label = cfg.provider === "kimi" ? "Kimi" : "OpenAI";
  if (err instanceof OpenAI.AuthenticationError) return new LlmError(`${label} rejected the API key. Check it on the Settings page.`, "auth", 401);
  if (err instanceof OpenAI.RateLimitError) return new LlmError(`${label} rate limit hit. Try again shortly.`, "rate", 429);
  if (err instanceof OpenAI.APIError) return new LlmError(`${label} API error ${err.status}: ${err.message}`, "api", 502);
  return err instanceof Error ? err : new Error(String(err));
}

/* ---------------- ChatGPT subscription via the Codex backend ---------------- */

/**
 * The Codex backend speaks the Responses API over SSE. It is what Codex CLI talks to with a
 * ChatGPT login; the headers below mirror that client. `store` must be false.
 */
async function viaCodex<T>(req: StructuredRequest<T>, cfg: LlmConfig): Promise<StructuredResult<T>> {
  const jsonSchema = z.toJSONSchema(req.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const url = `${(cfg.baseUrl ?? "https://chatgpt.com/backend-api").replace(/\/+$/, "")}/codex/responses`;
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "chatgpt-account-id": cfg.accountId ?? "",
    originator: "pr-vantage",
    "OpenAI-Beta": "responses=experimental",
    accept: "text/event-stream",
    "content-type": "application/json",
  };

  const run = async (withFormat: boolean) => {
    const instructions = withFormat
      ? req.system
      : `${req.system}\n\nRespond with a single JSON object matching this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`;
    const body: Record<string, unknown> = {
      model: cfg.model,
      store: false,
      stream: true,
      instructions,
      input: [{ role: "user", content: [{ type: "input_text", text: req.user }] }],
      text: withFormat
        ? { verbosity: "low", format: { type: "json_schema", name: req.name, schema: jsonSchema, strict: false } }
        : { verbosity: "low" },
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: cfg.effort, summary: "auto" },
    };
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw await codexHttpError(res);
    if (!res.body) throw new LlmError("ChatGPT returned no response body.", "api", 502);

    let text = "";
    let usage = { input: 0, output: 0 };
    let completed = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      if (!line.startsWith("data:")) return;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") return;
      let ev: { type?: string; delta?: string; response?: { usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string; code?: string } }; error?: { message?: string; code?: string }; message?: string };
      try {
        ev = JSON.parse(raw);
      } catch {
        return;
      }
      switch (ev.type) {
        case "response.output_text.delta":
          if (ev.delta) {
            text += ev.delta;
            req.onText?.(ev.delta);
          }
          break;
        case "response.completed":
        case "response.done":
        case "response.incomplete":
          completed = true;
          usage = { input: ev.response?.usage?.input_tokens ?? 0, output: ev.response?.usage?.output_tokens ?? 0 };
          break;
        case "response.failed":
          throw new LlmError(`ChatGPT: ${ev.response?.error?.message ?? "response failed"}`, "api", 502);
        case "error":
          throw new LlmError(`ChatGPT: ${ev.error?.message ?? ev.message ?? "stream error"}`, "api", 502);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl).trimEnd());
        buf = buf.slice(nl + 1);
      }
    }
    if (buf.trim()) handle(buf.trim());
    if (!completed) throw new LlmError("ChatGPT stream ended before the response completed.", "api", 502);
    return { text, usage };
  };

  let out;
  try {
    out = await run(true);
  } catch (err) {
    // If this backend rejects text.format, ask for JSON in the prompt instead.
    if (err instanceof LlmError && err.status === 400 && /format|schema/i.test(err.message)) out = await run(false);
    else throw err;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(out.text);
  } catch {
    throw new LlmError("ChatGPT returned malformed JSON.", "schema", 502);
  }
  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) throw new LlmError(`ChatGPT output did not match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`, "schema", 502);
  return { parsed: parsed.data, usage: out.usage, model: cfg.model };
}

async function codexHttpError(res: Response): Promise<LlmError> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 300) || res.statusText;
  let kind: LlmError["kind"] = "api";
  try {
    const j = JSON.parse(text) as { error?: { code?: string; type?: string; message?: string; plan_type?: string; resets_at?: number } };
    const e = j.error;
    if (e) {
      const code = e.code || e.type || "";
      if (res.status === 429 || /usage_limit|usage_not_included|rate_limit/i.test(code)) {
        const plan = e.plan_type ? ` (${e.plan_type.toLowerCase()} plan)` : "";
        const mins = e.resets_at ? Math.max(0, Math.round((e.resets_at * 1000 - Date.now()) / 60_000)) : null;
        message = `You have hit your ChatGPT usage limit${plan}.${mins !== null ? ` Try again in about ${mins} min.` : ""}`;
        kind = "rate";
      } else {
        message = e.message ?? message;
      }
    }
  } catch {
    // not json
  }
  if (res.status === 401) return new LlmError("ChatGPT rejected the login. Sign in again on the Settings page.", "auth", 401);
  return new LlmError(`ChatGPT error ${res.status}: ${message}`, kind, res.status === 400 ? 400 : res.status === 429 ? 429 : 502);
}

/* ---------------- Model discovery for the settings page ---------------- */

/** Ask the provider which models this key can use. Doubles as a key check. */
export async function listModels(provider: Provider, apiKey: string): Promise<string[]> {
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
      return ids.sort();
    }
    const client = new OpenAI({ apiKey, baseURL: PROVIDER_META[provider].baseUrl ?? undefined });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    const chatty = provider === "openai" ? ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(embedding|tts|whisper|realtime|audio|image|transcribe|moderation|search)/.test(id)) : ids;
    return chatty.sort();
  } catch (err) {
    throw provider === "anthropic" ? mapAnthropicError(err) : mapOpenAIError(err, { provider, route: provider } as LlmConfig);
  }
}
