import { useQueryClient } from "@tanstack/react-query";
import { connectStrava, useDisconnectStrava, useStravaStatus } from "../lib/strava";
import { HealthConnectCard } from "./HealthConnectCard";
import { Badge, Button } from "./ui";

function Row({ icon, name, children, badge }: { icon: string; name: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-neutral-900">
      <span className="text-xl leading-none" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {name} {badge}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Strava + Garmin connection rows. `returnPath` is where OAuth sends you back to. */
export function Connections({ returnPath }: { returnPath: string }) {
  const qc = useQueryClient();
  const status = useStravaStatus();
  const disconnect = useDisconnectStrava(() => qc.invalidateQueries({ queryKey: ["strava"] }));
  const s = status.data;

  return (
    <div className="space-y-2">
      <Row icon="🟧" name="Strava" badge={s?.connected ? <Badge tone="accent">connected</Badge> : null}>
        {status.isPending ? (
          <p className="text-xs text-rock">Checking…</p>
        ) : !s?.configured ? (
          <p className="text-xs text-rock">
            Not set up yet: add <code>STRAVA_CLIENT_ID</code> and <code>STRAVA_CLIENT_SECRET</code> to <code>.dev.vars</code> (or as Worker
            secrets) and restart.
          </p>
        ) : s.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-rock">
              {s.athlete?.firstname ? `Signed in as ${s.athlete.firstname}. ` : ""}Activities, heart rate during sessions and current training load.
            </p>
            <Button variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-rock">Activities, heart rate during sessions, and your current training load.</p>
            <Button variant="secondary" onClick={() => connectStrava(returnPath)}>
              Connect Strava
            </Button>
          </div>
        )}
      </Row>
      <HealthConnectCard />
      <Row icon="⌚" name="Garmin" badge={<Badge>coming soon</Badge>}>
        <p className="text-xs text-rock">
          A direct Garmin connection (sleep, training readiness) is on the roadmap. Meanwhile, if Garmin Connect writes to Health
          Connect on your phone, its steps, resting heart rate and HRV arrive through the Android app.
        </p>
      </Row>
    </div>
  );
}
