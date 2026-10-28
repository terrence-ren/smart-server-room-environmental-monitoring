const TELEGRAM_MESSAGE_LIMIT = 3800;
const bangkokTimestamp = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
  timeStyle: "medium",
});

const metricLabels = {
  temperature_high: "อุณหภูมิ",
  temperature_low: "อุณหภูมิ",
  humidity_high: "ความชื้น",
  humidity_low: "ความชื้น",
};

function displayValue(value, unit = "") {
  return value === null || value === undefined ? "—" : `${value}${unit}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "ไม่ทราบเวลา";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "ไม่ทราบเวลา"
    : `${bangkokTimestamp.format(date)} น.`;
}

function formatBreachedCondition(alert, latest) {
  const metric = metricLabels[alert.alert_type];
  if (metric) {
    const isTemperature = alert.alert_type.startsWith("temperature");
    const unit = isTemperature ? "°C" : "%";
    const field = isTemperature ? "temperature" : "humidity";
    const comparison = alert.alert_type.endsWith("_high") ? "สูงกว่า" : "ต่ำกว่า";
    const thresholdMatch = String(alert.message ?? "").match(
      /(?:exceeds|is below)\s+(-?\d+(?:\.\d+)?)/i,
    );
    const threshold = thresholdMatch?.[1] ?? "ไม่ระบุ";
    return `${metric} ${displayValue(latest?.[field], unit)} ${comparison}เกณฑ์ ${threshold}${unit}`;
  }

  if (alert.alert_type === "smoke_detected") {
    return `ควัน/ก๊าซ: ${latest?.smoke_detected ? "ตรวจพบ" : "ตรวจพบสัญญาณแจ้งเตือน"} (เกณฑ์: ต้องไม่ตรวจพบ)`;
  }
  if (alert.alert_type === "water_leak") {
    return `น้ำรั่ว: ${latest?.water_leak ? "ตรวจพบ" : "ตรวจพบสัญญาณแจ้งเตือน"} (เกณฑ์: ต้องไม่ตรวจพบ)`;
  }
  return alert.message ?? "ไม่ระบุรายละเอียด";
}

function formatMetric(label, stats, latestValue, unit) {
  if (!stats?.count) {
    return latestValue === null || latestValue === undefined
      ? `${label}: ไม่มีข้อมูลใน 24 ชม.`
      : `${label}: ล่าสุด ${latestValue}${unit}; ไม่มีข้อมูลใน 24 ชม.`;
  }
  const latest =
    latestValue === null || latestValue === undefined
      ? "ค่าล่าสุดไม่มีข้อมูล"
      : `ล่าสุด ${latestValue}${unit}`;
  return `${label}: ${latest}; 24 ชม. ต่ำสุด/เฉลี่ย/สูงสุด ${stats.min}/${Number(stats.average).toFixed(1)}/${stats.max}${unit}`;
}

export async function createAlertReport(
  database,
  alert,
  transition = "new",
  previousSeverity,
  now = new Date(),
  roomUsage,
) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [latest, temperature, humidity, alertCounts, activeCount] =
    await Promise.all([
      database.get(
        `SELECT timestamp, temperature, humidity, pressure, smoke_detected,
                water_leak, presence, motion, status
         FROM sensor_logs WHERE sensor_id = ?
         ORDER BY timestamp DESC, id DESC LIMIT 1`,
        [alert.sensor_id],
      ),
      database.get(
        `SELECT COUNT(*) AS count, MIN(temperature) AS min,
                AVG(temperature) AS average, MAX(temperature) AS max
         FROM sensor_logs WHERE sensor_id = ? AND timestamp >= ?
           AND temperature IS NOT NULL`,
        [alert.sensor_id, cutoff],
      ),
      database.get(
        `SELECT COUNT(*) AS count, MIN(humidity) AS min,
                AVG(humidity) AS average, MAX(humidity) AS max
         FROM sensor_logs WHERE sensor_id = ? AND timestamp >= ?
           AND humidity IS NOT NULL`,
        [alert.sensor_id, cutoff],
      ),
      database.all(
        `SELECT severity, COUNT(*) AS count FROM alerts
         WHERE created_at >= ? GROUP BY severity`,
        [cutoff],
      ),
      database.get("SELECT COUNT(*) AS count FROM alerts WHERE resolved = 0"),
    ]);

  const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const item of alertCounts) counts[item.severity] = item.count;

  const heading = alert.severity === "CRITICAL"
    ? "🚨 รายงานแจ้งเตือนระดับอันตราย (CRITICAL)"
    : alert.severity === "WARNING"
    ? "⚠️ รายงานแจ้งเตือนระดับคำเตือน (WARNING)"
    : "ℹ️ รายงานแจ้งเตือน (INFO)";
  const timestamp = formatTimestamp(latest?.timestamp);

  const sections = [
    transition === "escalated"
      ? `🚨 ยกระดับการแจ้งเตือน (${previousSeverity} → ${alert.severity})`
      : heading,
    `เซนเซอร์: ${alert.sensor_id}`,
    ...(roomUsage
      ? [
          `สถานะการใช้งานห้อง: ${roomUsage.state}${roomUsage.absence_pending ? " (กำลังยืนยันการไม่พบ presence ครบ 1 นาที)" : ""}`,
        ]
      : []),
    `ค่าที่เกินเกณฑ์: ${formatBreachedCondition(alert, latest)}`,
    "ข้อมูลเซนเซอร์ปัจจุบัน:",
    `🌡 อุณหภูมิ: ${displayValue(latest?.temperature, "°C")}`,
    `💧 ความชื้น: ${displayValue(latest?.humidity, "%")}`,
    `🌬 ความดัน: ${displayValue(latest?.pressure, " hPa")}`,
    `เวลาอ่านค่า: ${timestamp}`,
    "สรุปข้อมูลย้อนหลัง 24 ชม.:",
    formatMetric("อุณหภูมิ", temperature, latest?.temperature, "°C"),
    formatMetric("ความชื้น", humidity, latest?.humidity, "%"),
    `การแจ้งเตือนที่สร้าง: วิกฤต ${counts.CRITICAL} | คำเตือน ${counts.WARNING} | ข้อมูล ${counts.INFO}`,
    `การแจ้งเตือนที่ยังทำงาน: ${activeCount.count}`,
  ];
  let message = sections.join("\n");
  if (message.length > TELEGRAM_MESSAGE_LIMIT) {
    message = `${message.slice(0, TELEGRAM_MESSAGE_LIMIT - 16)}\n[Report trimmed]`;
  }
  return message;
}
