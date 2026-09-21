import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readSettings, writeSettings } from "./settings";

/**
 * ChatGPT subscription login for the OpenAI Codex backend.
 *
 * Two flows, both borrowed from OpenAI's own Codex CLI (the same approach pi and opencode take):
 *  - browser: PKCE authorization code, caught by a short-lived local server on port 1455, which is
 *    the redirect URI registered for that client. Works for every account.
 *  - device code: enter a code on openai.com. Needs "device code authorization for Codex" enabled
 *    in the account's ChatGPT security settings, so it is the fallback.
 * OpenAI has neither blessed nor blocked third-party use of either. The settings page says so.
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const BROWSER_REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const BROWSER_TIMEOUT_MS = 10 * 60_000;
const DEVICE_USER_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
export const DEVICE_VERIFICATION_URL = `${AUTH_BASE}/codex/device`;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
/** Refresh this long before the access token actually expires. */
const REFRESH_SKEW_MS = 5 * 60_000;

export type CodexCredential = {
  access: string;
  refresh: string;
  /** Epoch ms. */
  expires: number;
  accountId: string;
  email?: string;
  planType?: string;
};

export type DevicePending = {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
  startedAt: number;
};

type JwtPayload = {
  email?: string;
  [JWT_CLAIM_PATH]?: { chatgpt_account_id?: string; chatgpt_plan_type?: string };
  [k: string]: unknown;
};

function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split(".");
    return payload ? (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload) : null;
  } catch {
    return null;
  }
}

async function readToken(res: Response, op: string): Promise<{ access: string; refresh: string; expires: number; idToken?: string }> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ChatGPT token ${op} failed (${res.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error(`ChatGPT token ${op} response was missing fields.`);
  }
  return { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000, idToken: json.id_token };
}

function toCredential(t: { access: string; refresh: string; expires: number; idToken?: string }): CodexCredential {
  const access = decodeJwt(t.access);
  const auth = access?.[JWT_CLAIM_PATH];
  const accountId = auth?.chatgpt_account_id;
  if (!accountId) throw new Error("ChatGPT login succeeded but the token carried no account id.");
  const id = t.idToken ? decodeJwt(t.idToken) : null;
  return {
    access: t.access,
    refresh: t.refresh,
    expires: t.expires,
    accountId,
    email: (id?.email ?? access?.email) as string | undefined,
    planType: auth?.chatgpt_plan_type,
  };
}

/* ---------------- Browser flow ---------------- */

export type BrowserPending = {
  url: string;
  startedAt: number;
  /** Resolves with the credential once the callback lands, or rejects on failure or timeout. */
  done: Promise<CodexCredential>;
  cancel: () => void;
};

let activeServer: Server | null = null;

async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<CodexCredential> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, code_verifier: verifier, redirect_uri: redirectUri }),
  });
  const cred = toCredential(await readToken(res, "exchange"));
  await saveCredential(cred);
  return cred;
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0e0c;color:#efe9df;font:16px/1.5 system-ui">
<div style="max-width:420px;padding:32px;text-align:center"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="color:#9a8f7f;margin:0">${body}</p></div></body>`;
}

/**
 * Open a one-shot callback server on the port OpenAI's client is registered for, and build the
 * authorization URL. Only one attempt can run at a time because the port is fixed.
 */
export async function startBrowserLogin(): Promise<BrowserPending> {
  if (activeServer) {
    activeServer.close();
    activeServer = null;
  }
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", BROWSER_REDIRECT_URI);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "pr-vantage");

  let settle!: { resolve: (c: CodexCredential) => void; reject: (e: Error) => void };
  const done = new Promise<CodexCredential>((resolve, reject) => (settle = { resolve, reject }));
  done.catch(() => {}); // callers observe via poll; avoid an unhandled rejection if nobody is listening yet

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
    if (u.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }).end(page("Not found", "This address only handles the sign-in callback."));
      return;
    }
    if (u.searchParams.get("state") !== state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page("Sign-in mismatch", "This callback did not match the sign-in PR Vantage started. Try again from the Settings page."));
      return;
    }
    const code = u.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page("Sign-in cancelled", u.searchParams.get("error_description") ?? "OpenAI returned no authorization code."));
      settle.reject(new Error(u.searchParams.get("error_description") ?? "OpenAI returned no authorization code."));
      close();
      return;
    }
    try {
      const cred = await exchangeCode(code, verifier, BROWSER_REDIRECT_URI);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("Signed in", `PR Vantage is connected${cred.email ? ` as ${cred.email}` : ""}. You can close this tab.`));
      settle.resolve(cred);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end(page("Sign-in failed", msg));
      settle.reject(new Error(msg));
    }
    close();
  });

  const timer = setTimeout(() => {
    settle.reject(new Error("Sign-in timed out. Start again from the Settings page."));
    close();
  }, BROWSER_TIMEOUT_MS);

  function close() {
    clearTimeout(timer);
    if (activeServer === server) activeServer = null;
    server.close();
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          err.code === "EADDRINUSE"
            ? `Port ${CALLBACK_PORT} is busy, probably another Codex sign-in or Codex CLI. Close it, or use the device code option.`
            : `Could not open the sign-in callback: ${err.message}`,
        ),
      );
    });
    server.listen(CALLBACK_PORT, "127.0.0.1", () => resolve());
  });
  activeServer = server;

  return {
    url: url.toString(),
    startedAt: Date.now(),
    done,
    cancel: () => {
      settle.reject(new Error("Sign-in cancelled."));
      close();
    },
  };
}

/* ---------------- Device-code flow ---------------- */

/** Step 1: ask OpenAI for a user code. The person enters it at DEVICE_VERIFICATION_URL. */
export async function startDeviceLogin(): Promise<DevicePending> {
  const res = await fetch(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ChatGPT device login could not start (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as { device_auth_id?: string; user_code?: string; interval?: number | string };
  const interval = typeof json.interval === "string" ? Number(json.interval) : json.interval;
  if (!json.device_auth_id || !json.user_code) throw new Error("ChatGPT device login returned an unexpected response.");
  return { deviceAuthId: json.device_auth_id, userCode: json.user_code, intervalSeconds: Number.isFinite(interval) && interval! > 0 ? interval! : 5, startedAt: Date.now() };
}

/** Step 2: poll once. Returns null while the person has not finished in the browser. */
export async function pollDeviceLogin(p: DevicePending): Promise<CodexCredential | null> {
  const res = await fetch(DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id: p.deviceAuthId, user_code: p.userCode }),
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let code = "";
    try {
      const j = JSON.parse(text) as { error?: string | { code?: string } };
      code = typeof j.error === "object" ? j.error?.code ?? "" : j.error ?? "";
    } catch {
      // not json
    }
    if (/authorization_pending|slow_down/.test(code)) return null;
    throw new Error(`ChatGPT device login failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as { authorization_code?: string; code_verifier?: string };
  if (!json.authorization_code || !json.code_verifier) return null;
  return exchangeCode(json.authorization_code, json.code_verifier, DEVICE_REDIRECT_URI);
}

async function refresh(cred: CodexCredential): Promise<CodexCredential> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cred.refresh, client_id: CLIENT_ID }),
  });
  const next = toCredential(await readToken(res, "refresh"));
  await saveCredential({ ...next, email: next.email ?? cred.email, planType: next.planType ?? cred.planType });
  return next;
}

async function saveCredential(cred: CodexCredential | null) {
  const s = await readSettings();
  await writeSettings({ ...s, codex: cred ?? undefined });
}

/** The saved credential, refreshed if it is close to expiry. Null when not signed in. */
export async function codexCredential(): Promise<CodexCredential | null> {
  const cred = (await readSettings()).codex;
  if (!cred) return null;
  if (cred.expires - Date.now() > REFRESH_SKEW_MS) return cred;
  return refresh(cred);
}

export async function signOutCodex() {
  await saveCredential(null);
}
