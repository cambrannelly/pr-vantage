#!/usr/bin/env node
/**
 * Start PR Vantage and open it in the browser.
 *
 *   pnpm start          production: builds if the build is missing or older than the source, then serves
 *   pnpm dev            development: hot-reloading server for working on the app itself
 *   --no-open           skip opening the browser (also PR_VANTAGE_NO_OPEN=1)
 *
 * If something is already serving on the port, this just opens the browser to it.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");
const noOpen = args.has("--no-open") || process.env.PR_VANTAGE_NO_OPEN === "1";
const port = Number(process.env.PORT ?? 4747);
const url = `http://localhost:${port}`;
const next = path.join(root, "node_modules", ".bin", "next");

function log(msg) {
  console.log(`\x1b[2m[pr-vantage]\x1b[0m ${msg}`);
}

async function alive() {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1500) });
    return res.status > 0;
  } catch {
    return false;
  }
}

function openBrowser() {
  if (noOpen) return;
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    spawn(cmd[0], cmd.slice(1), { stdio: "ignore", detached: true }).unref();
  } catch {
    log(`open ${url} in your browser`);
  }
}

/** Newest mtime under a directory, so a stale production build can be detected after a pull. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const m = entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}

function buildIsStale() {
  const id = path.join(root, ".next", "BUILD_ID");
  if (!existsSync(id)) return true;
  const built = statSync(id).mtimeMs;
  const sources = Math.max(newestMtime(path.join(root, "src")), statSync(path.join(root, "package.json")).mtimeMs);
  return sources > built;
}

if (await alive()) {
  log(`already running at ${url}`);
  openBrowser();
  process.exit(0);
}

if (!dev && buildIsStale()) {
  log("building (first run, or the source changed since the last build)…");
  execSync(`"${next}" build`, { cwd: root, stdio: "inherit" });
}

const child = spawn(next, dev ? ["dev", "-p", String(port)] : ["start", "-p", String(port)], { cwd: root, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));

for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await alive()) {
    log(`ready at ${url}`);
    openBrowser();
    break;
  }
}
