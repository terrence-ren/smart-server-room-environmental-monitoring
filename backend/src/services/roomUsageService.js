const ABSENCE_CONFIRMATION_MS = 60_000;
const MAX_READING_AGE_MS = 15_000;

const STATE_LABELS = {
  UNKNOWN: "UNKNOWN",
  ABSENT: "NO PRESENCE",
  PRESENT: "PRESENCE DETECTED",
  MOTION: "MOTION DETECTED",
};

function validOccupancy(reading) {
  return (
    reading.presence === 1 ||
    reading.motion === 1 ||
    (reading.presence === 0 && reading.motion === 0)
  );
}

function nextOccupiedState(reading) {
  if (reading.motion === 1) return "MOTION";
  if (reading.presence === 1) return "PRESENT";
  return null;
}

export function createRoomUsageService({
  database,
  broadcast,
  logger = console,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let stopped = false;
  let operation = Promise.resolve();

  function serialize(work) {
    const result = operation.then(work, work);
    operation = result.catch((error) => {
      logger.error?.(`Room usage state update failed: ${error.message}`);
    });
    return result;
  }

  async function readStoredState() {
    return database.get("SELECT * FROM room_usage_state WHERE id = 1");
  }

  async function getState() {
    const stored = await readStoredState();
    if (!stored) {
      return {
        state: "UNKNOWN",
        absence_pending: false,
        sensor_id: null,
        last_observed_at: null,
        changed_at: null,
      };
    }

    const observedAt = stored.last_observed_at
      ? Date.parse(stored.last_observed_at)
      : Number.NaN;
    const fresh =
      Number.isFinite(observedAt) && now() - observedAt <= MAX_READING_AGE_MS;
    return {
      state: fresh ? STATE_LABELS[stored.state] : "UNKNOWN",
      absence_pending: fresh && Boolean(stored.absence_since),
      absence_since: fresh ? stored.absence_since : null,
      sensor_id: stored.sensor_id,
      last_observed_at: stored.last_observed_at,
      changed_at: stored.changed_at,
      stale: !fresh,
    };
  }

  async function emitState() {
    broadcast({ type: "room:usage-updated", data: await getState() });
  }

  function scheduleExpiry(absenceSince) {
    if (timer) clearTimer(timer);
    timer = null;
    if (stopped || !absenceSince) return;

    const dueAt = Date.parse(absenceSince) + ABSENCE_CONFIRMATION_MS;
    timer = setTimer(() => {
      timer = null;
      void serialize(() => expireAbsence(dueAt));
    }, Math.max(0, dueAt - now()));
  }

  async function expireAbsence(dueAt) {
    if (stopped) return;
    const stored = await readStoredState();
    if (!stored?.absence_since) return;
    const deadline = Date.parse(stored.absence_since) + ABSENCE_CONFIRMATION_MS;
    if (now() < deadline) {
      scheduleExpiry(stored.absence_since);
      return;
    }

    const lastObservedAt = Date.parse(stored.last_observed_at ?? "");
    if (
      !Number.isFinite(lastObservedAt) ||
      now() - lastObservedAt > MAX_READING_AGE_MS
    ) {
      await database.run(
        "UPDATE room_usage_state SET absence_since = NULL WHERE id = 1",
      );
      await emitState();
      return;
    }

    if (stored.state !== "ABSENT") {
      const changedAt = new Date(Math.max(deadline, dueAt)).toISOString();
      await database.run(
        `UPDATE room_usage_state
         SET state = 'ABSENT', absence_since = NULL, changed_at = ? WHERE id = 1`,
        [changedAt],
      );
      await emitState();
    } else {
      await database.run(
        "UPDATE room_usage_state SET absence_since = NULL WHERE id = 1",
      );
      await emitState();
    }
  }

  async function initialize() {
    await database.run(
      `INSERT OR IGNORE INTO room_usage_state
       (id, state, sensor_id, absence_since, last_observed_at, changed_at)
       VALUES (1, 'UNKNOWN', NULL, NULL, NULL, NULL)`,
    );
    const stored = await readStoredState();
    if (stored.absence_since) scheduleExpiry(stored.absence_since);
    return getState();
  }

  async function observe(reading) {
    return serialize(async () => {
      if (stopped) return getState();
      const stored = await readStoredState();
      if (!validOccupancy(reading)) {
        scheduleExpiry(null);
        await database.run(
          `UPDATE room_usage_state
           SET absence_since = NULL, last_observed_at = NULL WHERE id = 1`,
        );
        await emitState();
        return getState();
      }
      const timestamp = new Date(now()).toISOString();
      const occupiedState = nextOccupiedState(reading);

      if (occupiedState) {
        const changed = stored.state !== occupiedState;
        await database.run(
          `UPDATE room_usage_state
           SET state = ?, sensor_id = ?, absence_since = NULL,
               last_observed_at = ?, changed_at = ?
           WHERE id = 1`,
          [
            occupiedState,
            reading.sensor_id,
            timestamp,
            changed ? timestamp : stored.changed_at,
          ],
        );
        scheduleExpiry(null);
        await emitState();
        return getState();
      }

      if (stored.state === "ABSENT") {
        await database.run(
          `UPDATE room_usage_state
           SET sensor_id = ?, last_observed_at = ?, absence_since = NULL
           WHERE id = 1`,
          [reading.sensor_id, timestamp],
        );
        scheduleExpiry(null);
        await emitState();
        return getState();
      }

      const previousAt = Date.parse(stored.last_observed_at ?? "");
      const streamGap = !Number.isFinite(previousAt) ||
        now() - previousAt > MAX_READING_AGE_MS;
      const absenceSince = streamGap
        ? timestamp
        : stored.absence_since ?? timestamp;
      await database.run(
        `UPDATE room_usage_state
         SET sensor_id = ?, absence_since = ?, last_observed_at = ?
         WHERE id = 1`,
        [reading.sensor_id, absenceSince, timestamp],
      );
      scheduleExpiry(absenceSince);
      await emitState();
      return getState();
    });
  }

  async function close() {
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
    await operation;
  }

  return { initialize, observe, getState, close };
}
