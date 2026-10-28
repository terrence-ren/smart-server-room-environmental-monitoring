const REPORT_TIME_ZONE = "Asia/Bangkok";
const REPORT_HOUR = 8;
const MAX_ACTIVE_ALERTS = 10;

const bangkokDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getBangkokDateTime(date) {
  return Object.fromEntries(
    bangkokDateTime
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
}

function formatMetric(label, stats, latestValue, unit) {
  if (stats?.count === 0) {
    return latestValue === null || latestValue === undefined
      ? `${label}: no readings`
      : `${label}: latest ${latestValue}${unit}; no readings in report period`;
  }
  const latest = latestValue === null || latestValue === undefined
    ? "latest unavailable"
    : `latest ${latestValue}${unit}`;
  return `${label}: ${latest}; min/avg/max ${stats.min}/${Number(stats.average).toFixed(1)}/${stats.max}${unit}`;
}

export async function runDailyReportIfDue({
  database,
  telegram,
  logger = console,
  now = new Date(),
}) {
  const local = getBangkokDateTime(now);
  const reportDate = `${local.year}-${local.month}-${local.day}`;
  if (Number(local.hour) < REPORT_HOUR) return "not-due";
  if (!telegram.enabled) return "disabled";

  const alreadySent = await database.get(
    "SELECT report_date FROM telegram_reports WHERE report_date = ?",
    [reportDate],
  );
  if (alreadySent) return "already-sent";

  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const latest = await database.get(
    "SELECT * FROM sensor_logs ORDER BY timestamp DESC, id DESC LIMIT 1",
  );
  const [temperature, humidity] = await Promise.all([
    database.get(
      `SELECT COUNT(*) AS count, MIN(temperature) AS min,
              AVG(temperature) AS average, MAX(temperature) AS max
       FROM sensor_logs WHERE timestamp >= ? AND temperature IS NOT NULL`,
      [cutoff],
    ),
    database.get(
      `SELECT COUNT(*) AS count, MIN(humidity) AS min,
              AVG(humidity) AS average, MAX(humidity) AS max
       FROM sensor_logs WHERE timestamp >= ? AND humidity IS NOT NULL`,
      [cutoff],
    ),
  ]);
  const alertCounts = await database.all(
    `SELECT severity, COUNT(*) AS count FROM alerts
     WHERE created_at >= ? GROUP BY severity`,
    [cutoff],
  );
  const activeAlertCount = await database.get(
    "SELECT COUNT(*) AS count FROM alerts WHERE resolved = 0",
  );
  const activeAlerts = await database.all(
    `SELECT sensor_id, severity, message, created_at FROM alerts
     WHERE resolved = 0
     ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
              created_at DESC
     LIMIT ?`,
    [MAX_ACTIVE_ALERTS],
  );

  const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const row of alertCounts) counts[row.severity] = row.count;
  const latestLine = latest
    ? `Latest reading (${latest.sensor_id}): ${latest.timestamp}`
    : "Latest reading: no sensor data";
  const activeLines = activeAlerts.length
    ? activeAlerts.map(
        ({ sensor_id, severity, message }) =>
          `- [${severity}] ${sensor_id}: ${message}`,
      )
    : ["- None"];
  if (activeAlerts.length === MAX_ACTIVE_ALERTS) {
    activeLines.push(`(Showing up to ${MAX_ACTIVE_ALERTS} active alerts.)`);
  }

  const message = [
    `Roomwatch daily report — ${reportDate} (last 24 hours)`,
    latestLine,
    formatMetric("Temperature", temperature, latest?.temperature, "°C"),
    formatMetric("Humidity", humidity, latest?.humidity, "%"),
    `New alerts: ${counts.CRITICAL} critical, ${counts.WARNING} warning, ${counts.INFO} info`,
    `Active alerts (${activeAlertCount.count}):`,
    ...activeLines,
  ].join("\n");

  const sent = await telegram.sendMessage(message);
  if (!sent) {
    logger.warn(`Roomwatch daily report for ${reportDate} was not delivered`);
    return "failed";
  }

  await database.run(
    "INSERT INTO telegram_reports (report_date, sent_at) VALUES (?, ?)",
    [reportDate, now.toISOString()],
  );
  logger.info?.(`Roomwatch daily report sent for ${reportDate}`);
  return "sent";
}

export function startDailyReportScheduler(options, intervalMs = 30_000) {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      await runDailyReportIfDue(options);
    } catch (error) {
      options.logger?.error(
        `Roomwatch daily report failed: ${error.message}`,
      );
    } finally {
      running = false;
    }
  };

  void check();
  const timer = setInterval(check, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
