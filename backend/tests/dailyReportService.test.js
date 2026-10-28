import assert from "node:assert/strict";
import test from "node:test";
import { runDailyReportIfDue } from "../src/services/dailyReportService.js";

class ReportDatabase {
  sentDates = new Set();
  queries = [];

  async get(sql, parameters) {
    this.queries.push({ sql, parameters });
    if (sql.includes("FROM telegram_reports")) {
      return this.sentDates.has(parameters[0])
        ? { report_date: parameters[0] }
        : undefined;
    }
    if (sql.includes("FROM sensor_logs ORDER BY")) {
      return {
        sensor_id: "rack-01",
        timestamp: "2026-10-13T23:00:00.000Z",
        temperature: 29,
        humidity: 72,
      };
    }
    if (sql.includes("COUNT(*) AS count FROM alerts WHERE resolved = 0")) {
      return { count: 1 };
    }
    if (sql.includes("MIN(temperature)")) {
      return { count: 12, min: 22, average: 25, max: 30 };
    }
    if (sql.includes("MIN(humidity)")) {
      return { count: 12, min: 40, average: 55, max: 75 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  async all(sql, parameters) {
    this.queries.push({ sql, parameters });
    if (sql.includes("GROUP BY severity")) {
      return [
        { severity: "CRITICAL", count: 2 },
        { severity: "WARNING", count: 3 },
      ];
    }
    if (sql.includes("WHERE resolved = 0")) {
      return [{ sensor_id: "rack-01", severity: "CRITICAL", message: "Smoke detected" }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  async run(sql, parameters) {
    this.queries.push({ sql, parameters });
    this.sentDates.add(parameters[0]);
  }
}

test("daily report summarizes the database and sends once per Bangkok date", async () => {
  const database = new ReportDatabase();
  const messages = [];
  const telegram = {
    enabled: true,
    async sendMessage(message) {
      messages.push(message);
      return true;
    },
  };
  const now = new Date("2026-10-14T01:00:00.000Z"); // 08:00 in Bangkok

  assert.equal(
    await runDailyReportIfDue({ database, telegram, now }),
    "sent",
  );
  assert.equal(
    await runDailyReportIfDue({ database, telegram, now }),
    "already-sent",
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0], /2026-10-14 \(last 24 hours\)/);
  assert.match(messages[0], /Temperature: latest 29°C; min\/avg\/max 22\/25\.0\/30°C/);
  assert.match(messages[0], /Humidity: latest 72%; min\/avg\/max 40\/55\.0\/75%/);
  assert.match(messages[0], /New alerts: 2 critical, 3 warning, 0 info/);
  assert.match(messages[0], /\[CRITICAL\] rack-01: Smoke detected/);
  const cutoff = database.queries.find(({ sql }) =>
    sql.includes("MIN(temperature)"),
  ).parameters[0];
  assert.equal(cutoff, "2026-10-13T01:00:00.000Z");
});

test("daily report waits until 08:00 Bangkok and retries after delivery failure", async () => {
  const database = new ReportDatabase();
  let requests = 0;
  const telegram = {
    enabled: true,
    async sendMessage() {
      requests += 1;
      return requests > 1;
    },
  };
  const now = new Date("2026-10-14T00:59:00.000Z");

  assert.equal(
    await runDailyReportIfDue({ database, telegram, now }),
    "not-due",
  );
  const dueAt = new Date("2026-10-14T01:00:00.000Z");
  assert.equal(
    await runDailyReportIfDue({ database, telegram, now: dueAt }),
    "failed",
  );
  assert.equal(
    await runDailyReportIfDue({ database, telegram, now: dueAt }),
    "sent",
  );
  assert.equal(requests, 2);
});

test("daily report is skipped when Telegram notifications are not configured", async () => {
  const result = await runDailyReportIfDue({
    database: new ReportDatabase(),
    telegram: { enabled: false, async sendMessage() { return false; } },
    now: new Date("2026-10-14T01:00:00.000Z"),
  });
  assert.equal(result, "disabled");
});
