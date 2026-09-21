import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Model settings live in data/settings.json on this machine (gitignored, like .env.local).
 * Anything unset here falls back to the environment, so an env-only setup keeps working.
 */

export type Provider = "anthropic" | "openai" | "kimi" | "custom";
export type Effort = "low" | "medium" | "high";
export const PROVIDERS: Provider[] = ["anthropic", "openai", "kimi", "custom"];

export type Settings = {
  provider?: Provider;
  model?: string;
  effort?: Effort;
  keys?: Partial<Record<Provider, string>>;
  customBaseUrl?: string;
};

export const PROVIDER_META: Record<Provider, { label: string; keyVar: string; baseUrl: string | null; console: string | null; defaultModel: string; suggested: { id: string; note: string }[] }> = {
  anthropic: {
    label: "Anthropic",
    keyVar: "ANTHROPIC_API_KEY",
    baseUrl: null,
    console: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-5",
    suggested: [
      { id: "claude-sonnet-5", note: "recommended: fast, strong on code" },
      { id: "claude-opus-5", note: "deepest reasoning, slower and pricier" },
      { id: "claude-haiku-4-5-20251001", note: "cheapest, fine for small PRs" },
    ],
  },
  openai: {
    label: "OpenAI",
    keyVar: "OPENAI_API_KEY",
    baseUrl: null,
    console: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5.6-terra",
    suggested: [
      { id: "gpt-5.6-terra", note: "recommended: balanced" },
      { id: "gpt-6-astra", note: "most capable, slower and pricier" },
      { id: "gpt-5.6-luna", note: "cheapest" },
    ],
  },
  kimi: {
    label: "Kimi (Moonshot)",
    keyVar: "KIMI_API_KEY",
    baseUrl: "https://api.moonshot.ai/v1",
    console: "https://platform.kimi.ai/console/api-keys",
    defaultModel: "kimi-k2.6",
    suggested: [
      { id: "kimi-k2.6", note: "recommended: general purpose" },
      { id: "kimi-k3", note: "flagship reasoning" },
      { id: "kimi-k2.7-code", note: "code tuned" },
    ],
  },
  custom: {
    label: "OpenAI-compatible endpoint",
    keyVar: "PR_VANTAGE_LLM_API_KEY",
    baseUrl: null,
    console: null,
    defaultModel: "",
    suggested: [],
  },
};

const FILE = path.join(process.cwd(), "data", "settings.json");
let cached: Settings | null = null;

export async function readSettings(): Promise<Settings> {
  if (cached) return cached;
  try {
    cached = JSON.parse(await fs.readFile(FILE, "utf8")) as Settings;
  } catch {
    cached = {};
  }
  return cached;
}

export async function writeSettings(next: Settings): Promise<Settings> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

/** Merge a partial update. Keys: a string sets, null clears, undefined leaves alone. */
export async function updateSettings(patch: {
  provider?: Provider;
  model?: string;
  effort?: Effort;
  customBaseUrl?: string;
  keys?: Partial<Record<Provider, string | null>>;
}): Promise<Settings> {
  const cur = await readSettings();
  const keys = { ...(cur.keys ?? {}) };
  for (const [p, v] of Object.entries(patch.keys ?? {}) as [Provider, string | null | undefined][]) {
    if (v === null) delete keys[p];
    else if (typeof v === "string" && v.trim()) keys[p] = v.trim();
  }
  return writeSettings({
    provider: patch.provider ?? cur.provider,
    model: patch.model !== undefined ? patch.model.trim() || undefined : cur.model,
    effort: patch.effort ?? cur.effort,
    customBaseUrl: patch.customBaseUrl !== undefined ? patch.customBaseUrl.trim() || undefined : cur.customBaseUrl,
    keys,
  });
}

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/** The key for a provider: saved in settings first, then the environment. */
export function keyFor(s: Settings, p: Provider): { value: string | null; source: "settings" | "env" | null } {
  const saved = s.keys?.[p];
  if (saved) return { value: saved, source: "settings" };
  const fromEnv = p === "kimi" ? env("KIMI_API_KEY") ?? env("MOONSHOT_API_KEY") : env(PROVIDER_META[p].keyVar);
  return fromEnv ? { value: fromEnv, source: "env" } : { value: null, source: null };
}

/** Last four characters, for showing that a key exists without revealing it. */
export function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}
