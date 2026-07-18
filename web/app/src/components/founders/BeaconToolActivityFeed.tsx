import type { BeaconStatus, BeaconToolActivity } from "@/lib/founders/types";

const PHASE_LABEL: Record<BeaconToolActivity["phase"], string> = {
  started: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function BeaconToolActivityFeed({ tools, status }: { tools: BeaconToolActivity[]; status: BeaconStatus }) {
  if (tools.length === 0) return null;
  return (
    <section className="mb-8" aria-label="Live agent tool activity" aria-live="polite" aria-busy={status === "connecting" || status === "streaming"}>
      <p className="mb-3 font-mono text-[0.6rem] tracking-[0.2em] text-silver-500 uppercase">Agent activity</p>
      <ol className="space-y-2">
        {tools.map((activity) => (
          <li key={activity.invocationId} className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${activity.phase === "failed" ? "bg-red-400" : activity.phase === "completed" ? "bg-emerald-400" : "bg-silver-100 motion-safe:animate-pulse"}`} />
            <span className="min-w-0 flex-1 truncate text-xs text-silver-200">
              <span className="text-silver-50">{activity.agent.name}</span>
              <span className="ml-1 font-mono text-silver-500">({activity.agent.slug})</span>
              <span className="mx-2 text-silver-600">/</span>
              <span className="font-mono">{activity.tool.slug}</span>
              {activity.action.slug !== activity.tool.slug ? <span className="font-mono text-silver-500"> → {activity.action.slug}</span> : null}
            </span>
            <span className="shrink-0 font-mono text-[0.6rem] tracking-wide text-silver-500 uppercase">
              {PHASE_LABEL[activity.phase]}{activity.elapsedMs !== undefined ? ` · ${activity.elapsedMs} ms` : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
