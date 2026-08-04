import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  EventUnavailableError,
  setupDatabase,
  Store,
  TicketSoldOutError,
} from "../dist/database.js";

async function fixture(eventOverrides = {}) {
  const memory = newDb();
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  await setupDatabase(pool);
  const store = new Store(pool);
  const event = await store.createEventDraft(
    {
      guildId: "12345678901234567",
      announcementChannelId: "22345678901234567",
      creatorId: "32345678901234567",
      title: "Test event",
      scheduleText: "Saturday, 10:00 am–5:00 pm",
      location: "Gold Coast",
      announcement: "A complete announcement.",
      ...eventOverrides,
    },
    100,
  );

  return {
    store,
    event,
    async close() {
      await store.close();
    },
  };
}

test("publishes a draft exactly once", async () => {
  const context = await fixture();

  try {
    assert.equal(context.event.status, "draft");
    assert.equal(
      await context.store.claimEventForPublishing(context.event.id),
      true,
    );
    assert.equal(
      await context.store.claimEventForPublishing(context.event.id),
      false,
    );

    await context.store.finishPublishing(
      context.event.id,
      "42345678901234567",
      200,
    );
    const published = await context.store.getEvent(context.event.id);

    assert.equal(published?.status, "published");
    assert.equal(published?.message_id, "42345678901234567");
    assert.equal(published?.published_at, 200);
  } finally {
    await context.close();
  }
});

test("reserves capacity and fulfills a paid ticket exactly once", async () => {
  const context = await fixture({
    ticketPriceCents: 1250,
    ticketCurrency: "aud",
    ticketLimit: 1,
  });

  try {
    await context.store.claimEventForPublishing(context.event.id);
    await context.store.finishPublishing(
      context.event.id,
      "42345678901234567",
      200,
    );
    const reservation = await context.store.reserveTicketCheckout(
      context.event.id,
      "52345678901234567",
      300,
    );

    assert.equal(reservation.alreadyPaid, false);
    assert.equal(reservation.order.status, "pending");
    await assert.rejects(
      context.store.reserveTicketCheckout(
        context.event.id,
        "62345678901234567",
        301,
      ),
      TicketSoldOutError,
    );

    const attached = await context.store.attachTicketCheckout(
      reservation.order.id,
      reservation.order.attempt,
      "cs_test_ticket",
      "https://checkout.stripe.com/test",
      302,
    );
    assert.equal(attached.checkout_session_id, "cs_test_ticket");

    const details = {
      paymentIntentId: "pi_test_ticket",
      customerEmail: "member@example.com",
      customerName: "Test Member",
      amountTotal: 1250,
      currency: "aud",
    };
    assert.equal(
      await context.store.fulfillTicketOrder(
        attached.id,
        "cs_test_ticket",
        details,
        400,
      ),
      true,
    );
    assert.equal(
      await context.store.fulfillTicketOrder(
        attached.id,
        "cs_test_ticket",
        details,
        401,
      ),
      false,
    );

    const paid = await context.store.getTicketOrderForMember(
      context.event.id,
      "52345678901234567",
    );
    assert.equal(paid?.status, "paid");
    assert.equal(paid?.amount_total, 1250);
    assert.equal(paid?.customer_email, "member@example.com");
    assert.equal(
      (
        await context.store.reserveTicketCheckout(
          context.event.id,
          "52345678901234567",
          500,
        )
      ).alreadyPaid,
      true,
    );
  } finally {
    await context.close();
  }
});

test("releases abandoned ticket capacity after the webhook grace period", async () => {
  const context = await fixture({
    ticketPriceCents: 500,
    ticketCurrency: "aud",
    ticketLimit: 1,
  });

  try {
    await context.store.claimEventForPublishing(context.event.id);
    await context.store.finishPublishing(
      context.event.id,
      "42345678901234567",
      200,
    );
    const abandoned = await context.store.reserveTicketCheckout(
      context.event.id,
      "52345678901234567",
      300,
      60,
      10,
    );
    const replacement = await context.store.reserveTicketCheckout(
      context.event.id,
      "62345678901234567",
      abandoned.order.reservation_expires_at + 1,
      60,
      10,
    );

    assert.equal(replacement.order.user_id, "62345678901234567");
  } finally {
    await context.close();
  }
});

test("records only real RSVP state changes and queues their audit trail", async () => {
  const context = await fixture();

  try {
    await context.store.claimEventForPublishing(context.event.id);
    await context.store.finishPublishing(
      context.event.id,
      "42345678901234567",
      200,
    );

    const confirmed = await context.store.confirmRsvp(
      context.event.id,
      "52345678901234567",
      300,
    );
    const duplicate = await context.store.confirmRsvp(
      context.event.id,
      "52345678901234567",
      301,
    );

    assert.deepEqual(confirmed, { changed: true, status: "active" });
    assert.deepEqual(duplicate, { changed: false, status: "active" });
    assert.equal(
      await context.store.countRsvpHistory(context.event.id),
      1,
    );

    const cancellation = await context.store.cancelRsvp(
      context.event.id,
      "52345678901234567",
      400,
    );
    const duplicateCancellation = await context.store.cancelRsvp(
      context.event.id,
      "52345678901234567",
      401,
    );

    assert.deepEqual(cancellation, {
      changed: true,
      status: "cancelled",
    });
    assert.deepEqual(duplicateCancellation, {
      changed: false,
      status: "cancelled",
    });
    assert.equal(
      await context.store.countRsvpHistory(context.event.id),
      2,
    );

    const audits = await context.store.getPendingAudit(500);
    assert.deepEqual(
      audits.map(({ action }) => action),
      ["rsvp", "cancel"],
    );
    assert.equal(audits[0]?.message_id, "42345678901234567");
  } finally {
    await context.close();
  }
});

test("rejects RSVPs before an event is published", async () => {
  const context = await fixture();

  try {
    await assert.rejects(
      context.store.confirmRsvp(
        context.event.id,
        "52345678901234567",
        300,
      ),
      EventUnavailableError,
    );
    assert.equal(
      await context.store.countRsvpHistory(context.event.id),
      0,
    );
  } finally {
    await context.close();
  }
});

test("keeps open event forms across database pool restarts", async () => {
  const memory = newDb();
  const adapter = memory.adapters.createPg();
  let pool = new adapter.Pool();
  await setupDatabase(pool);
  let store = new Store(pool);

  try {
    await store.createPendingEventCreate(
      {
        token: "persistent-form",
        userId: "12345678901234567",
        guildId: "22345678901234567",
        artworkUrl: "https://cdn.discordapp.com/artwork.png",
        artworkName: "artwork.png",
        ticketPriceCents: 1250,
        ticketCurrency: "aud",
        ticketLimit: 50,
      },
      100,
      900,
    );
    await store.close();

    pool = new adapter.Pool();
    store = new Store(pool);
    const pending = await store.getPendingEventCreate(
      "persistent-form",
      200,
    );

    assert.equal(pending?.user_id, "12345678901234567");
    assert.equal(pending?.guild_id, "22345678901234567");
    assert.equal(pending?.artwork_name, "artwork.png");
    assert.equal(pending?.ticket_price_cents, 1250);
    assert.equal(pending?.ticket_currency, "aud");
    assert.equal(pending?.ticket_limit, 50);
    assert.equal(
      await store.getPendingEventCreate("persistent-form", 1_000),
      undefined,
    );
    assert.equal(
      await store.consumePendingEventCreate(
        "persistent-form",
        "wrong-user",
        "22345678901234567",
        200,
      ),
      undefined,
    );
    const consumed = await store.consumePendingEventCreate(
      "persistent-form",
      "12345678901234567",
      "22345678901234567",
      200,
    );
    assert.equal(consumed?.artwork_name, "artwork.png");
    assert.equal(
      await store.getPendingEventCreate("persistent-form", 200),
      undefined,
    );
  } finally {
    await store.close();
  }
});
