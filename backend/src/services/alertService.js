import { createTelegramClient } from "./telegramClient.js";
import { createAlertReport } from "./alertReportService.js";

const severityRank = { INFO: 0, WARNING: 1, CRITICAL: 2 };
const REPEAT_REPORT_INTERVAL_MS = 5 * 60 * 1000;

function alertDetails(alert) {
  return `Sensor: ${alert.sensor_id}\nAlert: ${alert.message}`;
}

function notificationMessage(alert, transition, previousSeverity) {
  if (transition === "resolved") {
    return `✅ Smart Server Room alert RESOLVED\n${alertDetails(alert)}`;
  }
  if (transition === "escalated") {
    return `🚨 Smart Server Room alert ESCALATED (${previousSeverity} → ${alert.severity})\n${alertDetails(alert)}`;
  }
  return `🚨 Smart Server Room alert (${alert.severity})\n${alertDetails(alert)}`;
}

export function createAlertService({
  database,
  config,
  telegram: configuredTelegram,
  broadcast,
  logger = console,
  now = Date.now,
  getRoomUsage,
}) {
  const telegram =
    configuredTelegram ?? createTelegramClient(config, logger);
  const pendingReports = new Set();
  const notify = (alert, transition, previousSeverity) => {
    if (transition === "resolved") {
      void telegram.sendMessage(
        notificationMessage(alert, transition, previousSeverity),
      );
      return;
    }
    const reportKey = alert.id;
    if (pendingReports.has(reportKey)) return;
    pendingReports.add(reportKey);
    void (async () => {
      try {
        if (transition === "repeat") {
          const previousReport = await database.get(
            "SELECT last_attempt_at FROM telegram_alert_reports WHERE alert_id = ?",
            [reportKey],
          );
          if (
            previousReport &&
            now() - Date.parse(previousReport.last_attempt_at) <
              REPEAT_REPORT_INTERVAL_MS
          ) {
            return;
          }
        }

        const message = await createAlertReport(
          database,
          alert,
          transition,
          previousSeverity,
          new Date(now()),
          await getRoomUsage?.(),
        );
        await database.run(
          `INSERT INTO telegram_alert_reports (alert_id, last_attempt_at)
           VALUES (?, ?)
           ON CONFLICT(alert_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`,
          [reportKey, new Date(now()).toISOString()],
        );
        await telegram.sendMessage(message);
      } catch (error) {
        logger.error?.(
          `Telegram alert report could not be generated: ${error.message}`,
        );
      } finally {
        pendingReports.delete(reportKey);
      }
    })();
  };

  async function reconcile(sensorId, alertType, active, severity, message) {
    let existing = await database.get(
      `SELECT * FROM alerts
       WHERE sensor_id = ? AND alert_type = ? AND resolved = 0 ORDER BY id DESC LIMIT 1`,
      [sensorId, alertType],
    );
    let escalatedFrom;

    if (active && existing && existing.severity !== severity) {
      if ((severityRank[severity] ?? 0) > (severityRank[existing.severity] ?? 0)) {
        escalatedFrom = existing.severity;
      }
      const resolvedAt = new Date().toISOString();
      await database.run(
        "UPDATE alerts SET resolved = 1, resolved_at = ? WHERE id = ?",
        [resolvedAt, existing.id],
      );
      broadcast({
        type: "alert:resolved",
        data: { ...existing, resolved: 1, resolved_at: resolvedAt },
      });
      existing = null;
    }

    if (active && !existing) {
      const createdAt = new Date().toISOString();
      const result = await database.run(
        `INSERT INTO alerts (sensor_id, alert_type, severity, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [sensorId, alertType, severity, message, createdAt],
      );
      const alert = await database.get("SELECT * FROM alerts WHERE id = ?", [
        result.lastID,
      ]);
      broadcast({ type: "alert:new", data: alert });
      notify(alert, escalatedFrom ? "escalated" : "new", escalatedFrom);
      return;
    }

    if (active && existing) {
      // Keep one active DB row, but report each over-threshold telemetry reading.
      notify({ ...existing, message }, "repeat");
      return;
    }

    if (!active && existing) {
      const resolvedAt = new Date().toISOString();
      await database.run(
        "UPDATE alerts SET resolved = 1, resolved_at = ? WHERE id = ?",
        [resolvedAt, existing.id],
      );
      broadcast({
        type: "alert:resolved",
        data: { ...existing, resolved: 1, resolved_at: resolvedAt },
      });
      notify({ ...existing, resolved: 1, resolved_at: resolvedAt }, "resolved");
    }
  }

  async function evaluate(reading) {
    const thresholdRows = await database.all(
      "SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)",
      ["temperature_min", "temperature_max", "humidity_min", "humidity_max"],
    );
    const thresholds = Object.fromEntries(
      thresholdRows.map(({ key, value }) => [key, value]),
    );
    const checks = [];

    if (reading.temperature !== null) {
      const isCriticalTemperature =
        reading.temperature > 32 || reading.temperature < 15;
      const temperatureSeverity =
        isCriticalTemperature ? "CRITICAL" : "WARNING";
      const highTemperatureLimit = reading.temperature > 32
        ? 32
        : thresholds.temperature_max;
      const lowTemperatureLimit = reading.temperature < 15
        ? 15
        : thresholds.temperature_min;
      checks.push(
        [
          "temperature_high",
          reading.temperature > thresholds.temperature_max ||
            reading.temperature > 32,
          temperatureSeverity,
          `Temperature ${reading.temperature}°C exceeds ${highTemperatureLimit}°C`,
        ],
        [
          "temperature_low",
          reading.temperature < thresholds.temperature_min ||
            reading.temperature < 15,
          temperatureSeverity,
          `Temperature ${reading.temperature}°C is below ${lowTemperatureLimit}°C`,
        ],
      );
    }
    if (reading.humidity !== null) {
      checks.push(
        [
          "humidity_high",
          reading.humidity > thresholds.humidity_max,
          "WARNING",
          `Humidity ${reading.humidity}% exceeds ${thresholds.humidity_max}%`,
        ],
        [
          "humidity_low",
          reading.humidity < thresholds.humidity_min,
          "WARNING",
          `Humidity ${reading.humidity}% is below ${thresholds.humidity_min}%`,
        ],
      );
    }
    if (reading.smoke_detected !== null) {
      checks.push([
        "smoke_detected",
        reading.smoke_detected === 1,
        "CRITICAL",
        "Smoke or gas detected",
      ]);
    }
    if (reading.water_leak !== null) {
      checks.push([
        "water_leak",
        reading.water_leak === 1,
        "CRITICAL",
        "Water leak detected",
      ]);
    }

    for (const [alertType, active, severity, message] of checks) {
      await reconcile(reading.sensor_id, alertType, active, severity, message);
    }
  }

  function notifyResolved(alert) {
    notify(alert, "resolved");
  }

  return { evaluate, notifyResolved };
}
