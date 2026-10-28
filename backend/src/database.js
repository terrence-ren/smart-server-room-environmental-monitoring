import sqlite3 from "sqlite3";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BACKEND_ROOT } from "./config/env.js";

const schema = `
  CREATE TABLE IF NOT EXISTS sensor_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id TEXT NOT NULL DEFAULT 'unknown',
    temperature REAL,
    humidity REAL,
    pressure REAL,
    smoke_detected INTEGER CHECK (smoke_detected IN (0, 1) OR smoke_detected IS NULL),
    water_leak INTEGER CHECK (water_leak IN (0, 1) OR water_leak IS NULL),
    presence INTEGER CHECK (presence IN (0, 1) OR presence IS NULL),
    motion INTEGER CHECK (motion IN (0, 1) OR motion IS NULL),
    status TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sensor_logs_sensor_timestamp
    ON sensor_logs (sensor_id, timestamp DESC);

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id TEXT NOT NULL DEFAULT 'unknown',
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    message TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_created_at
    ON alerts (created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_alerts_active_sensor_type
    ON alerts (sensor_id, alert_type) WHERE resolved = 0;

  CREATE TABLE IF NOT EXISTS telegram_reports (
    report_date TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_alert_reports (
    alert_id INTEGER PRIMARY KEY,
    last_attempt_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_usage_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state TEXT NOT NULL CHECK (state IN ('UNKNOWN', 'ABSENT', 'PRESENT', 'MOTION')),
    sensor_id TEXT,
    absence_since TEXT,
    last_observed_at TEXT,
    changed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function openDatabase(filename) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

export async function createDatabase(databaseUrl, thresholds) {
  const filename =
    databaseUrl === ":memory:"
      ? databaseUrl
      : path.resolve(BACKEND_ROOT, databaseUrl);

  if (filename !== ":memory:") {
    await mkdir(path.dirname(filename), { recursive: true });
  }

  const connection = await openDatabase(filename);
  const database = {
    run(sql, parameters = []) {
      return new Promise((resolve, reject) => {
        connection.run(sql, parameters, function onRun(error) {
          if (error) reject(error);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, parameters = []) {
      return new Promise((resolve, reject) => {
        connection.get(sql, parameters, (error, row) => {
          if (error) reject(error);
          else resolve(row);
        });
      });
    },
    all(sql, parameters = []) {
      return new Promise((resolve, reject) => {
        connection.all(sql, parameters, (error, rows) => {
          if (error) reject(error);
          else resolve(rows);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        connection.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };

  await database.run("PRAGMA foreign_keys = ON");
  if (filename !== ":memory:") await database.run("PRAGMA journal_mode = WAL");
  await new Promise((resolve, reject) => {
    connection.exec(schema, (error) => (error ? reject(error) : resolve()));
  });

  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(thresholds)) {
    await database.run(
      "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
      [key, value, now],
    );
  }

  return database;
}
