import assert from "node:assert/strict";
import test from "node:test";
import { ButtonStyle } from "discord.js";
import {
  buildCreateEventModal,
  buildCurrentRsvp,
  buildEventPreview,
  buildPublicEventMessage,
  buildReminderMessage,
  buildRsvpPrompt,
  buildTicketCheckout,
} from "../dist/event-ui.js";

const event = {
  id: 42,
  guild_id: "12345678901234567",
  announcement_channel_id: "22345678901234567",
  message_id: "32345678901234567",
  creator_id: "42345678901234567",
  title: "Griffith AI-Hackathon 2026",
  schedule_text: "Saturday 1 August 2026, 10:00 am–5:00 pm",
  location: "In person, Gold Coast — room TBD",
  announcement:
    "Secret long-form details about teams, lunch, prizes, and the afters.",
  artwork_url: null,
  artwork_name: null,
  status: "published",
  created_at: 100,
  published_at: 200,
};

test("serializes every event-creation modal field", () => {
  const modal = buildCreateEventModal("regression-test").toJSON();

  assert.equal(modal.custom_id, "event:create:regression-test");
  assert.equal(modal.components.length, 4);
  assert.deepEqual(
    modal.components.map(({ label }) => label),
    [
      "Announcement channel",
      "Event name",
      "Location",
      "Announcement",
    ],
  );
  assert.deepEqual(
    modal.components.map(({ component }) => component.custom_id),
    [
      "event-channel",
      "event-title",
      "event-location",
      "event-announcement",
    ],
  );
});

test("keeps payment separate and the long announcement out of RSVP prompts", () => {
  const publicMessage = buildPublicEventMessage(event);
  const rsvpPrompt = buildRsvpPrompt(event);

  assert.deepEqual(publicMessage.embeds ?? [], []);
  assert.match(publicMessage.content ?? "", /Secret long-form details/);
  assert.doesNotMatch(publicMessage.content ?? "", /\$0|reduced to/);

  assert.deepEqual(rsvpPrompt.embeds ?? [], []);
  assert.match(rsvpPrompt.content ?? "", /No payment is required/);
  assert.doesNotMatch(rsvpPrompt.content ?? "", /\$5|\$FREE/);
  assert.doesNotMatch(
    rsvpPrompt.content ?? "",
    /Secret long-form details/,
  );
  assert.match(rsvpPrompt.content ?? "", new RegExp(event.schedule_text));
  assert.doesNotMatch(rsvpPrompt.content ?? "", new RegExp(event.title));
  assert.match(rsvpPrompt.content ?? "", new RegExp(event.location));
});

test("shows uploaded artwork in the private preview", () => {
  const preview = buildEventPreview({
    ...event,
    artwork_url: "https://cdn.discordapp.com/attachments/example/artwork.png",
    artwork_name: "artwork.png",
  });

  assert.equal(preview.files?.length, 1);
  assert.equal(preview.files?.[0]?.name, "artwork.png");
  assert.doesNotMatch(preview.content ?? "", /Artwork attached/);
});

test("uses a gray RSVP button and no announcement link buttons", () => {
  const publicMessage = buildPublicEventMessage(event);
  const publicButton = publicMessage.components?.[0]?.components[0]?.toJSON();
  const privateMessages = [
    buildRsvpPrompt(event),
    buildCurrentRsvp(event),
  ];

  assert.equal(publicButton?.style, ButtonStyle.Secondary);

  for (const message of privateMessages) {
    const buttons =
      message.components?.[0]?.components.map((button) => button.toJSON()) ?? [];
    assert.doesNotMatch(
      buttons.map(({ label }) => label).join(" "),
      /View announcement/,
    );
    assert.ok(buttons.every(({ style }) => style !== ButtonStyle.Link));
  }
});

test("adds paid ticket pricing and secure Checkout to paid events", () => {
  const paidEvent = {
    ...event,
    ticket_price_cents: 1250,
    ticket_currency: "aud",
    ticket_limit: 50,
  };
  const publicMessage = buildPublicEventMessage(paidEvent);
  const buttons = publicMessage.components?.[0]?.components.map((button) =>
    button.toJSON(),
  );
  const checkout = buildTicketCheckout(
    paidEvent,
    "https://checkout.stripe.com/c/pay/test",
  );
  const checkoutButton = checkout.components?.[0]?.components[0]?.toJSON();

  assert.match(publicMessage.content ?? "", /Tickets: A\$12\.50/);
  assert.match(publicMessage.content ?? "", /50-ticket capacity/);
  assert.deepEqual(
    buttons?.map(({ label }) => label),
    ["Buy ticket — A$12.50"],
  );
  assert.equal(checkoutButton?.style, ButtonStyle.Link);
  assert.equal(
    checkoutButton?.url,
    "https://checkout.stripe.com/c/pay/test",
  );
});

test("clearly labels Stripe test-mode events and checkout", () => {
  const testEvent = {
    ...event,
    ticket_price_cents: 1250,
    ticket_currency: "aud",
    ticket_limit: 50,
    test_mode: true,
  };
  const publicMessage = buildPublicEventMessage(testEvent);
  const publicButton = publicMessage.components?.[0]?.components[0]?.toJSON();
  const checkout = buildTicketCheckout(
    testEvent,
    "https://checkout.stripe.com/test",
  );
  const checkoutButton = checkout.components?.[0]?.components[0]?.toJSON();

  assert.match(publicMessage.content ?? "", /TEST EVENT.*NO REAL MONEY/i);
  assert.equal(publicButton?.label, "Test checkout — A$12.50");
  assert.match(checkout.content ?? "", /No real money will be charged/i);
  assert.equal(checkoutButton?.label, "Open Stripe test checkout");
});

test("shows structured event and ticket closing times", () => {
  const timedEvent = {
    ...event,
    ticket_price_cents: 1250,
    ticket_currency: "aud",
    ticket_limit: 50,
    starts_at: 2_000,
    ends_at: 3_000,
    ticket_sales_close_at: 2_500,
  };
  const publicMessage = buildPublicEventMessage(timedEvent);
  const freeMessage = buildPublicEventMessage({
    ...event,
    ticket_price_cents: null,
    ticket_currency: null,
    starts_at: 2_000,
    ends_at: 3_000,
  });
  const reminder = buildReminderMessage(
    timedEvent,
    "@everyone Reminder",
    2_600,
  );
  const reminderButton = reminder.components?.[0]?.components[0]?.toJSON();

  assert.match(publicMessage.content ?? "", /<t:2000:F>/);
  assert.match(publicMessage.content ?? "", /<t:3000:F>/);
  assert.match(publicMessage.content ?? "", /Ticket sales close.*<t:2500:F>/s);
  assert.match(freeMessage.content ?? "", /RSVPs close.*<t:3000:F>/s);
  assert.equal(reminder.content, "@everyone Reminder");
  assert.deepEqual(reminder.allowedMentions?.parse, [
    "everyone",
    "roles",
    "users",
  ]);
  assert.equal(reminderButton?.custom_id, `event:buy:${event.id}`);
  assert.equal(reminderButton?.disabled, true);
});

test("uses plain message text throughout the event flow", () => {
  const messages = [
    buildEventPreview(event),
    buildPublicEventMessage(event),
    buildRsvpPrompt(event),
    buildCurrentRsvp(event),
  ];

  for (const message of messages) {
    assert.deepEqual(message.embeds ?? [], []);
    assert.equal(typeof message.content, "string");
    assert.ok(message.content.length > 0);
    assert.ok(message.content.length <= 2_000);
  }
});
