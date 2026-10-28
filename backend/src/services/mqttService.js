import mqtt from "mqtt";

export function startMqttSubscriber({
  brokerUrl,
  topic = "serverroom/sensors/data",
  onMessage,
  logger = console,
  mqttLibrary = mqtt,
}) {
  if (!brokerUrl) {
    return { client: null, close: async () => {} };
  }

  const client = mqttLibrary.connect(brokerUrl, {
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    client.subscribe(topic, { qos: 1 }, (error) => {
      if (error)
        logger.error(`MQTT subscription failed for ${topic}: ${error.message}`);
      else logger.info(`MQTT subscribed to ${topic}`);
    });
  });
  client.on("error", (error) =>
    logger.error(`MQTT connection error: ${error.message}`),
  );
  client.on("message", async (receivedTopic, buffer) => {
    if (receivedTopic !== topic) return;
    try {
      const payload = JSON.parse(buffer.toString("utf8"));
      await onMessage(payload);
    } catch (error) {
      logger.warn(`Rejected MQTT message on ${topic}: ${error.message}`);
    }
  });

  return {
    client,
    close: () =>
      new Promise((resolve, reject) => {
        client.end(false, {}, (error) => (error ? reject(error) : resolve()));
      }),
  };
}
