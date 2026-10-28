import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./config/env.js";
import { createDatabase } from "./database.js";
import { createApiRouter } from "./routes/api.js";
import { createAlertService } from "./services/alertService.js";
import { startDailyReportScheduler } from "./services/dailyReportService.js";
import { startMqttSubscriber } from "./services/mqttService.js";
import { createTelegramClient } from "./services/telegramClient.js";
import { createRoomUsageService } from "./services/roomUsageService.js";
import { createTelemetryService } from "./services/telemetryService.js";

export async function createApplication({
  runtimeConfig = config,
  databaseUrl = runtimeConfig.databaseUrl,
  mqttEnabled = Boolean(runtimeConfig.mqttBrokerUrl),
  logger = console,
} = {}) {
  const database = await createDatabase(databaseUrl, {
    temperature_min: runtimeConfig.temperatureMin,
    temperature_max: runtimeConfig.temperatureMax,
    humidity_min: runtimeConfig.humidityMin,
    humidity_max: runtimeConfig.humidityMax,
  });

  const app = express();
  const server = createServer(app);
  const webSocketServer = new WebSocketServer({ noServer: true });
  const socketIoServer = new SocketIOServer(server, {
    cors: { origin: true },
  });
  const telegram = createTelegramClient(runtimeConfig, logger);

  function broadcast(event) {
    const message = JSON.stringify(event);
    socketIoServer.emit(event.type, event.data);
    for (const client of webSocketServer.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(message);
      } catch (error) {
        logger.warn(`WebSocket broadcast failed: ${error.message}`);
        client.terminate();
      }
    }
  }

  const roomUsageService = createRoomUsageService({
    database,
    broadcast,
    logger,
  });
  await roomUsageService.initialize();
  const alertService = createAlertService({
    database,
    config: runtimeConfig,
    telegram,
    broadcast,
    logger,
    getRoomUsage: roomUsageService.getState,
  });
  const telemetryService = createTelemetryService({
    database,
    alertService,
    roomUsageService,
    broadcast,
  });
  const stopDailyReport = startDailyReportScheduler({
    database,
    telegram,
    logger,
  });

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "64kb" }));
  app.get("/health", async (_request, response) => {
    await database.get("SELECT 1 AS ok");
    response.json({ status: "ok" });
  });
  app.use(
    "/api/v1",
    createApiRouter({
      database,
      telemetryService,
      alertService,
      roomUsageService,
      broadcast,
    }),
  );
  app.post("/api/telemetry", async (request, response) => {
    const reading = await telemetryService.ingest(request.body);
    response.status(201).json({ data: reading });
  });

  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    const status =
      error.status ??
      (error.type === "entity.parse.failed" ||
      error instanceof TypeError ||
      error instanceof RangeError
        ? 400
        : 500);
    if (status >= 500) logger.error(`Request failed: ${error.message}`);
    response
      .status(status)
      .json({ error: status >= 500 ? "Internal server error" : error.message });
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/socket.io/" || pathname === "/socket.io") return;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });
  webSocketServer.on("connection", (webSocket) => {
    webSocket.on("error", (error) =>
      logger.warn(`WebSocket error: ${error.message}`),
    );
    webSocket.send(JSON.stringify({ type: "connection:ready" }));
  });

  const mqttConnection = mqttEnabled
    ? startMqttSubscriber({
        brokerUrl: runtimeConfig.mqttBrokerUrl,
        topic: runtimeConfig.mqttTopic,
        onMessage: telemetryService.ingest,
        logger,
      })
    : { client: null, close: async () => {} };

  return {
    app,
    server,
    database,
    async listen(port = runtimeConfig.port, host = "0.0.0.0") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      stopDailyReport();
      await roomUsageService.close();
      await mqttConnection.close();
      for (const client of webSocketServer.clients) client.terminate();
      await new Promise((resolve) => webSocketServer.close(resolve));
      await new Promise((resolve) => socketIoServer.close(resolve));
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      await database.close();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const application = await createApplication();
    const address = await application.listen();
    console.info(`Smart Server Room API listening on port ${address.port}`);

    const shutdown = async () => {
      await application.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error(`Unable to start backend: ${error.message}`);
    process.exitCode = 1;
  }
}
