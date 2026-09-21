import { execFileSync } from "node:child_process";
import { cookies } from "next/headers";
import { Octokit } from "@octokit/rest";

/**
 * GitHub identities the app can act as. Sourced from `gh auth` (every logged-in
 * account) plus GITHUB_TOKEN if set. The browser picks one via a cookie; the
 * pre-warm job iterates all of them.
 */
export type Account = {
  login: string;
  source: "gh" | "env";
  name?: string;
  avatarUrl?: string;
};

export const ACCOUNT_COOKIE = "pv_account";

const ENV_LOGIN_PLACEHOLDER = "__env__";
const tokens = new Map<string, string>();
let discovered: Account[] | null = null;
let ghDefault: string | null = null;

function ghAuthStatus(): string {
  try {
    return execFileSync("gh", ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (err) {
    // gh exits non-zero when any account is unhealthy but still prints the report.
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
  }
}

/** Parse `gh auth status` into logins, noting which one gh treats as active. */
function discoverGhAccounts(): { logins: string[]; active: string | null } {
  const out = ghAuthStatus();
  const logins: string[] = [];
  let active: string | null = null;
  let current: string | null = null;
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    const m = line.match(/Logged in to github\.com account (\S+)/);
    if (m) {
      current = m[1];
      logins.push(current);
      continue;
    }
    if (current && /Active account:\s*true/.test(line)) active = current;
  }
  return { logins, active };
}

function ghToken(login: string): string {
  const cached = tokens.get(login);
  if (cached) return cached;
  const token = execFileSync("gh", ["auth", "token", "-u", login], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  if (!token) throw new Error(`gh returned no token for ${login}`);
  tokens.set(login, token);
  return token;
}

async function whoami(token: string): Promise<{ login: string; name?: string; avatarUrl?: string }> {
  const { data } = await new Octokit({ auth: token }).rest.users.getAuthenticated();
  return { login: data.login, name: data.name ?? undefined, avatarUrl: data.avatar_url };
}

/** All usable accounts, resolved once per server process. */
export async function listAccounts(): Promise<Account[]> {
  if (discovered) return discovered;
  const found: Account[] = [];

  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken) {
    try {
      const me = await whoami(envToken);
      tokens.set(me.login, envToken);
      found.push({ login: me.login, source: "env", name: me.name, avatarUrl: me.avatarUrl });
    } catch {
      tokens.set(ENV_LOGIN_PLACEHOLDER, envToken);
      found.push({ login: ENV_LOGIN_PLACEHOLDER, source: "env", name: "GITHUB_TOKEN" });
    }
  }

  const { logins, active } = discoverGhAccounts();
  ghDefault = active;
  await Promise.all(
    logins.map(async (login) => {
      if (found.some((a) => a.login === login)) return;
      try {
        const token = ghToken(login);
        const me = await whoami(token).catch((): Awaited<ReturnType<typeof whoami>> => ({ login }));
        found.push({ login, source: "gh", name: me.name, avatarUrl: me.avatarUrl });
      } catch {
        // account listed but token unavailable; skip it
      }
    }),
  );

  found.sort((a, b) => a.login.localeCompare(b.login));
  discovered = found;
  return found;
}

/** Forget discovered accounts so the next call re-reads `gh auth status`. */
export function resetAccounts() {
  discovered = null;
  tokens.clear();
}

/** The account to use when nothing else is specified: env token, else gh's active login, else the first found. */
export async function defaultAccount(): Promise<Account> {
  const all = await listAccounts();
  if (all.length === 0) {
    throw new Error("No GitHub account. Run `gh auth login` or set GITHUB_TOKEN in .env.local, then restart `pnpm dev`.");
  }
  return all.find((a) => a.source === "env") ?? all.find((a) => a.login === ghDefault) ?? all[0];
}

/** The account the current browser session selected, falling back to the default. Safe outside a request. */
export async function currentAccount(): Promise<Account> {
  const all = await listAccounts();
  let chosen: string | undefined;
  try {
    chosen = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  } catch {
    // Not inside a request (background job, build step): use the default.
  }
  const match = chosen ? all.find((a) => a.login === chosen) : undefined;
  return match ?? defaultAccount();
}

export async function tokenFor(login: string): Promise<string> {
  await listAccounts();
  const cached = tokens.get(login);
  if (cached) return cached;
  return ghToken(login);
}
