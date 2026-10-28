import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../src/database.js";
import { createRoomUsageService } from "../src/services/roomUsageService.js";

class FakeClock {
  current = 0;
  nextId = 0;
  timers = new Map();

  now = () => this.current;

  setTimeout = (callback, delay) => {
    const id = ++this.nextId;
    this.timers.set(id, {
      callback,
      dueAt: this.current + delay,
    });
    return id;
  };

  clearTimeout = (id) => this.timers.delete(id);

  async advance(milliseconds) {
    const target = this.current + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.current = timer.dueAt;
      timer.callback();
      await settleAsyncWork();
    }
    this.current = target;
    await settleAsyncWork();
  }
}

async function settleAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function setup(clock) {
  const database = await createDatabase(":memory:", {
    temperature_min: 15,
    temperature_max: 28,
    humidity_min: 20,
    humidity_max: 70,
  });
  const service = createRoomUsageService({
    database,
    broadcast() {},
    logger: { warn() {}, error() {} },
    now: clock.now,
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
  });
  await service.initialize();
  return { database, service };
}

const noPresenceReading = {
  sensor_id: "room-1",
  presence: 0,
  motion: 0,
};

test("room usage transitions are debounced without separate Telegram messages", async (context) => {
  const clock = new FakeClock();
  const messages = [];
  const { database, service } = await setup(clock);
  context.after(async () => {
    await service.close();
    await database.close();
  });

  await database.run(
    `INSERT INTO sensor_logs
     (sensor_id, temperature, humidity, pressure, smoke_detected, water_leak, timestamp)
     VALUES ('room-1', 23.5, 46, 1012, 0, 0, ?)`,
    [new Date(clock.now()).toISOString()],
  );

  let state = await service.observe(noPresenceReading);
  assert.equal(state.state, "UNKNOWN");
  assert.equal(state.absence_pending, true);
  assert.equal(messages.length, 0);

  for (let second = 5; second <= 55; second += 5) {
    await clock.advance(5_000);
    state = await service.observe(noPresenceReading);
    assert.equal(state.state, "UNKNOWN");
  }
  assert.equal(messages.length, 0);

  await clock.advance(5_000);
  state = await service.getState();
  assert.equal(state.state, "NO PRESENCE");
  assert.equal(state.absence_pending, false);
  assert.equal(messages.length, 0);

  state = await service.observe({
    sensor_id: "room-1",
    presence: 1,
    motion: 0,
  });
  assert.equal(state.state, "PRESENCE DETECTED");
  await settleAsyncWork();
  await service.observe({ sensor_id: "room-1", presence: 1, motion: 0 });
  await settleAsyncWork();
  assert.equal(messages.length, 0);

  state = await service.observe({
    sensor_id: "room-1",
    presence: 1,
    motion: 1,
  });
  assert.equal(state.state, "MOTION DETECTED");
  await settleAsyncWork();
  await service.observe({ sensor_id: "room-1", presence: 1, motion: 1 });
  await settleAsyncWork();
  assert.equal(messages.length, 0);

  state = await service.observe({
    sensor_id: "room-1",
    presence: 1,
    motion: 0,
  });
  assert.equal(state.state, "PRESENCE DETECTED");
  await settleAsyncWork();
  assert.equal(messages.length, 0);

  await service.observe(noPresenceReading);
  for (let second = 5; second <= 55; second += 5) {
    await clock.advance(5_000);
    await service.observe(noPresenceReading);
  }
  assert.equal((await service.getState()).state, "PRESENCE DETECTED");
  assert.equal(messages.length, 0);
  await clock.advance(5_000);
  assert.equal((await service.getState()).state, "NO PRESENCE");
  assert.equal(messages.length, 0);
});

test("missing occupancy fields cancel absence confirmation and expose unknown", async (context) => {
  const clock = new FakeClock();
  const messages = [];
  const { database, service } = await setup(clock);
  context.after(async () => {
    await service.close();
    await database.close();
  });

  await service.observe(noPresenceReading);
  await clock.advance(10_000);
  const missing = await service.observe({
    sensor_id: "room-1",
    presence: null,
    motion: null,
  });
  assert.equal(missing.state, "UNKNOWN");
  assert.equal(missing.absence_pending, false);
  await clock.advance(60_000);
  assert.equal((await service.getState()).state, "UNKNOWN");
  assert.equal(messages.length, 0);

  const present = await service.observe({
    sensor_id: "room-1",
    presence: 1,
    motion: null,
  });
  assert.equal(present.state, "PRESENCE DETECTED");
});

test("absence deadline survives service restart while fresh clear readings continue", async (context) => {
  const clock = new FakeClock();
  const messages = [];
  const { database, service } = await setup(clock);
  await service.observe(noPresenceReading);
  await clock.advance(10_000);
  await service.observe(noPresenceReading);
  await service.close();

  const restarted = createRoomUsageService({
    database,
    broadcast() {},
    logger: { warn() {}, error() {} },
    now: clock.now,
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
  });
  context.after(async () => {
    await restarted.close();
    await database.close();
  });
  await restarted.initialize();

  for (let second = 15; second <= 55; second += 5) {
    await clock.advance(5_000);
    await restarted.observe(noPresenceReading);
  }
  assert.equal((await restarted.getState()).state, "UNKNOWN");
  await clock.advance(5_000);
  assert.equal((await restarted.getState()).state, "NO PRESENCE");
  assert.equal(messages.length, 0);
});
