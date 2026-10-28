import { AlertTriangle, Check, CircleAlert, ShieldAlert } from "lucide-react";

const severityIcon = {
  CRITICAL: ShieldAlert,
  WARNING: AlertTriangle,
  INFO: CircleAlert,
};

function formatAlertTime(value) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlertFeed({
  alerts,
  onResolve,
  fullPage = false,
  resolvingId = null,
}) {
  const visibleAlerts = fullPage ? alerts : alerts.slice(0, 5);

  return (
    <section
      className={`section-panel alert-panel ${fullPage ? "alert-panel--full" : ""}`}
    >
      <header className="section-heading">
        <div>
          <div className="eyebrow">EVENT LOG</div>
          <h2>Recent alerts</h2>
        </div>
        <span className="alert-count">
          {alerts.filter((alert) => !alert.resolved).length} ACTIVE
        </span>
      </header>

      {visibleAlerts.length === 0 ? (
        <div className="feed-empty">
          <Check size={18} />
          <span>No alerts recorded</span>
        </div>
      ) : (
        <ul className="alert-list">
          {visibleAlerts.map((alert) => {
            const Icon = severityIcon[alert.severity] || CircleAlert;
            return (
              <li
                key={alert.id}
                className={`alert-item alert-${alert.severity.toLowerCase()} ${alert.resolved ? "is-resolved" : ""}`}
              >
                <span className="alert-item__icon">
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                <div className="alert-item__body">
                  <div className="alert-item__line">
                    <span className="alert-item__severity">
                      {alert.severity}
                    </span>
                    <span className="alert-item__sensor">
                      {alert.sensor_id || "unknown sensor"}
                    </span>
                  </div>
                  <p>{alert.message}</p>
                  <time>{formatAlertTime(alert.created_at)}</time>
                </div>
                {!alert.resolved && (
                  <button
                    type="button"
                    className="icon-button alert-resolve"
                    title="Acknowledge alert"
                    aria-label={`Acknowledge alert: ${alert.message}`}
                    disabled={resolvingId === alert.id}
                    onClick={() => onResolve(alert.id)}
                  >
                    <Check size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
