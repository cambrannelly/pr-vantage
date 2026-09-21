"use client";

import { useEffect, useState } from "react";
import type { PrewarmStatus } from "@/lib/prewarm";

/** Live note on what the background pre-warm is doing for this repo. Silent when idle. */
export function PrewarmBadge({ owner, repo }: { owner: string; repo: string }) {
  const [status, setStatus] = useState<PrewarmStatus | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/prewarm", { cache: "no-store" });
        if (alive && res.ok) setStatus(await res.json());
      } catch {
        // dev server restarting; try again next round
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!status?.enabled) return null;
  const mine = (j: { owner: string; repo: string }) => j.owner === owner && j.repo === repo;
  const inFlight = status.inFlight.filter(mine);
  const queued = status.queued.filter(mine);
  if (inFlight.length === 0 && queued.length === 0) return null;

  return (
    <span className="mono inline-flex items-center gap-2 text-[12px] text-muted">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
      {inFlight.length > 0 ? `pre-warming #${inFlight[0].number}` : "pre-warm queued"}
      {queued.length > 0 && ` · ${queued.length} more`}
    </span>
  );
}
