import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Model settings live in data/settings.json on this machine (gitignored, owner-only). The
 * Settings page is the only way to change them; the environment is read once, on first run,
 * to import a key from an older setup.
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

export const PROVIDER_META: Record<Provider, { label: string; baseUrl: string | null; console: string | null; defaultModel: string; suggested: { id: string; note: string }[] }> = {
  anthropic: {
    label: "Anthropic",
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
    cached = await importFromEnv();
  }
  return cached;
}

/**
 * First run only: if no settings file exists but the environment carries a model key from an
 * older setup, copy it in so nothing breaks. After this, the environment is not consulted.
 */
async function importFromEnv(): Promise<Settings> {
  const env = (n: string) => process.env[n]?.trim() || undefined;
  const keys: Partial<Record<Provider, string>> = {};
  if (env("ANTHROPIC_API_KEY")) keys.anthropic = env("ANTHROPIC_API_KEY");
  if (env("OPENAI_API_KEY")) keys.openai = env("OPENAI_API_KEY");
  if (env("KIMI_API_KEY") ?? env("MOONSHOT_API_KEY")) keys.kimi = env("KIMI_API_KEY") ?? env("MOONSHOT_API_KEY");
  if (env("PR_VANTAGE_LLM_API_KEY")) keys.custom = env("PR_VANTAGE_LLM_API_KEY");
  if (Object.keys(keys).length === 0) return {};
  const provider = (PROVIDERS.find((p) => p === env("PR_VANTAGE_PROVIDER")?.toLowerCase()) ?? PROVIDERS.find((p) => keys[p]))!;
  const imported: Settings = {
    provider,
    model: env("PR_VANTAGE_MODEL"),
    effort: (["low", "medium", "high"] as Effort[]).find((e) => e === env("PR_VANTAGE_EFFORT")?.toLowerCase()),
    customBaseUrl: env("PR_VANTAGE_LLM_BASE_URL"),
    keys,
  };
  await writeSettings(imported);
  console.log(`[settings] imported ${Object.keys(keys).join(", ")} key(s) from the environment into data/settings.json`);
  return imported;
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

/** The saved key for a provider, if any. */
export function keyFor(s: Settings, p: Provider): string | null {
  return s.keys?.[p] ?? null;
}

/** Last four characters, for showing that a key exists without revealing it. */
export function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}
