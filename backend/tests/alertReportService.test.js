import assert from "node:assert/strict";
import test from "node:test";
import { createAlertReport } from "../src/services/alertReportService.js";

test("warning report formats threshold, sensor snapshot, Thai time, and 24-hour context", async () => {
  const queries = [];
  const database = {
    async get(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.includes("COUNT(*) AS count FROM alerts")) return { count: 2 };
      if (sql.includes("MIN(temperature)")) {
        return { count: 10, min: 22, average: 26, max: 33 };
      }
      if (sql.includes("MIN(humidity)")) {
        return { count: 10, min: 40, average: 56, max: 72 };
      }
      if (sql.includes("FROM sensor_logs")) {
        return {
          timestamp: "2026-10-14T01:00:00.000Z",
          temperature: 30,
          humidity: 55,
          pressure: 993.5,
          smoke_detected: 0,
          water_leak: 0,
          presence: 0,
          motion: 0,
          status: "WARNING",
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async all(sql) {
      if (sql.includes("GROUP BY severity")) {
        return [
          { severity: "WARNING", count: 4 },
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const report = await createAlertReport(
    database,
    {
      sensor_id: "rack-01",
      alert_type: "temperature_high",
      severity: "WARNING",
      message: "Temperature 30°C exceeds 28°C",
    },
    "repeat",
    undefined,
    new Date("2026-10-14T01:00:00.000Z"),
    { state: "PRESENCE DETECTED", absence_pending: false },
  );

  assert.match(report, /⚠️ รายงานแจ้งเตือนระดับคำเตือน \(WARNING\)/);
  assert.match(report, /สถานะการใช้งานห้อง: PRESENCE DETECTED/);
  assert.match(report, /ค่าที่เกินเกณฑ์: อุณหภูมิ 30°C สูงกว่าเกณฑ์ 28°C/);
  assert.match(report, /🌡 อุณหภูมิ: 30°C/);
  assert.match(report, /💧 ความชื้น: 55%/);
  assert.match(report, /🌬 ความดัน: 993\.5 hPa/);
  assert.match(report, /เวลาอ่านค่า: 14 ต\.ค\. 2569 08:00:00 น\./);
  assert.match(report, /อุณหภูมิ: ล่าสุด 30°C; 24 ชม\. ต่ำสุด\/เฉลี่ย\/สูงสุด 22\/26\.0\/33°C/);
  assert.match(report, /ความชื้น: ล่าสุด 55%; 24 ชม\. ต่ำสุด\/เฉลี่ย\/สูงสุด 40\/56\.0\/72%/);
  assert.match(report, /วิกฤต 0 \| คำเตือน 4 \| ข้อมูล 0/);
  assert.ok(
    queries.every(({ parameters = [] }) =>
      parameters.includes("rack-01") ||
      parameters.includes("2026-10-13T01:00:00.000Z") ||
      parameters.length === 0
    ),
  );
  assert.ok(report.length <= 3800);
});

test("critical report uses danger wording and icon for smoke detection", async () => {
  const database = {
    async get(sql) {
      if (sql.includes("FROM sensor_logs")) {
        return {
          timestamp: "2026-10-14T01:00:00.000Z",
          temperature: 33,
          humidity: 72,
          pressure: 993,
          smoke_detected: 1,
        };
      }
      if (sql.includes("COUNT(*) AS count")) return { count: 1 };
      if (sql.includes("MIN(temperature)")) {
        return { count: 0, min: null, average: null, max: null };
      }
      if (sql.includes("MIN(humidity)")) {
        return { count: 0, min: null, average: null, max: null };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async all() {
      return [{ severity: "CRITICAL", count: 1 }];
    },
  };

  const report = await createAlertReport(database, {
    sensor_id: "rack-01",
    alert_type: "smoke_detected",
    severity: "CRITICAL",
    message: "Smoke or gas detected",
  });

  assert.match(report, /🚨 รายงานแจ้งเตือนระดับอันตราย \(CRITICAL\)/);
  assert.match(report, /ค่าที่เกินเกณฑ์: ควัน\/ก๊าซ: ตรวจพบ/);
});
