import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidStripeWebhookError,
  TicketingService,
} from "../dist/ticketing.js";

const event = {
  id: 42,
  guild_id: "12345678901234567",
  announcement_channel_id: "22345678901234567",
  message_id: "32345678901234567",
  creator_id: "42345678901234567",
  title: "Paid test event",
  schedule_text: "Saturday at 10:00 am",
  location: "Gold Coast",
  announcement: "Test event.",
  artwork_url: null,
  artwork_name: null,
  ticket_price_cents: 1250,
  ticket_currency: "aud",
  ticket_limit: 50,
  status: "published",
  created_at: 100,
  published_at: 200,
};

const pendingOrder = {
  id: 7,
  event_id: event.id,
  user_id: "52345678901234567",
  status: "pending",
  attempt: 1,
  checkout_session_id: null,
  checkout_url: null,
  stripe_payment_intent_id: null,
  stripe_charge_id: null,
  stripe_refund_id: null,
  customer_email: null,
  customer_name: null,
  amount_total: null,
  currency: null,
  created_at: 300,
  updated_at: 300,
  checkout_expires_at: Math.floor(Date.now() / 1000) + 1900,
  reservation_expires_at: Math.floor(Date.now() / 1000) + 2200,
  paid_at: null,
  refunded_at: null,
};

test("creates an idempotent Stripe Checkout Session for a ticket reservation", async () => {
  let createParameters;
  let requestOptions;
  const store = {
    async reserveTicketCheckout(eventId, userId) {
      assert.equal(eventId, event.id);
      assert.equal(userId, pendingOrder.user_id);
      return { alreadyPaid: false, order: pendingOrder };
    },
    async attachTicketCheckout(orderId, attempt, sessionId, url) {
      assert.deepEqual(
        { orderId, attempt, sessionId, url },
        {
          orderId: pendingOrder.id,
          attempt: 1,
          sessionId: "cs_test_ticket",
          url: "https://checkout.stripe.com/test",
        },
      );
      return {
        ...pendingOrder,
        checkout_session_id: sessionId,
        checkout_url: url,
      };
    },
  };
  const stripe = {
    checkout: {
      sessions: {
        async create(parameters, options) {
          createParameters = parameters;
          requestOptions = options;
          return {
            id: "cs_test_ticket",
            url: "https://checkout.stripe.com/test",
          };
        },
      },
    },
  };
  const service = new TicketingService(
    stripe,
    store,
    "https://club.example",
    "whsec_test",
  );
  const checkout = await service.startCheckout(event, pendingOrder.user_id);

  assert.equal(checkout.checkoutUrl, "https://checkout.stripe.com/test");
  assert.equal(createParameters.mode, "payment");
  assert.equal(createParameters.line_items[0].price_data.unit_amount, 1250);
  assert.equal(createParameters.line_items[0].price_data.currency, "aud");
  assert.deepEqual(createParameters.metadata, {
    ticket_order_id: "7",
    event_id: "42",
    discord_user_id: pendingOrder.user_id,
  });
  assert.equal(
    createParameters.success_url,
    "https://club.example/stripe/success?session_id={CHECKOUT_SESSION_ID}",
  );
  assert.equal(
    requestOptions.idempotencyKey,
    "ticket-order-7-attempt-1",
  );
});

test("verifies, retrieves, and fulfills a paid Checkout Session", async () => {
  const payload = Buffer.from("signed Stripe event");
  let fulfillment;
  let retrievedId;
  const checkout = {
    id: "cs_test_ticket",
    mode: "payment",
    payment_status: "paid",
    amount_total: 1250,
    currency: "aud",
    payment_intent: "pi_test_ticket",
    line_items: { data: [{ quantity: 1 }] },
    metadata: {
      ticket_order_id: "7",
      event_id: "42",
      discord_user_id: pendingOrder.user_id,
    },
    customer_details: {
      email: "member@example.com",
      name: "Test Member",
    },
  };
  const stripe = {
    webhooks: {
      constructEvent(receivedPayload, signature, secret) {
        assert.equal(receivedPayload, payload);
        assert.equal(signature, "test-signature");
        assert.equal(secret, "whsec_test");
        return {
          type: "checkout.session.completed",
          data: { object: { id: checkout.id } },
        };
      },
    },
    checkout: {
      sessions: {
        async retrieve(id) {
          retrievedId = id;
          return checkout;
        },
      },
    },
  };
  const store = {
    async getTicketOrder(id) {
      assert.equal(id, pendingOrder.id);
      return pendingOrder;
    },
    async getEvent(id) {
      assert.equal(id, event.id);
      return event;
    },
    async fulfillTicketOrder(orderId, sessionId, details) {
      fulfillment = { orderId, sessionId, details };
      return true;
    },
  };
  const service = new TicketingService(
    stripe,
    store,
    "https://club.example",
    "whsec_test",
  );

  await service.handleWebhook(payload, "test-signature");

  assert.equal(retrievedId, checkout.id);
  assert.deepEqual(fulfillment, {
    orderId: pendingOrder.id,
    sessionId: checkout.id,
    details: {
      paymentIntentId: "pi_test_ticket",
      customerEmail: "member@example.com",
      customerName: "Test Member",
      amountTotal: 1250,
      currency: "aud",
    },
  });
});

test("rejects a webhook whose Stripe signature is invalid", async () => {
  const service = new TicketingService(
    {
      webhooks: {
        constructEvent() {
          throw new Error("No signatures found");
        },
      },
    },
    {},
    "https://club.example",
    "whsec_test",
  );

  await assert.rejects(
    service.handleWebhook(Buffer.from("bad"), "bad-signature"),
    InvalidStripeWebhookError,
  );
});

test("revokes a ticket after a charge is fully refunded", async () => {
  const payload = Buffer.from("signed refund event");
  let revocation;
  const charge = {
    id: "ch_test_ticket",
    amount: 1250,
    amount_refunded: 1250,
    refunded: true,
    payment_intent: "pi_test_ticket",
    refunds: {
      data: [
        { id: "re_test_ticket", status: "succeeded" },
      ],
    },
  };
  const stripe = {
    webhooks: {
      constructEvent() {
        return {
          type: "charge.refunded",
          data: { object: { id: charge.id } },
        };
      },
    },
    charges: {
      async retrieve(id) {
        assert.equal(id, charge.id);
        return charge;
      },
    },
  };
  const store = {
    async refundTicketOrderByPaymentIntent(paymentIntentId, details) {
      revocation = { paymentIntentId, details };
      return true;
    },
  };
  const service = new TicketingService(
    stripe,
    store,
    "https://club.example",
    "whsec_test",
  );

  await service.handleWebhook(payload, "test-signature");

  assert.deepEqual(revocation, {
    paymentIntentId: "pi_test_ticket",
    details: {
      chargeId: "ch_test_ticket",
      refundId: "re_test_ticket",
    },
  });
});

test("does not revoke a ticket after a partial refund", async () => {
  let revocations = 0;
  const charge = {
    id: "ch_test_ticket",
    amount: 1250,
    amount_refunded: 500,
    refunded: false,
    payment_intent: "pi_test_ticket",
    refunds: { data: [] },
  };
  const service = new TicketingService(
    {
      webhooks: {
        constructEvent() {
          return {
            type: "charge.refunded",
            data: { object: { id: charge.id } },
          };
        },
      },
      charges: {
        async retrieve() {
          return charge;
        },
      },
    },
    {
      async refundTicketOrderByPaymentIntent() {
        revocations += 1;
        return true;
      },
    },
    "https://club.example",
    "whsec_test",
  );

  await service.handleWebhook(Buffer.from("partial"), "test-signature");

  assert.equal(revocations, 0);
});
