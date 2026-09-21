import { SettingsForm } from "@/components/SettingsForm";
import { llmConfig } from "@/lib/llm";
import { keyFor, keyHint, PROVIDER_META, PROVIDERS, readSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await readSettings();
  const cfg = await llmConfig();
  const keys = Object.fromEntries(
    PROVIDERS.map((p) => {
      const k = keyFor(s, p);
      return [p, k.value ? { set: true as const, hint: keyHint(k.value), source: k.source } : { set: false as const, hint: null, source: null }];
    }),
  ) as Record<(typeof PROVIDERS)[number], { set: boolean; hint: string | null; source: "settings" | "env" | null }>;

  return (
    <div className="mx-auto max-w-3xl px-10 py-10">
      <header className="reveal">
        <div className="eyebrow">Settings</div>
        <h1 className="display mt-1 text-[38px] leading-none">Model</h1>
        <p className="mt-3 max-w-xl text-muted">
          Which model reads your pull requests, and the key that pays for it. Saved to{" "}
          <span className="mono text-ink-2">data/settings.json</span> on this machine only. Anything you leave blank falls
          back to <span className="mono text-ink-2">.env.local</span>.
        </p>
      </header>
      <div className="hairline my-8" />
      <SettingsForm
        initial={{ provider: cfg.provider, model: cfg.model, effort: cfg.effort, customBaseUrl: cfg.provider === "custom" ? cfg.baseUrl : s.customBaseUrl ?? null, keys }}
        providers={PROVIDER_META}
      />
    </div>
  );
}
