import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startMqttSubscriber } from "../src/services/mqttService.js";

test("MQTT subscriber subscribes to the configured topic and parses JSON payloads", async () => {
  class MockClient extends EventEmitter {
    subscribe(topic, options, callback) {
      this.subscription = { topic, options };
      callback();
    }

    end(_force, _options, callback) {
      callback();
    }
  }

  const client = new MockClient();
  const messages = [];
  const logger = { info() {}, warn() {}, error() {} };
  const subscriber = startMqttSubscriber({
    brokerUrl: "mqtt://broker.example",
    topic: "serverroom/sensors/data",
    onMessage: (payload) => messages.push(payload),
    logger,
    mqttLibrary: { connect: () => client },
  });

  client.emit("connect");
  assert.deepEqual(client.subscription, {
    topic: "serverroom/sensors/data",
    options: { qos: 1 },
  });
  client.emit(
    "message",
    "serverroom/sensors/data",
    Buffer.from('{"temperature":26}'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages, [{ temperature: 26 }]);
  await subscriber.close();
});
