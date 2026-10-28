import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  ChevronDown,
  Clock3,
  Droplets,
  Gauge,
  History,
  Menu,
  PersonStanding,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Thermometer,
  Volume2,
  VolumeX,
  Waves,
  Wifi,
  WifiOff,
  Wind,
  X,
} from "lucide-react";
import { AlertFeed } from "./components/AlertFeed.jsx";
import { MetricGauge } from "./components/MetricGauge.jsx";
import { RoomUsageCard } from "./components/RoomUsageCard.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { StatusOverview } from "./components/StatusOverview.jsx";
import { useMonitoringData } from "./hooks/useMonitoringData.js";
import { resolveAlert } from "./services/api.js";

const TelemetryChart = lazy(() =>
  import("./components/TelemetryChart.jsx").then((module) => ({
    default: module.TelemetryChart,
  })),
);

const navigation = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "history", label: "History", icon: History },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const pageDetails = {
  overview: ["Overview", "Live environmental telemetry for the server room."],
  history: [
    "Sensor history",
    "Review temperature and humidity trends over time.",
  ],
  alerts: ["Alert log", "Review and acknowledge active room events."],
  settings: ["Threshold settings", "Configure operating limits for this room."],
};

function deriveStatus(latest, alerts, thresholds) {
  if (!latest) return "UNKNOWN";

  const active = alerts.filter((alert) => !alert.resolved);
  const reported = String(latest.status || "").toUpperCase();
  const isCriticalReading =
    latest.smoke_detected === 1 ||
    latest.water_leak === 1 ||
    reported === "CRITICAL";
  if (
    isCriticalReading ||
    active.some((alert) => alert.severity === "CRITICAL")
  )
    return "CRITICAL";

  const isOutsideThresholds =
    (latest.temperature !== null &&
      thresholds &&
      (latest.temperature < thresholds.temperature.min ||
        latest.temperature > thresholds.temperature.max)) ||
    (latest.humidity !== null &&
      thresholds &&
      (latest.humidity < thresholds.humidity.min ||
        latest.humidity > thresholds.humidity.max));
  if (
    reported === "WARNING" ||
    isOutsideThresholds ||
    active.some((alert) => alert.severity === "WARNING")
  ) {
    return "WARNING";
  }
  return "NORMAL";
}

function deriveTemperatureStatus(temperature) {
  if (!Number.isFinite(temperature)) return "UNKNOWN";
  if (temperature > 32 || temperature < 15) return "CRITICAL";
  if (temperature > 27 || temperature < 18) return "WARNING";
  return "NORMAL";
}

function BinaryReadout({ label, value, icon: Icon, mode = "alarm" }) {
  const known = value !== null && value !== undefined;
  const active = Number(value) === 1 || value === true;
  const state = !known
    ? "NOT REPORTED"
    : mode === "activity"
      ? active
        ? "DETECTED"
        : "CLEAR"
      : active
        ? "ALARM"
        : "NORMAL";
  const tone = !known
    ? "unknown"
    : mode === "activity"
      ? active
        ? "active"
        : "quiet"
      : active
        ? "critical"
        : "normal";

  return (
    <div className={`binary-readout binary-${tone}`}>
      <span className="binary-readout__icon">
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <span className="binary-readout__label">{label}</span>
      <span className="binary-readout__state">{state}</span>
    </div>
  );
}

function ActivityReadout({ label, value, icon: Icon }) {
  const known = value !== null && value !== undefined;
  const detected = Number(value) === 1 || value === true;
  const state = !known ? "NO DATA" : detected ? "DETECTED" : "CLEAR";

  return (
    <div className={`activity-readout ${detected ? "is-active" : ""}`}>
      <span className="activity-readout__label">
        <Icon size={16} strokeWidth={1.8} />
        {label}
      </span>
      <strong>{state}</strong>
    </div>
  );
}

function App() {
  const [page, setPage] = useState("overview");
  const [range, setRange] = useState("24h");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [statusCheckedAt, setStatusCheckedAt] = useState(0);
  const [resolvingId, setResolvingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const audioContextRef = useRef(null);
  const seenAlertIds = useRef(new Set());
  const {
    latest,
    history,
    alerts,
    thresholds,
    roomUsage,
    connection,
    loading,
    error,
    refresh,
    setAlerts,
    setThresholds,
  } = useMonitoringData(range);

  const activeAlerts = alerts.filter((alert) => !alert.resolved);
  const status = deriveStatus(latest, alerts, thresholds);
  const readingTimestamp = Date.parse(latest?.timestamp ?? "");
  const deviceOnline =
    Number.isFinite(readingTimestamp) &&
    statusCheckedAt - readingTimestamp < 15_000;
  const serverOnline = connection === "connected";
  const [pageTitle, pageDescription] = pageDetails[page];
  const updatedAt = latest?.timestamp
    ? new Date(latest.timestamp).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "No telemetry yet";

  useEffect(() => {
    const initialTimer = window.setTimeout(
      () => setStatusCheckedAt(Date.now()),
      0,
    );
    const timer = window.setInterval(
      () => setStatusCheckedAt(Date.now()),
      5000,
    );
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    for (const alert of alerts) {
      if (seenAlertIds.current.has(alert.id)) continue;
      seenAlertIds.current.add(alert.id);
      if (
        alert.severity !== "CRITICAL" ||
        alert.resolved ||
        !soundEnabled ||
        !audioContextRef.current
      )
        continue;

      const context = audioContextRef.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.22);
    }
  }, [alerts, soundEnabled]);

  async function toggleSound() {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return;
    audioContextRef.current ||= new AudioContextType();
    await audioContextRef.current.resume();
    setSoundEnabled(true);
  }

  async function acknowledgeAlert(alertId) {
    setResolvingId(alertId);
    setActionError("");
    try {
      const resolved = await resolveAlert(alertId);
      setAlerts((current) =>
        current.map((alert) => (alert.id === alertId ? resolved : alert)),
      );
    } catch (resolveError) {
      setActionError(resolveError.message);
    } finally {
      setResolvingId(null);
    }
  }

  function changePage(nextPage) {
    setPage(nextPage);
    setMobileNavOpen(false);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar--open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark">
            <Server size={19} strokeWidth={1.8} />
          </div>
          <div>
            <strong>Smart Server Room Monitor</strong>
            <span>ENVIRONMENTAL MONITORING</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <div className="room-selector">
          <span className="eyebrow">MONITORING SITE</span>
          <button
            type="button"
            className="room-selector__button"
            aria-haspopup="listbox"
            aria-expanded={roomMenuOpen}
            onClick={() => setRoomMenuOpen((open) => !open)}
          >
            <span className="room-selector__icon">
              <Server size={17} />
            </span>
            <span>
              <strong>Server Room 01</strong>
              <small>Primary facility</small>
            </span>
            <ChevronDown size={15} />
          </button>
          {roomMenuOpen && (
            <div
              className="room-selector__menu"
              role="listbox"
              aria-label="Monitoring rooms"
            >
              <button
                type="button"
                role="option"
                aria-selected="true"
                onClick={() => setRoomMenuOpen(false)}
              >
                <span>Server Room 01</span>
                <small>Primary facility · selected</small>
              </button>
            </div>
          )}
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          <span className="eyebrow">WORKSPACE</span>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item ${page === id ? "is-active" : ""}`}
              onClick={() => changePage(id)}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "alerts" && activeAlerts.length > 0 && (
                <span className="nav-count">{activeAlerts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="site-health">
            <div className="site-health__top">
              <ShieldCheck size={16} />
              <span>API SERVICE</span>
            </div>
            <div className="site-health__status">
              <i className={`connection-dot connection-${connection}`} />
              {connection === "connected"
                ? "Connected"
                : connection === "connecting"
                  ? "Connecting"
                  : "Offline"}
            </div>
            <small>REST + WebSocket</small>
          </div>
          <div className="sidebar-version">
            ROOMWATCH <span>·</span> 01.0
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="mobile-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar__location">
            <button
              className="icon-button mobile-menu"
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span>OPERATIONS</span>
            <span className="crumb-slash">/</span>
            <strong>SERVER ROOM 01</strong>
          </div>
          <div className="topbar__actions">
            <span className="last-updated">
              <Clock3 size={14} /> {updatedAt}
            </span>
            <div
              className="system-connectivity"
              aria-label="System connectivity"
            >
              <span
                className={`connectivity-pill ${deviceOnline ? "is-online" : "is-offline"}`}
                aria-label={`Device Wi-Fi ${deviceOnline ? "online" : "offline"}`}
                title={`Device Wi-Fi ${deviceOnline ? "online" : "offline"}`}
              >
                <Wifi size={13} />
                <span>{deviceOnline ? "ONLINE" : "OFFLINE"}</span>
              </span>
              <span
                className={`connectivity-pill ${serverOnline ? "is-online" : "is-offline"}`}
                aria-label={`Server ${serverOnline ? "online" : "offline"}`}
                title={`Server ${serverOnline ? "online" : "offline"}`}
              >
                <Server size={13} />
                <span>{serverOnline ? "ONLINE" : "OFFLINE"}</span>
              </span>
            </div>
            <button
              className={`icon-button ${soundEnabled ? "is-toggled" : ""}`}
              type="button"
              title={
                soundEnabled
                  ? "Disable critical alert sound"
                  : "Enable critical alert sound"
              }
              aria-label={
                soundEnabled
                  ? "Disable critical alert sound"
                  : "Enable critical alert sound"
              }
              onClick={toggleSound}
            >
              {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <button
              className="icon-button"
              type="button"
              title="Refresh readings"
              aria-label="Refresh readings"
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">ENVIRONMENTAL MONITORING</div>
              <h1>{pageTitle}</h1>
              <p>{pageDescription}</p>
            </div>
            <div className="page-heading__site">
              <span>FACILITY</span>
              <strong>West Wing · Level 2</strong>
            </div>
          </div>

          {(error || actionError) && (
            <div className="connection-warning" role="status">
              <WifiOff size={17} />
              <span>{error || actionError}</span>
              <button
                type="button"
                className="icon-button"
                onClick={refresh}
                aria-label="Retry connection"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          )}

          <StatusOverview
            status={status}
            latest={latest}
            activeAlerts={activeAlerts.length}
            connection={connection}
          />
          <RoomUsageCard roomUsage={roomUsage} />

          {(page === "overview" || page === "history") && (
            <>
              <section
                className="metrics-grid metrics-grid--bento"
                aria-label="Current environmental readings"
              >
                <MetricGauge
                  title="Temperature"
                  value={latest?.temperature}
                  unit="°C"
                  minimum={thresholds?.temperature.min}
                  maximum={thresholds?.temperature.max}
                  icon={Thermometer}
                  tone="temperature"
                  status={deriveTemperatureStatus(latest?.temperature)}
                />
                <MetricGauge
                  title="Relative humidity"
                  value={latest?.humidity}
                  unit="%"
                  minimum={thresholds?.humidity.min}
                  maximum={thresholds?.humidity.max}
                  icon={Droplets}
                  tone="humidity"
                />
                <article className="metric-panel metric-pressure">
                  <header className="metric-panel__heading">
                    <span className="metric-panel__icon">
                      <Gauge size={18} strokeWidth={1.8} />
                    </span>
                    <span>Pressure</span>
                    <span className="metric-panel__state">ATMOSPHERIC</span>
                  </header>
                  <div className="metric-panel__reading">
                    <strong>
                      {Number.isFinite(latest?.pressure)
                        ? Number(latest.pressure).toFixed(0)
                        : "—"}
                    </strong>
                    <span>hPa</span>
                  </div>
                  <div className="metric-panel__limits">
                    <span>BAROMETRIC PRESSURE</span>
                    <span>{latest?.sensor_id || "NO DEVICE"}</span>
                  </div>
                </article>
                <article className="metric-panel activity-panel">
                  <header className="metric-panel__heading">
                    <span className="metric-panel__icon">
                      <PersonStanding size={18} strokeWidth={1.8} />
                    </span>
                    <span>Presence &amp; motion</span>
                  </header>
                  <div className="activity-readouts">
                    <ActivityReadout
                      label="Presence"
                      value={latest?.presence}
                      icon={PersonStanding}
                    />
                    <ActivityReadout
                      label="Motion"
                      value={latest?.motion}
                      icon={Activity}
                    />
                  </div>
                </article>
              </section>

              {page === "overview" && (
                <section
                  className="sensor-strip"
                  aria-label="Safety sensor states"
                >
                  <div className="sensor-strip__heading">
                    <span className="eyebrow">SAFETY SENSORS</span>
                    <span>{latest?.sensor_id || "No device reported"}</span>
                  </div>
                  <div className="sensor-strip__items">
                    <BinaryReadout
                      label="Smoke / gas"
                      value={latest?.smoke_detected}
                      icon={Wind}
                    />
                    <BinaryReadout
                      label="Water leak"
                      value={latest?.water_leak}
                      icon={Waves}
                    />
                  </div>
                </section>
              )}

              <div
                className={`content-grid ${page === "history" ? "content-grid--single" : ""}`}
              >
                <Suspense
                  fallback={
                    <div className="section-panel chart-loading">
                      Loading chart…
                    </div>
                  }
                >
                  <TelemetryChart
                    data={history}
                    range={range}
                    onRangeChange={setRange}
                  />
                </Suspense>
                {page === "overview" && (
                  <AlertFeed
                    alerts={alerts}
                    onResolve={acknowledgeAlert}
                    resolvingId={resolvingId}
                  />
                )}
              </div>
            </>
          )}

          {page === "alerts" && (
            <AlertFeed
              alerts={alerts}
              onResolve={acknowledgeAlert}
              fullPage
              resolvingId={resolvingId}
            />
          )}

          {page === "settings" &&
            (thresholds ? (
              <SettingsPanel thresholds={thresholds} onSaved={setThresholds} />
            ) : (
              <div className="section-panel settings-loading">
                {loading
                  ? "Loading thresholds…"
                  : "Threshold settings unavailable"}
              </div>
            ))}

          <footer className="page-footer">
            <span>
              <i className={`connection-dot connection-${connection}`} />{" "}
              {connection === "connected"
                ? "REAL-TIME LINK ACTIVE"
                : "REST REFRESH ENABLED"}
            </span>
            <span>
              <Wifi size={14} /> API{" "}
              <code>
                {import.meta.env.VITE_API_BASE_URL ||
                  `${window.location.hostname}:5000`}
              </code>
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;
