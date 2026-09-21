import { defaultAccount } from "./accounts";
import { attachHeadContents, getPullDetail, listOpenPulls } from "./github";
import { listAllRepos } from "./repos";
import { generateSummary, readCachedSummary } from "./summarize";

/**
 * Background pre-warm. While the app is running it polls every pinned repo and
 * generates summaries for open PRs whose current head has none, so the page is
 * ready before anyone clicks. Pure local convenience: no webhook, no server.
 *
 * Env:
 *   PR_VANTAGE_PREWARM=off            disable
 *   PR_VANTAGE_PREWARM_INTERVAL=90    seconds between polls
 *   PR_VANTAGE_PREWARM_DAYS=7         only PRs updated within this many days
 *   PR_VANTAGE_PREWARM_CONCURRENCY=1  parallel generations
 */

type Job = { owner: string; repo: string; number: number; headSha: string; title: string; login: string };

export type PrewarmStatus = {
  enabled: boolean;
  intervalSeconds: number;
  lastTick: string | null;
  nextTick: string | null;
  polling: boolean;
  queued: Job[];
  inFlight: Job[];
  generated: number;
  failed: { key: string; error: string; at: string }[];
};

type State = {
  timer: ReturnType<typeof setInterval> | null;
  status: PrewarmStatus;
  queue: Job[];
  active: Map<string, Job>;
  /** SHAs that failed once; not retried until the head moves, so a bad PR cannot burn tokens every tick. */
  failedKeys: Set<string>;
  draining: boolean;
};

const KEY = Symbol.for("pr-vantage.prewarm");
const g = globalThis as unknown as { [KEY]?: State };

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function state(): State {
  if (!g[KEY]) {
    const intervalSeconds = envInt("PR_VANTAGE_PREWARM_INTERVAL", 90);
    g[KEY] = {
      timer: null,
      queue: [],
      active: new Map(),
      failedKeys: new Set(),
      draining: false,
      status: {
        enabled: process.env.PR_VANTAGE_PREWARM !== "off",
        intervalSeconds,
        lastTick: null,
        nextTick: null,
        polling: false,
        queued: [],
        inFlight: [],
        generated: 0,
        failed: [],
      },
    };
  }
  return g[KEY]!;
}

const jobKey = (j: Job) => `${j.owner}/${j.repo}#${j.number}@${j.headSha}`;

export function prewarmStatus(): PrewarmStatus {
  const s = state();
  return { ...s.status, queued: [...s.queue], inFlight: [...s.active.values()] };
}

/** Idempotent: safe to call on every server start and every hot reload. */
export function startPrewarm() {
  const s = state();
  if (!s.status.enabled || s.timer) return;
  const ms = s.status.intervalSeconds * 1000;
  s.timer = setInterval(() => void tick(), ms);
  s.timer.unref?.();
  s.status.nextTick = new Date(Date.now() + 5000).toISOString();
  setTimeout(() => void tick(), 5000).unref?.();
}

/** One poll: find PRs with no summary for their current head and queue them. */
export async function tick(): Promise<void> {
  const s = state();
  if (s.status.polling) return;
  s.status.polling = true;
  try {
    const fallback = await defaultAccount().catch(() => null);
    const repos = await listAllRepos();
    const maxAgeMs = envInt("PR_VANTAGE_PREWARM_DAYS", 7) * 86_400_000;
    for (const r of repos) {
      const login = r.account ?? fallback?.login;
      if (!login) continue;
      let pulls;
      try {
        pulls = await listOpenPulls(r.owner, r.repo, login);
      } catch (err) {
        recordFailure(s, `${r.owner}/${r.repo}`, err);
        continue;
      }
      for (const pr of pulls) {
        if (pr.draft) continue;
        if (Date.now() - new Date(pr.updatedAt).getTime() > maxAgeMs) continue;
        const job: Job = { owner: r.owner, repo: r.repo, number: pr.number, headSha: pr.headSha, title: pr.title, login };
        const key = jobKey(job);
        if (s.failedKeys.has(key) || s.active.has(key) || s.queue.some((q) => jobKey(q) === key)) continue;
        if (await readCachedSummary(r.owner, r.repo, pr.number, pr.headSha)) continue;
        s.queue.push(job);
      }
    }
  } finally {
    s.status.polling = false;
    s.status.lastTick = new Date().toISOString();
    s.status.nextTick = s.timer ? new Date(Date.now() + s.status.intervalSeconds * 1000).toISOString() : null;
  }
  void drain();
}

async function drain() {
  const s = state();
  if (s.draining) return;
  s.draining = true;
  const concurrency = envInt("PR_VANTAGE_PREWARM_CONCURRENCY", 1);
  try {
    const workers = Array.from({ length: concurrency }, async () => {
      for (;;) {
        const job = s.queue.shift();
        if (!job) return;
        const key = jobKey(job);
        s.active.set(key, job);
        try {
          const detail = await getPullDetail(job.owner, job.repo, job.number, job.login);
          if (detail.headSha !== job.headSha) continue; // moved on since we polled; next tick picks it up
          await attachHeadContents(detail, job.login);
          await generateSummary(job.owner, job.repo, detail, job.login);
          s.status.generated += 1;
          console.log(`[prewarm] ready ${key}`);
        } catch (err) {
          s.failedKeys.add(key);
          recordFailure(s, key, err);
        } finally {
          s.active.delete(key);
        }
      }
    });
    await Promise.all(workers);
  } finally {
    s.draining = false;
  }
}

function recordFailure(s: State, key: string, err: unknown) {
  const error = err instanceof Error ? err.message : String(err);
  console.warn(`[prewarm] failed ${key}: ${error}`);
  s.status.failed = [{ key, error, at: new Date().toISOString() }, ...s.status.failed].slice(0, 20);
}
