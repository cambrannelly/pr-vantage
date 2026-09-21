import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCOUNT_COOKIE, currentAccount, listAccounts, resetAccounts } from "@/lib/accounts";

export async function GET() {
  const [accounts, active] = await Promise.all([listAccounts(), currentAccount().catch(() => null)]);
  return NextResponse.json({ accounts, active: active?.login ?? null });
}

/** Switch the browser session to another GitHub identity. `refresh: true` re-reads `gh auth status` first. */
export async function POST(req: Request) {
  const { login, refresh } = (await req.json()) as { login?: string; refresh?: boolean };
  if (refresh) resetAccounts();
  const accounts = await listAccounts();
  if (login) {
    if (!accounts.some((a) => a.login === login)) {
      return NextResponse.json({ error: `Not logged in as ${login}. Run \`gh auth login\`.` }, { status: 404 });
    }
    (await cookies()).set(ACCOUNT_COOKIE, login, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  const active = await currentAccount();
  return NextResponse.json({ accounts, active: active.login });
}
