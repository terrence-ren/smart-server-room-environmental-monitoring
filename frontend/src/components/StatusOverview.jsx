import {
  AlertTriangle,
  CircleCheck,
  CircleHelp,
  ShieldAlert,
} from "lucide-react";

const statusDetails = {
  NORMAL: {
    icon: CircleCheck,
    title: "Environment stable",
    message: "All reported readings are within configured limits.",
  },
  WARNING: {
    icon: AlertTriangle,
    title: "Attention required",
    message: "At least one reading is outside its preferred range.",
  },
  CRITICAL: {
    icon: ShieldAlert,
    title: "Critical condition",
    message: "A critical sensor condition needs immediate attention.",
  },
  UNKNOWN: {
    icon: CircleHelp,
    title: "Waiting for telemetry",
    message: "No sensor reading has been received yet.",
  },
};

export function StatusOverview({ status, latest, activeAlerts, connection }) {
  const detail = statusDetails[status];
  const Icon = detail.icon;
  const latestAt = latest?.timestamp
    ? new Date(latest.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Awaiting first reading";

  return (
    <section
      className={`status-overview status-${status.toLowerCase()}`}
      aria-live="polite"
    >
      <div className="status-overview__mark">
        <Icon size={24} strokeWidth={1.8} />
      </div>
      <div className="status-overview__copy">
        <div className="eyebrow">ROOM CONDITION</div>
        <h2>{detail.title}</h2>
        <p>{detail.message}</p>
      </div>
      <div className="status-overview__value">
        <span className="status-overview__state">{status}</span>
        <span className="status-overview__meta">
          {status === "UNKNOWN"
            ? "NO DATA"
            : `${activeAlerts} ACTIVE ${activeAlerts === 1 ? "ALERT" : "ALERTS"}`}
        </span>
      </div>
      <div className="status-overview__time">
        <span className={`connection-dot connection-${connection}`} />
        <span>
          {connection === "connected"
            ? "LIVE STREAM"
            : connection.toUpperCase()}
        </span>
        <time>{latestAt}</time>
      </div>
    </section>
  );
}
