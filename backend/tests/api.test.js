import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { io as createSocketIoClient } from "socket.io-client";
import WebSocket from "ws";
import { createApplication } from "../src/app.js";

async function startTestApplication() {
  const application = await createApplication({
    runtimeConfig: {
      port: 0,
      databaseUrl: ":memory:",
      mqttBrokerUrl: "",
      mqttTopic: "serverroom/sensors/data",
      temperatureMin: 15,
      temperatureMax: 28,
      humidityMin: 20,
      humidityMax: 70,
      telegramBotToken: "",
      telegramChatId: "",
    },
    mqttEnabled: false,
    logger: { info() {}, warn() {}, error() {} },
  });
  const address = await application.listen(0, "127.0.0.1");
  return {
    ...application,
    baseUrl: `http://127.0.0.1:${address.port}`,
    webSocketUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

test("legacy device telemetry is stored and returned as latest and history", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());

  const response = await fetch(`${application.baseUrl}/api/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      temperature: 23.5,
      humidity: 48.2,
      pressure: 1008.4,
      presence: 1,
      motion: 0,
      status: "NORMAL",
    }),
  });
  assert.equal(response.status, 201);

  const latest = await fetch(
    `${application.baseUrl}/api/v1/sensors/latest`,
  ).then((result) => result.json());
  assert.equal(latest.data.temperature, 23.5);
  assert.equal(latest.data.sensor_id, "unknown");
  assert.equal(latest.data.smoke_detected, null);

  const history = await fetch(
    `${application.baseUrl}/api/v1/sensors/history?range=24h`,
  ).then((result) => result.json());
  assert.equal(history.data.length, 1);
  assert.equal(history.data[0].pressure, 1008.4);
});

test("room usage API reports unknown until valid occupancy arrives, then follows state", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());

  let roomUsage = await fetch(`${application.baseUrl}/api/v1/room-usage`)
    .then((result) => result.json());
  assert.equal(roomUsage.data.state, "UNKNOWN");

  const response = await fetch(`${application.baseUrl}/api/v1/sensors/data`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sensor_id: "room-api",
      temperature: 23,
      humidity: 45,
      presence: true,
      motion: false,
    }),
  });
  assert.equal(response.status, 201);
  roomUsage = await fetch(`${application.baseUrl}/api/v1/room-usage`)
    .then((result) => result.json());
  assert.equal(roomUsage.data.state, "PRESENCE DETECTED");
  assert.equal(roomUsage.data.sensor_id, "room-api");
});

test("sensor alarms are created once while active and resolve when readings recover", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());

  const sendReading = (
    temperature,
    waterLeak,
    smokeDetected = false,
    sensorId = "rack-1",
  ) =>
    fetch(`${application.baseUrl}/api/v1/sensors/data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sensor_id: sensorId,
        temperature,
        humidity: 50,
        water_leak: waterLeak,
        smoke_detected: smokeDetected,
      }),
    });

  assert.equal((await sendReading(31, true, true)).status, 201);
  await sendReading(32, true, true);
  let alerts = await fetch(
    `${application.baseUrl}/api/v1/alerts?resolved=false`,
  ).then((result) => result.json());
  assert.equal(alerts.data.length, 3);
  assert.deepEqual(
    new Set(alerts.data.map((alert) => alert.alert_type)),
    new Set(["temperature_high", "water_leak", "smoke_detected"]),
  );

  await sendReading(24, false, false, "rack-2");
  alerts = await fetch(
    `${application.baseUrl}/api/v1/alerts?resolved=false`,
  ).then((result) => result.json());
  assert.equal(alerts.data.length, 3);

  await sendReading(24, false, false);
  alerts = await fetch(
    `${application.baseUrl}/api/v1/alerts?resolved=true`,
  ).then((result) => result.json());
  assert.equal(alerts.data.length, 3);
});

test("temperature alerts escalate to critical and downgrade before resolving", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());

  const sendTemperature = (temperature) =>
    fetch(`${application.baseUrl}/api/v1/sensors/data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sensor_id: "temp-escalation", temperature }),
    });
  const getAlerts = () =>
    fetch(
      `${application.baseUrl}/api/v1/alerts?limit=100`,
    ).then((result) => result.json());

  await sendTemperature(30);
  let alerts = await getAlerts();
  assert.deepEqual(
    alerts.data.map(({ severity, resolved }) => [severity, resolved]),
    [["WARNING", 0]],
  );

  await sendTemperature(33);
  alerts = await getAlerts();
  assert.deepEqual(
    alerts.data.map(({ severity, resolved }) => [severity, resolved]),
    [
      ["CRITICAL", 0],
      ["WARNING", 1],
    ],
  );

  await sendTemperature(30);
  alerts = await getAlerts();
  assert.deepEqual(
    alerts.data.map(({ severity, resolved }) => [severity, resolved]),
    [
      ["WARNING", 0],
      ["CRITICAL", 1],
      ["WARNING", 1],
    ],
  );

  await sendTemperature(24);
  alerts = await getAlerts();
  assert.ok(alerts.data.every((alert) => alert.resolved === 1));
});

test("threshold updates reject invalid ranges and persist valid updates", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());

  const invalid = await fetch(
    `${application.baseUrl}/api/v1/settings/thresholds`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ temperature: { min: 35 } }),
    },
  );
  assert.equal(invalid.status, 400);

  const valid = await fetch(
    `${application.baseUrl}/api/v1/settings/thresholds`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ temperature: { max: 30 } }),
    },
  );
  assert.equal(valid.status, 200);
  const result = await valid.json();
  assert.equal(result.data.temperature.max, 30);
});

test("invalid telemetry is rejected and sensor updates are broadcast over WebSocket", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());
  const socket = new WebSocket(application.webSocketUrl);
  context.after(() => socket.terminate());
  const initialMessagePromise = once(socket, "message");
  await once(socket, "open");
  const [initialMessage] = await initialMessagePromise;
  assert.equal(JSON.parse(initialMessage.toString()).type, "connection:ready");

  const invalid = await fetch(`${application.baseUrl}/api/v1/sensors/data`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ temperature: 999 }),
  });
  assert.equal(invalid.status, 400);

  const updateMessage = (async () => {
    while (true) {
      const [message] = await once(socket, "message");
      if (JSON.parse(message.toString()).type === "sensor:updated") {
        return message;
      }
    }
  })();
  await fetch(`${application.baseUrl}/api/v1/sensors/data`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sensor_id: "rack-2",
      temperature: 22,
      humidity: 50,
    }),
  });
  const message = await updateMessage;
  assert.equal(JSON.parse(message.toString()).type, "sensor:updated");
});

test("manually resolving an alert broadcasts its resolved state over WebSocket", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());

  const createResponse = await fetch(
    `${application.baseUrl}/api/v1/sensors/data`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sensor_id: "rack-resolve", temperature: 31 }),
    },
  );
  assert.equal(createResponse.status, 201);
  const alerts = await fetch(`${application.baseUrl}/api/v1/alerts?resolved=false`)
    .then((response) => response.json());
  assert.equal(alerts.data.length, 1);

  const socket = new WebSocket(application.webSocketUrl);
  context.after(() => socket.terminate());
  const readyMessagePromise = once(socket, "message");
  await once(socket, "open");
  const [readyMessage] = await readyMessagePromise;
  assert.equal(JSON.parse(readyMessage.toString()).type, "connection:ready");

  const resolvedMessagePromise = once(socket, "message");
  const response = await fetch(
    `${application.baseUrl}/api/v1/alerts/${alerts.data[0].id}/resolve`,
    { method: "PUT" },
  );
  assert.equal(response.status, 200);
  const resolved = await response.json();
  assert.equal(resolved.data.resolved, 1);

  const [message] = await resolvedMessagePromise;
  const event = JSON.parse(message.toString());
  assert.equal(event.type, "alert:resolved");
  assert.equal(event.data.id, alerts.data[0].id);
  assert.equal(event.data.resolved, 1);
  assert.ok(event.data.resolved_at);
});

test("sensor updates are broadcast as named Socket.IO events", async (context) => {
  const application = await startTestApplication();
  context.after(() => application.close());

  const socket = createSocketIoClient(application.baseUrl, {
    transports: ["websocket"],
    reconnection: false,
  });
  context.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });

  const readingPromise = new Promise((resolve) =>
    socket.once("sensor:updated", resolve),
  );
  const roomUsagePromise = new Promise((resolve) =>
    socket.once("room:usage-updated", resolve),
  );
  const response = await fetch(`${application.baseUrl}/api/v1/sensors/data`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sensor_id: "socketio-01",
      temperature: 24,
      humidity: 45,
      pressure: 1010,
      presence: 1,
      motion: 0,
      status: "NORMAL",
    }),
  });
  assert.equal(response.status, 201);
  const reading = await readingPromise;
  assert.equal(reading.sensor_id, "socketio-01");
  assert.equal(reading.temperature, 24);
  const roomUsage = await roomUsagePromise;
  assert.equal(roomUsage.state, "PRESENCE DETECTED");
  const apiRoomUsage = await fetch(`${application.baseUrl}/api/v1/room-usage`)
    .then((result) => result.json());
  assert.equal(apiRoomUsage.data.state, roomUsage.state);
});
