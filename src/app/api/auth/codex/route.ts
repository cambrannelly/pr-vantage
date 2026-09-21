import { NextResponse } from "next/server";
import {
  codexCredential,
  DEVICE_VERIFICATION_URL,
  pollDeviceLogin,
  signOutCodex,
  startBrowserLogin,
  startDeviceLogin,
  type BrowserPending,
  type CodexCredential,
  type DevicePending,
} from "@/lib/codex-auth";

/** Sign-ins in progress, by id. A dev server restart forgets them; the user just starts again. */
type Attempt =
  | { mode: "device"; device: DevicePending; startedAt: number }
  | { mode: "browser"; browser: BrowserPending; startedAt: number; result: { cred?: CodexCredential; error?: string } };
const pending = new Map<string, Attempt>();
const PENDING_TTL_MS = 15 * 60_000;

function status(cred: CodexCredential | null) {
  return cred ? { signedIn: true, email: cred.email ?? null, plan: cred.planType ?? null } : { signedIn: false, email: null, plan: null };
}

function sweep() {
  for (const [k, v] of pending) if (Date.now() - v.startedAt > PENDING_TTL_MS) pending.delete(k);
}

export async function GET() {
  return NextResponse.json(status(await codexCredential().catch(() => null)), { headers: { "Cache-Control": "no-store" } });
}

/**
 * `{ mode: "browser" | "device" }` starts a sign-in (browser is the default).
 * `{ id }` polls it. `{ id, cancel: true }` abandons it.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; mode?: "browser" | "device"; cancel?: boolean };
  try {
    if (!body.id) {
      sweep();
      const key = crypto.randomUUID();
      if (body.mode === "device") {
        const device = await startDeviceLogin();
        pending.set(key, { mode: "device", device, startedAt: Date.now() });
        return NextResponse.json({ id: key, mode: "device", userCode: device.userCode, verificationUrl: DEVICE_VERIFICATION_URL, intervalSeconds: device.intervalSeconds });
      }
      const browser = await startBrowserLogin();
      const attempt: Attempt = { mode: "browser", browser, startedAt: Date.now(), result: {} };
      browser.done.then((cred) => (attempt.result.cred = cred)).catch((e: Error) => (attempt.result.error = e.message));
      pending.set(key, attempt);
      return NextResponse.json({ id: key, mode: "browser", url: browser.url });
    }

    const attempt = pending.get(body.id);
    if (!attempt) return NextResponse.json({ error: "That sign-in attempt expired. Start again." }, { status: 410 });
    if (body.cancel) {
      if (attempt.mode === "browser") attempt.browser.cancel();
      pending.delete(body.id);
      return NextResponse.json({ cancelled: true });
    }
    if (attempt.mode === "device") {
      const cred = await pollDeviceLogin(attempt.device);
      if (!cred) return NextResponse.json({ pending: true });
      pending.delete(body.id);
      return NextResponse.json({ pending: false, ...status(cred) });
    }
    if (attempt.result.error) {
      pending.delete(body.id);
      return NextResponse.json({ error: attempt.result.error }, { status: 502 });
    }
    if (!attempt.result.cred) return NextResponse.json({ pending: true });
    pending.delete(body.id);
    return NextResponse.json({ pending: false, ...status(attempt.result.cred) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function DELETE() {
  await signOutCodex();
  return NextResponse.json({ signedIn: false, email: null, plan: null });
}
