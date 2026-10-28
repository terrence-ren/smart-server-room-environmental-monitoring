import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });

function readNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }
  return parsed;
}

const port = readNumber("PORT", 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

export const config = {
  port,
  databaseUrl: process.env.DATABASE_URL || "./data/server-room.db",
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || "",
  mqttTopic: process.env.MQTT_TOPIC || "serverroom/sensors/data",
  temperatureMin: readNumber("TEMP_THRESHOLD_MIN", 15),
  temperatureMax: readNumber("TEMP_THRESHOLD_MAX", 28),
  humidityMin: readNumber("HUMIDITY_THRESHOLD_MIN", 20),
  humidityMax: readNumber("HUMIDITY_THRESHOLD_MAX", 70),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
};

if (config.temperatureMin >= config.temperatureMax) {
  throw new Error("TEMP_THRESHOLD_MIN must be less than TEMP_THRESHOLD_MAX");
}
if (config.humidityMin >= config.humidityMax) {
  throw new Error(
    "HUMIDITY_THRESHOLD_MIN must be less than HUMIDITY_THRESHOLD_MAX",
  );
}
