import assert from "node:assert/strict";
import test from "node:test";
import { createAlertService } from "../src/services/alertService.js";

class MemoryDatabase {
  alerts = [];
  latestReading;
  nextId = 1;

  async all(sql) {
    if (sql.includes("GROUP BY severity")) return [];
    if (sql.includes("WHERE resolved = 0")) return [];
    return [
      { key: "temperature_min", value: 15 },
      { key: "temperature_max", value: 28 },
      { key: "humidity_min", value: 20 },
      { key: "humidity_max", value: 70 },
    ];
  }

  async get(sql, parameters) {
    if (sql.includes("FROM telegram_alert_reports")) {
      return this.reportAttempts?.get(parameters[0]);
    }
    if (sql.includes("COUNT(*) AS count FROM alerts WHERE resolved = 0")) {
      return { count: 0 };
    }
    if (sql.includes("FROM sensor_logs")) return this.latestReading;
    if (sql.includes("COUNT(*) AS count, MIN(")) {
      return { count: 0, min: null, average: null, max: null };
    }
    if (sql.includes("sensor_id = ?")) {
      return this.alerts.find(
        (alert) =>
          alert.sensor_id === parameters[0] &&
          alert.alert_type === parameters[1] &&
          alert.resolved === 0,
      );
    }
    if (sql.includes("WHERE id = ?")) {
      return this.alerts.find((alert) => alert.id === parameters[0]);
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  async run(sql, parameters) {
    if (sql.includes("INSERT INTO telegram_alert_reports")) {
      this.reportAttempts ??= new Map();
      this.reportAttempts.set(parameters[0], {
        last_attempt_at: parameters[1],
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO alerts")) {
      const [sensor_id, alert_type, severity, message, created_at] = parameters;
      const alert = {
        id: this.nextId++,
        sensor_id,
        alert_type,
        severity,
        message,
        resolved: 0,
        created_at,
        resolved_at: null,
      };
      this.alerts.push(alert);
      return { lastID: alert.id };
    }
    if (sql.startsWith("UPDATE alerts")) {
      const alert = this.alerts.find((item) => item.id === parameters[1]);
      if (!alert) return { changes: 0 };
      alert.resolved = 1;
      alert.resolved_at = parameters[0];
      return { changes: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

function createService({ config, logger, roomUsage }) {
  const database = new MemoryDatabase();
  const events = [];
  const service = createAlertService({
    database,
    config,
    broadcast: (event) => events.push(event),
    logger,
    getRoomUsage: async () => roomUsage,
  });
  return { database, events, service };
}

function temperatureReading(temperature, sensor_id = "rack-test") {
  return {
    sensor_id,
    temperature,
    humidity: null,
    smoke_detected: null,
    water_leak: null,
  };
}

async function flushNotifications() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("Telegram reports every active over-threshold reading without duplicate alert rows", async (context) => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { database, events, service } = createService({
    config: {
      telegramBotToken: "test-token",
      telegramChatId: "test-chat",
    },
    logger: { warn() {} },
    roomUsage: { state: "MOTION DETECTED", absence_pending: false },
  });

  database.latestReading = {
    timestamp: "2026-10-14T01:00:00.000Z",
    temperature: 30,
    humidity: 50,
    pressure: 1000,
  };
  await service.evaluate(temperatureReading(30));
  database.latestReading = { ...database.latestReading, temperature: 31 };
  await service.evaluate(temperatureReading(31));
  database.latestReading = { ...database.latestReading, temperature: 33 };
  await service.evaluate(temperatureReading(33));
  await service.evaluate(temperatureReading(24));
  await flushNotifications();

  assert.equal(sent.length, 3);
  assert.match(sent[0].text, /รายงานแจ้งเตือนระดับคำเตือน/);
  assert.match(sent[0].text, /สถานะการใช้งานห้อง: MOTION DETECTED/);
  assert.match(sent[1].text, /ยกระดับการแจ้งเตือน \(WARNING → CRITICAL\)/);
  assert.match(sent[1].text, /สถานะการใช้งานห้อง: MOTION DETECTED/);
  assert.match(sent[0].text, /ค่าที่เกินเกณฑ์: อุณหภูมิ 30°C สูงกว่าเกณฑ์ 28°C/);
  assert.match(sent[1].text, /ค่าที่เกินเกณฑ์: อุณหภูมิ 33°C สูงกว่าเกณฑ์ 32°C/);
  assert.match(sent[2].text, /alert RESOLVED/);
  assert.equal(database.alerts.length, 2);
  assert.deepEqual(
    events.map(({ type }) => type),
    [
      "alert:new",
      "alert:resolved",
      "alert:new",
      "alert:resolved",
    ],
  );
});

test("repeat Telegram report is rate limited to five minutes and cooldown survives service restart", async (context) => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const config = {
    telegramBotToken: "test-token",
    telegramChatId: "test-chat",
  };
  const logger = { warn() {}, error() {} };
  const database = new MemoryDatabase();
  let currentTime = Date.parse("2026-10-14T01:00:00.000Z");
  const service = createAlertService({
    database,
    config,
    broadcast() {},
    logger,
    now: () => currentTime,
  });

  database.latestReading = {
    timestamp: new Date(currentTime).toISOString(),
    temperature: 30,
    humidity: 50,
    pressure: 1000,
  };
  await service.evaluate(temperatureReading(30));
  await flushNotifications();
  assert.equal(sent.length, 1);

  currentTime += 4 * 60 * 1000;
  database.latestReading = {
    ...database.latestReading,
    timestamp: new Date(currentTime).toISOString(),
    temperature: 31,
  };
  await service.evaluate(temperatureReading(31));
  await flushNotifications();
  assert.equal(sent.length, 1);

  currentTime += 60 * 1000;
  database.latestReading = {
    ...database.latestReading,
    timestamp: new Date(currentTime).toISOString(),
    temperature: 32,
  };
  const restartedService = createAlertService({
    database,
    config,
    broadcast() {},
    logger,
    now: () => currentTime,
  });
  await restartedService.evaluate(temperatureReading(32));
  await flushNotifications();
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /อุณหภูมิ 32°C/);
  assert.equal(database.alerts.length, 1);
});

test("manual resolution can notify through the alert service", async (context) => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { database, service } = createService({
    config: { telegramBotToken: "test-token", telegramChatId: "test-chat" },
    logger: { warn() {} },
  });
  await service.evaluate(temperatureReading(30));
  service.notifyResolved({ ...database.alerts[0], resolved: 1 });
  await flushNotifications();

  assert.equal(sent.length, 2);
  assert.ok(sent.some(({ text }) => /alert RESOLVED/.test(text)));
});

test("missing or partial Telegram config disables delivery and logs a warning", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };
  const missing = createService({
    config: { telegramBotToken: "", telegramChatId: "" },
    logger,
  });
  const partial = createService({
    config: { telegramBotToken: "test-token", telegramChatId: "" },
    logger,
  });
  await missing.service.evaluate(temperatureReading(30, "missing"));
  await partial.service.evaluate(temperatureReading(30, "partial"));
  await flushNotifications();

  assert.equal(requests, 0);
  assert.equal(warnings.length, 2);
  assert.ok(
    warnings.every((message) => message.includes("Telegram notifications disabled")),
  );
  assert.ok(warnings.every((message) => !message.includes("test-token")));
});

test("Telegram provider/network failures are logged without rejecting alert evaluation", async (context) => {
  const originalFetch = globalThis.fetch;
  const warnings = [];
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) throw new Error("simulated network failure");
    return { ok: false, status: 503 };
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { database, service } = createService({
    config: { telegramBotToken: "test-token", telegramChatId: "test-chat" },
    logger: { warn: (message) => warnings.push(message) },
  });

  await assert.doesNotReject(service.evaluate(temperatureReading(30)));
  await assert.doesNotReject(
    service.evaluate(temperatureReading(30, "second-sensor")),
  );
  await flushNotifications();
  assert.equal(database.alerts.length, 2);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /request or provider response failed/);
  assert.match(warnings[1], /HTTP 503/);
  assert.ok(warnings.every((message) => !message.includes("test-token")));
});
