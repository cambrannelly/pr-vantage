import { readSettings, writeSettings } from "./settings";

/**
 * ChatGPT subscription login for the OpenAI Codex backend, via the device-code flow.
 *
 * This reuses the OAuth client of OpenAI's own Codex CLI, the same approach pi and
 * opencode take. OpenAI has neither blessed nor blocked third-party use of it. The
 * settings page labels it "unofficial" for that reason.
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
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

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: json.authorization_code,
      code_verifier: json.code_verifier,
      redirect_uri: DEVICE_REDIRECT_URI,
    }),
  });
  const cred = toCredential(await readToken(tokenRes, "exchange"));
  await saveCredential(cred);
  return cred;
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
