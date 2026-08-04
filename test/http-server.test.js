import assert from "node:assert/strict";
import test from "node:test";
import { createHttpServer } from "../dist/health.js";

test("serves health and forwards an untouched signed Stripe webhook body", async () => {
  const payload = Buffer.from('{"type":"checkout.session.completed"}');
  let received;
  const server = createHttpServer(
    { isReady: () => true },
    {
      async handleWebhook(body, signature) {
        received = { body, signature };
      },
    },
  );
  const handler = server.listeners("request")[0];

  try {
    const healthResponse = responseFixture();
    await handler(
      { method: "GET", url: "/health", headers: {} },
      healthResponse,
    );
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(JSON.parse(healthResponse.body), { ready: true });

    const webhookResponse = responseFixture();
    await handler(
      requestFixture("/stripe/webhook", payload, {
        "stripe-signature": "test-signature",
      }),
      webhookResponse,
    );
    assert.equal(webhookResponse.status, 200);
    assert.equal(received.signature, "test-signature");
    assert.deepEqual(received.body, payload);

    const unsignedResponse = responseFixture();
    await handler(
      requestFixture("/stripe/webhook", payload),
      unsignedResponse,
    );
    assert.equal(unsignedResponse.status, 400);
  } finally {
    server.close();
  }
});

function requestFixture(url, body, headers = {}) {
  return {
    method: "POST",
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
}

function responseFixture() {
  return {
    status: undefined,
    body: undefined,
    writeHead(status) {
      this.status = status;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
}
