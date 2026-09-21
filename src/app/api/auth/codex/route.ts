import { NextResponse } from "next/server";
import { codexCredential, DEVICE_VERIFICATION_URL, pollDeviceLogin, signOutCodex, startDeviceLogin, type CodexCredential, type DevicePending } from "@/lib/codex-auth";

/** Device logins in progress, by id. A dev server restart forgets them; the user just starts again. */
const pending = new Map<string, DevicePending>();
const PENDING_TTL_MS = 15 * 60_000;

function status(cred: CodexCredential | null) {
  return cred ? { signedIn: true, email: cred.email ?? null, plan: cred.planType ?? null } : { signedIn: false, email: null, plan: null };
}

export async function GET() {
  return NextResponse.json(status(await codexCredential().catch(() => null)), { headers: { "Cache-Control": "no-store" } });
}

/** `{}` starts a login and returns a code to enter; `{ id }` polls it. */
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  try {
    if (!id) {
      const p = await startDeviceLogin();
      const key = crypto.randomUUID();
      pending.set(key, p);
      for (const [k, v] of pending) if (Date.now() - v.startedAt > PENDING_TTL_MS) pending.delete(k);
      return NextResponse.json({ id: key, userCode: p.userCode, verificationUrl: DEVICE_VERIFICATION_URL, intervalSeconds: p.intervalSeconds });
    }
    const p = pending.get(id);
    if (!p) return NextResponse.json({ error: "That sign-in attempt expired. Start again." }, { status: 410 });
    const cred = await pollDeviceLogin(p);
    if (!cred) return NextResponse.json({ pending: true });
    pending.delete(id);
    return NextResponse.json({ pending: false, ...status(cred) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function DELETE() {
  await signOutCodex();
  return NextResponse.json({ signedIn: false, email: null, plan: null });
}
