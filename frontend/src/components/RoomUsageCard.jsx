import { Activity, CircleHelp, PersonStanding } from "lucide-react";

const roomStates = {
  "NO PRESENCE": {
    title: "NO PRESENCE",
    description: "No person detected in the monitored area.",
    icon: CircleHelp,
    tone: "absent",
  },
  "PRESENCE DETECTED": {
    title: "PRESENCE DETECTED",
    description: "A person is detected in the monitored area.",
    icon: PersonStanding,
    tone: "present",
  },
  "MOTION DETECTED": {
    title: "MOTION DETECTED",
    description: "Movement is detected in the monitored area.",
    icon: Activity,
    tone: "motion",
  },
  UNKNOWN: {
    title: "OCCUPANCY UNKNOWN",
    description: "Waiting for fresh presence and motion telemetry.",
    icon: CircleHelp,
    tone: "unknown",
  },
};

export function RoomUsageCard({ roomUsage }) {
  const state = roomStates[roomUsage?.state] ?? roomStates.UNKNOWN;
  const Icon = state.icon;
  const observedAt = roomUsage?.last_observed_at
    ? new Date(roomUsage.last_observed_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "No occupancy reading";

  return (
    <section
      className={`room-usage room-usage--${state.tone}`}
      aria-live="polite"
      aria-label="Room usage state"
    >
      <span className="room-usage__icon">
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <div className="room-usage__copy">
        <span className="eyebrow">ROOM USAGE</span>
        <h2>{state.title}</h2>
        <p>
          {roomUsage?.absence_pending
            ? "No presence observed; confirming continuous absence for 1 minute before notification."
            : state.description}
        </p>
      </div>
      <div className="room-usage__meta">
        <span>{roomUsage?.sensor_id || "No sensor"}</span>
        <time>{observedAt}</time>
      </div>
    </section>
  );
}
