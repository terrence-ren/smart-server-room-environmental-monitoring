import { Router } from "express";

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseLimit(value, fallback = 500) {
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
    throw new RequestError("limit must be an integer between 1 and 2000");
  }
  return limit;
}

function parseRange(value = "24h") {
  const match = /^([1-9]\d*)(m|h|d)$/.exec(value);
  if (!match)
    throw new RequestError("range must use a value such as 30m, 24h, or 7d");

  const amount = Number(match[1]);
  const multiplier = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > 30 * 86_400_000) {
    throw new RequestError("range cannot exceed 30 days");
  }
  return {
    since: new Date(Date.now() - milliseconds).toISOString(),
    range: value,
  };
}

function readThresholdUpdates(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("Request body must be a JSON object");
  }

  const updates = {};
  const aliases = {
    temperature_min: "temperature_min",
    temperature_max: "temperature_max",
    humidity_min: "humidity_min",
    humidity_max: "humidity_max",
    temperatureMin: "temperature_min",
    temperatureMax: "temperature_max",
    humidityMin: "humidity_min",
    humidityMax: "humidity_max",
  };

  for (const [inputKey, value] of Object.entries(body)) {
    if (inputKey === "temperature" || inputKey === "humidity") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new RequestError(`${inputKey} must contain min and/or max`);
      }
      for (const [bound, threshold] of Object.entries(value)) {
        const key = `${inputKey}_${bound}`;
        if (!["min", "max"].includes(bound))
          throw new RequestError(`Invalid ${inputKey} threshold bound`);
        updates[key] = threshold;
      }
      continue;
    }

    const key = aliases[inputKey];
    if (!key) throw new RequestError(`Unknown threshold: ${inputKey}`);
    updates[key] = value;
  }

  if (Object.keys(updates).length === 0)
    throw new RequestError("At least one threshold is required");
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RequestError(`${key} must be a finite number`);
    }
  }
  return updates;
}

async function getThresholds(database) {
  const rows = await database.all("SELECT key, value FROM settings");
  const values = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  return {
    temperature: { min: values.temperature_min, max: values.temperature_max },
    humidity: { min: values.humidity_min, max: values.humidity_max },
  };
}

export function createApiRouter({
  database,
  telemetryService,
  alertService,
  roomUsageService,
  broadcast,
}) {
  const router = Router();

  router.post("/sensors/data", async (request, response) => {
    const reading = await telemetryService.ingest(request.body);
    response.status(201).json({ data: reading });
  });

  router.get("/sensors/latest", async (request, response) => {
    const sensorId = request.query.sensor_id;
    const reading = sensorId
      ? await database.get(
          "SELECT * FROM sensor_logs WHERE sensor_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1",
          [sensorId],
        )
      : await database.get(
          "SELECT * FROM sensor_logs ORDER BY timestamp DESC, id DESC LIMIT 1",
        );
    response.json({ data: reading ?? null });
  });

  router.get("/room-usage", async (_request, response) => {
    response.json({ data: await roomUsageService.getState() });
  });

  router.get("/sensors/history", async (request, response) => {
    const { since, range } = parseRange(request.query.range);
    const limit = parseLimit(request.query.limit);
    const sensorId = request.query.sensor_id;
    const readings = sensorId
      ? await database.all(
          `SELECT * FROM sensor_logs
         WHERE timestamp >= ? AND sensor_id = ? ORDER BY timestamp ASC, id ASC LIMIT ?`,
          [since, sensorId, limit],
        )
      : await database.all(
          `SELECT * FROM sensor_logs
         WHERE timestamp >= ? ORDER BY timestamp ASC, id ASC LIMIT ?`,
          [since, limit],
        );
    response.json({ data: readings, range });
  });

  router.get("/alerts", async (request, response) => {
    const limit = parseLimit(request.query.limit, 100);
    const resolved = request.query.resolved;
    if (resolved !== undefined && resolved !== "true" && resolved !== "false") {
      throw new RequestError("resolved must be true or false");
    }
    const alerts =
      resolved === undefined
        ? await database.all(
            "SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?",
            [limit],
          )
        : await database.all(
            "SELECT * FROM alerts WHERE resolved = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            [resolved === "true" ? 1 : 0, limit],
          );
    response.json({ data: alerts });
  });

  router.put("/alerts/:id/resolve", async (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1)
      throw new RequestError("Alert id must be a positive integer");
    const result = await database.run(
      "UPDATE alerts SET resolved = 1, resolved_at = ? WHERE id = ? AND resolved = 0",
      [new Date().toISOString(), id],
    );
    let resolvedAlert;
    if (result.changes > 0) {
      resolvedAlert = await database.get("SELECT * FROM alerts WHERE id = ?", [
        id,
      ]);
      broadcast({ type: "alert:resolved", data: resolvedAlert });
      alertService?.notifyResolved(resolvedAlert);
    }
    if (result.changes === 0) {
      const alert = await database.get("SELECT id FROM alerts WHERE id = ?", [
        id,
      ]);
      if (!alert) throw new RequestError("Alert not found", 404);
    }
    const alert =
      resolvedAlert ??
      (await database.get("SELECT * FROM alerts WHERE id = ?", [id]));
    response.json({ data: alert });
  });

  router.get("/settings/thresholds", async (_request, response) => {
    response.json({ data: await getThresholds(database) });
  });

  router.put("/settings/thresholds", async (request, response) => {
    const updates = readThresholdUpdates(request.body);
    const current = await database.all("SELECT key, value FROM settings");
    const thresholds = Object.fromEntries(
      current.map(({ key, value }) => [key, value]),
    );
    Object.assign(thresholds, updates);

    for (const metric of ["temperature", "humidity"]) {
      const minimum = thresholds[`${metric}_min`];
      const maximum = thresholds[`${metric}_max`];
      if (minimum >= maximum) {
        throw new RequestError(`${metric} minimum must be less than maximum`);
      }
    }

    const updatedAt = new Date().toISOString();
    for (const [key, value] of Object.entries(updates)) {
      await database.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, updatedAt],
      );
    }
    response.json({ data: await getThresholds(database) });
  });

  return router;
}
