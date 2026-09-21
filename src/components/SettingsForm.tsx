"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Effort, OpenAIAuth, Provider, PROVIDER_META } from "@/lib/settings";

type KeyState = { set: boolean; hint: string | null };
type CodexState = { signedIn: boolean; email: string | null; plan: string | null };
type Meta = typeof PROVIDER_META;
type Choice = { provider: Provider | null; model: string; effort: Effort; openaiAuth: OpenAIAuth };

const ORDER: Provider[] = ["anthropic", "openai", "kimi"];
const EFFORTS: { id: Effort; label: string; note: string }[] = [
  { id: "low", label: "Low", note: "fastest, cheapest" },
  { id: "medium", label: "Medium", note: "recommended" },
  { id: "high", label: "High", note: "deepest, slowest" },
];

export function SettingsForm({ initial, providers }: {
  initial: {
    /** Null on a fresh install: nothing is assumed until the person picks. */
    provider: Provider | null; model: string; effort: Effort; openaiAuth: OpenAIAuth;
    keys: Record<Provider, KeyState>; codex: CodexState;
  };
  providers: Meta;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider | null>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [effort, setEffort] = useState<Effort>(initial.effort);
  const [openaiAuth, setOpenaiAuth] = useState<OpenAIAuth>(initial.openaiAuth);
  const [keys, setKeys] = useState(initial.keys);
  const [codex, setCodex] = useState<CodexState>(initial.codex);
  const [draftKey, setDraftKey] = useState<Partial<Record<Provider, string>>>({});
  const [models, setModels] = useState<Partial<Record<Provider, string[]>>>({});
  const [busy, setBusy] = useState<"verify" | "save" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  /** What is on disk right now, to tell "in use" from "not yet applied". */
  const [saved, setSaved] = useState<Choice>({ provider: initial.provider, model: initial.model, effort: initial.effort, openaiAuth: initial.openaiAuth });

  const meta = provider ? providers[provider] : null;
  const viaChatGPT = provider === "openai" && openaiAuth === "chatgpt";
  const draft = provider ? draftKey[provider] ?? "" : "";
  const pendingKey = !!draft.trim();
  const now: Choice = { provider, model, effort, openaiAuth };
  const dirty = pendingKey || differs(saved, now);
  /** Whether the selected provider is ready to be used: a key on file, a key typed, or a ChatGPT login. */
  const credentialed = !!provider && (viaChatGPT ? codex.signedIn : keys[provider].set || pendingKey);
  const known = provider ? models[provider] : undefined;
  const suggestedIds = meta?.suggested.map((s) => s.id) ?? [];
  const others = (known ?? []).filter((id) => !suggestedIds.includes(id));

  function pickProvider(p: Provider) {
    setProvider(p);
    setNote(null);
    const m = providers[p];
    if (!m.suggested.some((s) => s.id === model) && !(models[p] ?? []).includes(model)) setModel(m.defaultModel);
  }

  async function verify() {
    if (!provider) return;
    setBusy("verify");
    setNote(null);
    const res = await fetch("/api/settings/models", { method: "POST", body: JSON.stringify({ provider, apiKey: draft || undefined }) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setNote({ ok: false, text: json.error ?? "Could not reach the provider." });
    setModels((m) => ({ ...m, [provider]: json.models }));
    setNote({ ok: true, text: `Key works. ${json.models.length} model${json.models.length === 1 ? "" : "s"} available.` });
  }

  async function save() {
    if (!provider) return;
    setBusy("save");
    setNote(null);
    const patch: Record<string, unknown> = { provider, model, effort, openaiAuth };
    const changed = Object.fromEntries(Object.entries(draftKey).filter(([, v]) => v && v.trim()));
    if (Object.keys(changed).length) patch.keys = changed;
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setNote({ ok: false, text: json.error ?? "Could not save." });
    setKeys(json.keys);
    setDraftKey({});
    setSaved({ provider: json.provider, model: json.model, effort: json.effort, openaiAuth: json.openaiAuth });
    setNote({ ok: true, text: `Summaries now use ${json.model}${viaChatGPT ? " through your ChatGPT plan" : ""}.` });
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

  /** Dot colour: green for the provider summaries actually use, amber for one that is ready but idle, grey for none. */
  function cardStatus(p: Provider): { dot: string; text: string; inUse: boolean } {
    const chatgpt = p === "openai" && openaiAuth === "chatgpt";
    const ready = chatgpt ? codex.signedIn : keys[p].set;
    const inUse = ready && saved.provider === p;
    const dot = inUse ? "bg-moss" : ready ? "bg-amber" : "bg-faint";
    const text = chatgpt
      ? codex.signedIn ? `ChatGPT · ${codex.email ?? "signed in"}` : "ChatGPT · not signed in"
      : keys[p].set ? `key saved ${keys[p].hint}` : "no key yet";
    return { dot, text, inUse };
  }

  return (
    <div className="space-y-8">
      {/* ---------- Provider ---------- */}
      <section className="reveal">
        <div className="flex items-baseline justify-between gap-4">
          <div className="eyebrow">Provider</div>
          {!provider && <span className="mono text-[11px] text-amber">choose one to continue</span>}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {ORDER.map((p) => {
            const on = p === provider;
            const st = cardStatus(p);
            return (
              <button
                key={p}
                onClick={() => pickProvider(p)}
                className={`panel p-4 text-left transition ${on ? "!border-amber/60 !bg-amber/5" : "hover:!border-line-2"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{providers[p].label}</span>
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
                </div>
                <div className="mono mt-1 truncate text-[11px] text-muted">{st.text}</div>
                {st.inUse && <div className="mono mt-1.5 text-[10px] uppercase tracking-[0.14em] text-moss">in use</div>}
              </button>
            );
          })}
        </div>
      </section>

      {provider && meta && (
        <>
          {/* ---------- Credentials ---------- */}
          <section className="reveal" style={{ animationDelay: "40ms" }}>
            <div className="flex items-baseline justify-between gap-4">
              <div className="eyebrow">{viaChatGPT ? "ChatGPT account" : `API key · ${meta.label}`}</div>
              {!viaChatGPT && (
                <a href={meta.console} target="_blank" rel="noreferrer" className="mono text-[11px] text-muted hover:text-amber">get a key ↗</a>
              )}
            </div>

            {/* Once signed in with ChatGPT there is nothing to switch to; sign out brings the choice back. */}
            {provider === "openai" && !(viaChatGPT && codex.signedIn) && (
              <div className="mt-3 inline-flex rounded-lg border border-line-2 bg-bg p-1 text-[13px]">
                {(["key", "chatgpt"] as OpenAIAuth[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => { setOpenaiAuth(a); setNote(null); }}
                    className={`rounded-md px-3 py-1.5 transition ${openaiAuth === a ? "bg-bg-4 text-ink" : "text-muted hover:text-ink"}`}
                  >
                    {a === "key" ? "API key" : "ChatGPT subscription"}
                  </button>
                ))}
              </div>
            )}

            {viaChatGPT ? (
              <CodexLogin state={codex} onChange={(c) => { setCodex(c); router.refresh(); }} />
            ) : (
              <div className="panel mt-3 space-y-3 p-4">
                <div>
                  <label className="mono mb-1 block text-[11px] text-muted">
                    {keys[provider].set ? `Replace the saved key ${keys[provider].hint}` : "Paste your API key"}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      value={draft}
                      onChange={(e) => setDraftKey((d) => ({ ...d, [provider]: e.target.value }))}
                      placeholder={keys[provider].set ? "leave blank to keep the current key" : "sk-…"}
                      className="mono flex-1 !text-[13px]"
                    />
                    <button className="btn shrink-0" onClick={verify} disabled={busy !== null || !credentialed}>
                      {busy === "verify" ? "Checking…" : "Verify & list models"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 text-[12px] text-muted">
                  <span>Keys are stored with owner-only permissions in <span className="mono">data/</span>, which is gitignored.</span>
                  {keys[provider].set && (
                    <button className="mono shrink-0 text-[11px] text-faint hover:text-rust" onClick={() => clearKey(provider)}>remove saved key</button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ---------- Model ---------- */}
          <section className="reveal" style={{ animationDelay: "80ms" }}>
            <div className="flex items-baseline justify-between gap-4">
              <div className="eyebrow">Model</div>
              {known && <span className="mono text-[11px] text-faint">{known.length} available to this key</span>}
            </div>
            <div className="mt-3 space-y-2">
              {meta.suggested.map((s) => (
                <ModelRow key={s.id} id={s.id} note={s.note} on={model === s.id} onPick={() => setModel(s.id)} />
              ))}
              {others.length > 0 && (
                <div className={`panel flex items-center gap-3 p-3 ${others.includes(model) ? "!border-amber/60 !bg-amber/5" : ""}`}>
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${others.includes(model) ? "bg-amber" : "border border-faint"}`} />
                  <span className="mono shrink-0 text-[11px] text-muted">Others</span>
                  <select value={others.includes(model) ? model : ""} onChange={(e) => e.target.value && setModel(e.target.value)} className="!text-[13px]">
                    <option value="">choose…</option>
                    {others.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                </div>
              )}
            </div>
            {!viaChatGPT && !known && (
              <p className="mt-2 text-[12px] text-muted">Verify the key above to see every model it can use, beyond the suggestions.</p>
            )}
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

          {/* ---------- Apply ---------- */}
          <section className="reveal flex flex-wrap items-center gap-4" style={{ animationDelay: "160ms" }}>
            {dirty || !credentialed ? (
              <button className="btn btn-primary" onClick={save} disabled={busy !== null || !model || !credentialed}>
                {busy === "save" ? "Applying…" : pendingKey && !differs(saved, now) ? "Save key" : `Use ${model}`}
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 text-[13px] text-moss">
                <span className="inline-block h-2 w-2 rounded-full bg-moss" />
                <span className="mono">{model}</span> is in use
              </span>
            )}
            {note && <span className={`text-[13px] ${note.ok ? "text-moss" : "text-rust"}`}>{note.text}</span>}
            {!credentialed && (
              <span className="text-[13px] text-muted">{viaChatGPT ? "Sign in to ChatGPT first." : `Add a key for ${meta.label} first.`}</span>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** True when the provider, model, effort, or OpenAI auth mode differs from what is saved. */
function differs(saved: Choice, now: Choice): boolean {
  return saved.provider !== now.provider || saved.model !== now.model || saved.effort !== now.effort || (now.provider === "openai" && saved.openaiAuth !== now.openaiAuth);
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

type Attempt =
  | { id: string; mode: "browser"; url: string }
  | { id: string; mode: "device"; userCode: string; verificationUrl: string; intervalSeconds: number };

const CHATGPT_SECURITY_SETTINGS = "https://chatgpt.com/#settings/Security";

/**
 * ChatGPT sign-in against the same OAuth client OpenAI's Codex CLI uses. Browser flow by default;
 * device code as the fallback. Polls until the account appears.
 */
function CodexLogin({ state, onChange }: { state: CodexState; onChange: (c: CodexState) => void }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function start(mode: "browser" | "device") {
    if (timer.current) clearTimeout(timer.current);
    if (attempt) fetch("/api/auth/codex", { method: "POST", body: JSON.stringify({ id: attempt.id, cancel: true }) }).catch(() => {});
    setBusy(true);
    setError(null);
    setAttempt(null);
    const res = await fetch("/api/auth/codex", { method: "POST", body: JSON.stringify({ mode }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Could not start sign-in.");
    setAttempt(json);
    window.open(json.mode === "browser" ? json.url : json.verificationUrl, "_blank", "noopener");
    poll(json.id, json.mode === "browser" ? 2000 : Math.max(3, json.intervalSeconds) * 1000);
  }

  function poll(id: string, everyMs: number) {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/auth/codex", { method: "POST", body: JSON.stringify({ id }) });
        const json = await res.json();
        if (!res.ok) { setError(json.error ?? "Sign-in failed."); setAttempt(null); return; }
        if (json.pending) return poll(id, everyMs);
        setAttempt(null);
        onChange({ signedIn: true, email: json.email ?? null, plan: json.plan ?? null });
      } catch {
        poll(id, everyMs);
      }
    }, everyMs);
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    if (attempt) fetch("/api/auth/codex", { method: "POST", body: JSON.stringify({ id: attempt.id, cancel: true }) }).catch(() => {});
    setAttempt(null);
  }

  async function signOut() {
    await fetch("/api/auth/codex", { method: "DELETE" });
    onChange({ signedIn: false, email: null, plan: null });
  }

  return (
    <div className="panel mt-3 space-y-3 p-4">
      {state.signedIn ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-moss" />
              <span className="font-medium">{state.email ?? "Signed in"}</span>
              {state.plan && <span className="tag">{state.plan.toLowerCase()}</span>}
            </div>
            <p className="mt-1 text-[12px] text-muted">Summaries draw on this plan&apos;s Codex usage rather than an API bill.</p>
          </div>
          <button className="mono text-[11px] text-faint hover:text-rust" onClick={signOut}>sign out</button>
        </div>
      ) : attempt?.mode === "browser" ? (
        <div>
          <div className="text-[13px] text-ink-2">Finish signing in on the OpenAI tab that opened. This page updates on its own.</div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
            Waiting for the browser…
            <a href={attempt.url} target="_blank" rel="noreferrer" className="mono text-muted hover:text-amber">reopen the sign-in page ↗</a>
            <button className="mono text-[11px] text-faint hover:text-ink" onClick={() => start("device")}>use a device code instead</button>
            <button className="mono text-[11px] text-faint hover:text-ink" onClick={cancel}>cancel</button>
          </div>
        </div>
      ) : attempt?.mode === "device" ? (
        <div>
          <div className="text-[13px] text-ink-2">Enter this code on the page that opened, then approve access.</div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <span className="display select-all text-[34px] leading-none tracking-[0.12em] text-amber">{attempt.userCode}</span>
            <a href={attempt.verificationUrl} target="_blank" rel="noreferrer" className="mono text-[12px] text-muted hover:text-amber">
              {attempt.verificationUrl.replace("https://", "")} ↗
            </a>
          </div>
          <p className="mt-3 text-[12px] text-muted">
            If OpenAI says device code authorization is off, enable it under{" "}
            <a href={CHATGPT_SECURITY_SETTINGS} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-[3px] hover:text-amber">ChatGPT Security Settings</a>{" "}
            and try again, or go back to the browser sign-in, which does not need it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
            Waiting for approval…
            <button className="mono text-[11px] text-faint hover:text-ink" onClick={() => start("browser")}>use the browser instead</button>
            <button className="mono text-[11px] text-faint hover:text-ink" onClick={cancel}>cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" onClick={() => start("browser")} disabled={busy}>{busy ? "Starting…" : "Sign in with ChatGPT"}</button>
          <button className="mono text-[11px] text-muted hover:text-ink" onClick={() => start("device")} disabled={busy}>or use a device code</button>
          <span className="ml-auto text-[12px] text-muted">Plus, Pro, or Team plan with Codex access.</span>
        </div>
      )}
      {error && <p className="text-[12px] text-rust">{error}</p>}
      <p className="border-t border-line pt-3 text-[12px] leading-snug text-muted">
        <span className="text-amber">Unofficial.</span> This signs in through the OAuth client of OpenAI&apos;s own Codex CLI and talks to
        the Codex backend, the same way tools like pi and opencode do. OpenAI has neither approved nor blocked third-party use of it.
        If they change their mind this stops working, so prefer an API key for anything you cannot afford to have interrupted.
      </p>
    </div>
  );
}
