import { SettingsForm } from "@/components/SettingsForm";
import { llmConfig } from "@/lib/llm";
import { codexCredential } from "@/lib/codex-auth";
import { keyFor, keyHint, PROVIDER_META, PROVIDERS, readSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await readSettings();
  const cfg = await llmConfig();
  const codex = await codexCredential().catch(() => null);
  const keys = Object.fromEntries(
    PROVIDERS.map((p) => {
      const k = keyFor(s, p);
      return [p, k ? { set: true as const, hint: keyHint(k) } : { set: false as const, hint: null }];
    }),
  ) as Record<(typeof PROVIDERS)[number], { set: boolean; hint: string | null }>;

  return (
    <div className="mx-auto max-w-3xl px-10 py-10">
      <header className="reveal">
        <div className="eyebrow">Settings</div>
        <h1 className="display mt-1 text-[38px] leading-none">Model</h1>
        <p className="mt-3 max-w-xl text-muted">
          Which model reads your pull requests, and the key or login that pays for it. Saved to{" "}
          <span className="mono text-ink-2">data/settings.json</span> on this machine only, never committed.
        </p>
      </header>
      <div className="hairline my-8" />
      <SettingsForm
        initial={{
          provider: cfg.provider,
          model: cfg.model,
          effort: cfg.effort,
          customBaseUrl: s.customBaseUrl ?? null,
          keys,
          codex: codex ? { signedIn: true, email: codex.email ?? null, plan: codex.planType ?? null } : { signedIn: false, email: null, plan: null },
        }}
        providers={PROVIDER_META}
      />
    </div>
  );
}
