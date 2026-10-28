const numericRanges = {
  temperature: [-100, 200],
  humidity: [0, 100],
  pressure: [0, 2000],
};

function optionalNumber(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  const [minimum, maximum] = numericRanges[name];
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(
      `${name} must be a number between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function optionalBoolean(value, name) {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === 1 || value === "1" || value === "true")
    return 1;
  if (value === false || value === 0 || value === "0" || value === "false")
    return 0;
  throw new TypeError(`${name} must be a boolean or 0/1`);
}

function optionalString(value, name, maximumLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new TypeError(
      `${name} must be a string of at most ${maximumLength} characters`,
    );
  }
  return value;
}

export function normalizeTelemetry(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Telemetry payload must be a JSON object");
  }

  const sensorId = payload.sensor_id ?? payload.sensorId ?? "unknown";
  if (
    typeof sensorId !== "string" ||
    sensorId.trim().length === 0 ||
    sensorId.length > 100
  ) {
    throw new TypeError(
      "sensor_id must be a non-empty string of at most 100 characters",
    );
  }

  const timestampValue = payload.timestamp ?? payload.timestamp_utc;
  const timestamp =
    timestampValue === undefined
      ? new Date().toISOString()
      : new Date(timestampValue).toISOString();

  return {
    sensor_id: sensorId.trim(),
    temperature: optionalNumber(payload.temperature, "temperature"),
    humidity: optionalNumber(payload.humidity, "humidity"),
    pressure: optionalNumber(payload.pressure, "pressure"),
    smoke_detected: optionalBoolean(
      payload.smoke_detected ?? payload.smokeDetected,
      "smoke_detected",
    ),
    water_leak: optionalBoolean(
      payload.water_leak ?? payload.waterLeak,
      "water_leak",
    ),
    presence: optionalBoolean(payload.presence, "presence"),
    motion: optionalBoolean(payload.motion, "motion"),
    status: optionalString(payload.status, "status", 32),
    timestamp,
  };
}

export function createTelemetryService({
  database,
  alertService,
  roomUsageService,
  broadcast,
}) {
  async function ingest(payload) {
    const reading = normalizeTelemetry(payload);
    const result = await database.run(
      `INSERT INTO sensor_logs (
        sensor_id, temperature, humidity, pressure, smoke_detected, water_leak,
        presence, motion, status, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reading.sensor_id,
        reading.temperature,
        reading.humidity,
        reading.pressure,
        reading.smoke_detected,
        reading.water_leak,
        reading.presence,
        reading.motion,
        reading.status,
        reading.timestamp,
      ],
    );

    const storedReading = await database.get(
      "SELECT * FROM sensor_logs WHERE id = ?",
      [result.lastID],
    );

    await roomUsageService?.observe(reading);
    await alertService.evaluate(reading);
    broadcast({ type: "sensor:updated", data: storedReading });
    return storedReading;
  }

  return { ingest };
}
