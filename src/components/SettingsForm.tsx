"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Effort, Provider, PROVIDER_META } from "@/lib/settings";

type KeyState = { set: boolean; hint: string | null };
type Meta = typeof PROVIDER_META;

const ORDER: Provider[] = ["anthropic", "openai", "kimi", "custom"];
const EFFORTS: { id: Effort; label: string; note: string }[] = [
  { id: "low", label: "Low", note: "fastest, cheapest" },
  { id: "medium", label: "Medium", note: "recommended" },
  { id: "high", label: "High", note: "deepest, slowest" },
];

export function SettingsForm({ initial, providers }: {
  initial: { provider: Provider; model: string; effort: Effort; customBaseUrl: string | null; keys: Record<Provider, KeyState> };
  providers: Meta;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [effort, setEffort] = useState<Effort>(initial.effort);
  const [baseUrl, setBaseUrl] = useState(initial.customBaseUrl ?? "");
  const [keys, setKeys] = useState(initial.keys);
  const [draftKey, setDraftKey] = useState<Partial<Record<Provider, string>>>({});
  const [models, setModels] = useState<Partial<Record<Provider, string[]>>>({});
  const [busy, setBusy] = useState<"verify" | "save" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const meta = providers[provider];
  const key = keys[provider];
  const draft = draftKey[provider] ?? "";
  const known = models[provider];
  const suggestedIds = meta.suggested.map((s) => s.id);
  const modelListed = suggestedIds.includes(model) || (known ?? []).includes(model);

  function pickProvider(p: Provider) {
    setProvider(p);
    setNote(null);
    // Switching providers switches to that provider's default model unless the user typed one already listed for it.
    const m = providers[p];
    if (!m.suggested.some((s) => s.id === model) && !(models[p] ?? []).includes(model)) setModel(m.defaultModel);
  }

  async function verify() {
    setBusy("verify");
    setNote(null);
    const res = await fetch("/api/settings/models", {
      method: "POST",
      body: JSON.stringify({ provider, apiKey: draft || undefined, baseUrl: provider === "custom" ? baseUrl : undefined }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setNote({ ok: false, text: json.error ?? "Could not reach the provider." });
    setModels((m) => ({ ...m, [provider]: json.models }));
    setNote({ ok: true, text: `Key works. ${json.models.length} model${json.models.length === 1 ? "" : "s"} available.` });
    if (!model && json.models.length) setModel(json.models[0]);
  }

  async function save() {
    setBusy("save");
    setNote(null);
    const patch: Record<string, unknown> = { provider, model, effort };
    if (provider === "custom") patch.customBaseUrl = baseUrl;
    const changed = Object.fromEntries(Object.entries(draftKey).filter(([, v]) => v && v.trim()));
    if (Object.keys(changed).length) patch.keys = changed;
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setNote({ ok: false, text: json.error ?? "Could not save." });
    setKeys(json.keys);
    setDraftKey({});
    setNote({ ok: true, text: `Saved. Summaries now use ${json.provider} · ${json.model}.` });
    router.refresh();
  }

  async function clearKey(p: Provider) {
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ keys: { [p]: null } }) });
    const json = await res.json();
    if (res.ok) {
      setKeys(json.keys);
      setDraftKey((d) => ({ ...d, [p]: "" }));
      setModels((m) => ({ ...m, [p]: undefined }));
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      {/* ---------- Provider ---------- */}
      <section className="reveal">
        <div className="eyebrow">Provider</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {ORDER.map((p) => {
            const k = keys[p];
            const on = p === provider;
            return (
              <button
                key={p}
                onClick={() => pickProvider(p)}
                className={`panel p-4 text-left transition ${on ? "!border-amber/60 !bg-amber/5" : "hover:!border-line-2"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{providers[p].label}</span>
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${k.set ? "bg-moss" : "bg-faint"}`} />
                </div>
                <div className="mono mt-1 text-[11px] text-muted">
                  {k.set ? `key saved ${k.hint}` : "no key yet"}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------- Key ---------- */}
      <section className="reveal" style={{ animationDelay: "40ms" }}>
        <div className="flex items-baseline justify-between gap-4">
          <div className="eyebrow">API key · {meta.label}</div>
          {meta.console && (
            <a href={meta.console} target="_blank" rel="noreferrer" className="mono text-[11px] text-muted hover:text-amber">get a key ↗</a>
          )}
        </div>
        <div className="panel mt-3 space-y-3 p-4">
          {provider === "custom" && (
            <div>
              <label className="mono mb-1 block text-[11px] text-muted">Base URL, OpenAI-compatible</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" className="mono !text-[13px]" />
            </div>
          )}
          <div>
            <label className="mono mb-1 block text-[11px] text-muted">
              {key.set ? `Replace the saved key ${key.hint}` : "Paste your API key"}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraftKey((d) => ({ ...d, [provider]: e.target.value }))}
                placeholder={key.set ? "leave blank to keep the current key" : "sk-…"}
                className="mono flex-1 !text-[13px]"
              />
              <button className="btn shrink-0" onClick={verify} disabled={busy !== null || (!draft && !key.set) || (provider === "custom" && !baseUrl)}>
                {busy === "verify" ? "Checking…" : "Verify & list models"}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 text-[12px] text-muted">
            <span>Keys are stored with owner-only permissions in <span className="mono">data/</span>, which is gitignored.</span>
            {key.set && (
              <button className="mono shrink-0 text-[11px] text-faint hover:text-rust" onClick={() => clearKey(provider)}>remove saved key</button>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Model ---------- */}
      <section className="reveal" style={{ animationDelay: "80ms" }}>
        <div className="flex items-baseline justify-between gap-4">
          <div className="eyebrow">Model</div>
          {known && <span className="mono text-[11px] text-faint">{known.length} from provider</span>}
        </div>
        <div className="mt-3 space-y-2">
          {meta.suggested.map((s) => (
            <ModelRow key={s.id} id={s.id} note={s.note} on={model === s.id} onPick={() => setModel(s.id)} />
          ))}
          {known && known.filter((id) => !suggestedIds.includes(id)).length > 0 && (
            <div className="panel flex items-center gap-3 p-3">
              <span className="mono text-[11px] text-muted">Others</span>
              <select value={modelListed && !suggestedIds.includes(model) ? model : ""} onChange={(e) => e.target.value && setModel(e.target.value)} className="!text-[13px]">
                <option value="">choose…</option>
                {known.filter((id) => !suggestedIds.includes(id)).map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
          )}
          <div className={`panel flex items-center gap-3 p-3 ${!modelListed && model ? "!border-amber/60" : ""}`}>
            <span className="mono shrink-0 text-[11px] text-muted">{meta.suggested.length ? "Or type one" : "Model id"}</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={meta.defaultModel || "model id exactly as the provider names it"} className="mono !text-[13px]" />
          </div>
        </div>
      </section>

      {/* ---------- Effort ---------- */}
      <section className="reveal" style={{ animationDelay: "120ms" }}>
        <div className="eyebrow">Effort</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {EFFORTS.map((e) => (
            <button key={e.id} onClick={() => setEffort(e.id)} className={`panel p-3 text-left transition ${effort === e.id ? "!border-amber/60 !bg-amber/5" : "hover:!border-line-2"}`}>
              <div className="font-medium">{e.label}</div>
              <div className="mono mt-0.5 text-[11px] text-muted">{e.note}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">Maps to each provider&apos;s reasoning setting. Lower effort cuts the wait on big PRs noticeably.</p>
      </section>

      {/* ---------- Save ---------- */}
      <section className="reveal flex flex-wrap items-center gap-4" style={{ animationDelay: "160ms" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy !== null || !model || (!key.set && !draft)}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {note && <span className={`text-[13px] ${note.ok ? "text-moss" : "text-rust"}`}>{note.text}</span>}
        {!key.set && !draft && <span className="text-[13px] text-muted">Add a key for {meta.label} to save.</span>}
      </section>
    </div>
  );
}

function ModelRow({ id, note, on, onPick }: { id: string; note: string; on: boolean; onPick: () => void }) {
  return (
    <button onClick={onPick} className={`panel flex w-full items-baseline gap-3 p-3 text-left transition ${on ? "!border-amber/60 !bg-amber/5" : "hover:!border-line-2"}`}>
      <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${on ? "bg-amber" : "border border-faint"}`} />
      <span className="mono text-[13px] text-ink">{id}</span>
      <span className="ml-auto text-[12px] text-muted">{note}</span>
    </button>
  );
}
