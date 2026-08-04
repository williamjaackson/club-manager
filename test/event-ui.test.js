import assert from "node:assert/strict";
import test from "node:test";
import { ButtonStyle } from "discord.js";
import {
  buildCancellationComplete,
  buildCouponChoice,
  buildCreateEventAdmissionModal,
  buildCreateEventDetailsModal,
  buildCreateEventScheduleModal,
  buildCurrentRsvp,
  buildEventPreview,
  buildPublicEventMessage,
  buildReminderMessage,
  buildRsvpComplete,
  buildRsvpPrompt,
  buildTicketCheckout,
  buildTicketConfirmed,
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
  announcement: "Secret long-form details about teams, lunch, prizes, and the afters.",
  artwork_url: null,
  artwork_name: null,
  status: "published",
  created_at: 100,
  published_at: 200,
};

test("serializes every step of the event-creation wizard", () => {
  const token = "a".repeat(32);
  const modal = buildCreateEventDetailsModal(token).toJSON();
  const schedule = buildCreateEventScheduleModal(token).toJSON();
  const admission = buildCreateEventAdmissionModal(token).toJSON();

  assert.equal(modal.custom_id, `event:create:details:${token}`);
  assert.equal(modal.components.length, 5);
  assert.deepEqual(
    modal.components.map(({ label }) => label),
    [
      "Announcement channel",
      "Event name",
      "Location",
      "Announcement",
      "Artwork (optional)",
    ],
  );
  assert.deepEqual(
    modal.components.map(({ component }) => component.custom_id),
    [
      "event-channel",
      "event-title",
      "event-location",
      "event-announcement",
      "event-artwork",
    ],
  );
  assert.deepEqual(
    schedule.components.map(({ component }) => component.custom_id),
    [
      "event-starts-at",
      "event-ends-at",
      "event-ticket-sales-close-at",
      "event-location-url",
    ],
  );
  assert.deepEqual(
    admission.components.map(({ component }) => component.custom_id),
    ["event-ticket-price", "event-capacity", "event-test-mode"],
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
  assert.doesNotMatch(rsvpPrompt.content ?? "", /Secret long-form details/);
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
  const privateMessages = [buildRsvpPrompt(event), buildCurrentRsvp(event)];

  assert.equal(publicButton?.style, ButtonStyle.Secondary);

  for (const message of privateMessages) {
    const buttons =
      message.components?.[0]?.components.map((button) => button.toJSON()) ?? [];
    assert.doesNotMatch(buttons.map(({ label }) => label).join(" "), /View announcement/);
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
  assert.equal(checkoutButton?.url, "https://checkout.stripe.com/c/pay/test");
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
  const checkout = buildTicketCheckout(testEvent, "https://checkout.stripe.com/test");
  const checkoutButton = checkout.components?.[0]?.components[0]?.toJSON();

  assert.match(publicMessage.content ?? "", /-# 🧪 Test event — Stripe test mode/);
  assert.equal(publicButton?.label, "Test checkout — A$12.50");
  assert.match(checkout.content ?? "", /Stripe test card/);
  assert.match(checkout.content ?? "", /-# 🧪 Test event — Stripe test mode/);
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
    ticket_limit: 25,
    starts_at: 2_000,
    ends_at: 3_000,
  });
  const openEndedMessage = buildPublicEventMessage({
    ...event,
    ticket_price_cents: null,
    ticket_currency: null,
    ticket_limit: null,
    starts_at: 2_000,
    ends_at: null,
  });
  const manuallyClosedFreeEvent = {
    ...event,
    ticket_price_cents: null,
    ticket_currency: null,
    ticket_limit: 25,
    starts_at: 2_000,
    ends_at: null,
    ticket_sales_close_at: 2_500,
  };
  const closedFreeMessage = buildPublicEventMessage(manuallyClosedFreeEvent);
  const closedFreeReminder = buildReminderMessage(
    manuallyClosedFreeEvent,
    "Closed",
    2_600,
  );
  const reminder = buildReminderMessage(timedEvent, "@everyone Reminder", 2_600);
  const reminderButton = reminder.components?.[0]?.components[0]?.toJSON();

  assert.match(publicMessage.content ?? "", /📅 <t:2000:F> \(<t:2000:R>\) – <t:3000:t>/);
  assert.match(publicMessage.content ?? "", /Ticket sales close.*<t:2500:F>/s);
  assert.match(freeMessage.content ?? "", /RSVP capacity.*25 people/s);
  assert.match(freeMessage.content ?? "", /RSVPs close.*<t:3000:F>/s);
  assert.doesNotMatch(openEndedMessage.content ?? "", /Finishes|RSVPs close/);
  assert.match(closedFreeMessage.content ?? "", /RSVPs close.*<t:2500:F>/s);
  assert.equal(
    closedFreeReminder.components?.[0]?.components[0]?.toJSON().disabled,
    true,
  );
  assert.equal(reminder.content, "@everyone Reminder");
  assert.deepEqual(reminder.allowedMentions?.parse, ["everyone", "roles", "users"]);
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

test("collapses same-day schedules and links Google Maps locations", () => {
  const sameDay = buildPublicEventMessage({
    ...event,
    starts_at: 2_000,
    ends_at: 3_000,
    location_url: "https://maps.app.goo.gl/club123",
  });
  const multiDay = buildPublicEventMessage({
    ...event,
    starts_at: 2_000,
    ends_at: 2_000 + 3 * 86_400,
    location_url: null,
  });

  assert.match(sameDay.content ?? "", /📅 <t:2000:F> \(<t:2000:R>\) – <t:3000:t>/);
  assert.doesNotMatch(sameDay.content ?? "", /Starts:|Finishes:/);
  assert.match(
    sameDay.content ?? "",
    /📍 \[\*\*In person, Gold Coast — room TBD\*\*\]\(<https:\/\/maps\.app\.goo\.gl\/club123>\)/,
  );

  assert.match(multiDay.content ?? "", /\*\*Starts:\*\* <t:2000:F>/);
  assert.match(multiDay.content ?? "", /\*\*Finishes:\*\* <t:261200:F>/);
  assert.match(multiDay.content ?? "", /📍 \*\*In person, Gold Coast — room TBD\*\*/);
});

test("marks every test-mode interaction with the shared subtext note", () => {
  const testEvent = { ...event, test_mode: true };
  const note = /-# 🧪 Test event — Stripe test mode, no real money is charged/;

  assert.match(buildPublicEventMessage(testEvent).content ?? "", note);
  assert.match(buildRsvpPrompt(testEvent).content ?? "", note);
  assert.match(buildRsvpComplete(testEvent, true).content ?? "", note);
  assert.match(buildCancellationComplete(testEvent, true).content ?? "", note);
  assert.match(buildTicketConfirmed(testEvent).content ?? "", note);
  assert.doesNotMatch(buildPublicEventMessage(event).content ?? "", /-# 🧪/);
});

test("shows live attendance and sold-out states on announcements", () => {
  const paidEvent = {
    ...event,
    ticket_price_cents: 1250,
    ticket_currency: "aud",
    ticket_limit: 20,
  };
  const selling = buildPublicEventMessage(paidEvent, { going: 14 });
  const soldOut = buildPublicEventMessage(paidEvent, { going: 20 });
  const freeFull = buildPublicEventMessage({ ...event, ticket_limit: 5 }, { going: 5 });

  assert.match(selling.content ?? "", /-# 🎟️ 14 sold · 6 left/);
  assert.equal(selling.components?.[0]?.components[0]?.toJSON().disabled, false);

  assert.match(soldOut.content ?? "", /-# 🎟️ 20 sold · none left/);
  const soldOutButton = soldOut.components?.[0]?.components[0]?.toJSON();
  assert.equal(soldOutButton?.disabled, true);
  assert.equal(soldOutButton?.label, "Sold out");

  const fullButton = freeFull.components?.[0]?.components[0]?.toJSON();
  assert.match(freeFull.content ?? "", /-# 🙋 5 going · none left/);
  assert.equal(fullButton?.label, "At capacity");
  assert.equal(fullButton?.disabled, true);
});

test("offers coupon choice with save only for transferable coupons", () => {
  const paidEvent = { ...event, ticket_price_cents: 2000, ticket_currency: "aud" };
  const anywhere = buildCouponChoice(
    paidEvent,
    { percent_off: 25, event_id: null, expires_at: 1_000 },
    1500,
  );
  const scoped = buildCouponChoice(
    paidEvent,
    { percent_off: 100, event_id: 42, expires_at: null },
    0,
  );

  const anywhereButtons = anywhere.components?.[0]?.components.map((b) => b.toJSON());
  assert.equal(anywhereButtons?.length, 2);
  assert.match(anywhereButtons?.[0]?.label ?? "", /Apply coupon — pay A\$15\.00/);
  assert.match(anywhereButtons?.[1]?.label ?? "", /Save coupon — pay A\$20\.00/);
  assert.match(anywhere.content ?? "", /expires <t:1000:R>/);

  const scopedButtons = scoped.components?.[0]?.components.map((b) => b.toJSON());
  assert.equal(scopedButtons?.length, 1, "event-scoped coupons cannot be saved");
  assert.match(scopedButtons?.[0]?.label ?? "", /free ticket/);
  assert.match(scoped.content ?? "", /this event only/);
  assert.match(scoped.content ?? "", /\*\*FREE\*\*/);
});

test("skips the receipt line for coupon-covered and test tickets", () => {
  const paidEvent = { ...event, ticket_price_cents: 2000, ticket_currency: "aud" };

  assert.match(
    buildTicketConfirmed(paidEvent).content ?? "",
    /Stripe has emailed your receipt/,
  );
  const free = buildTicketConfirmed(paidEvent, { freeViaCoupon: true }).content ?? "";
  assert.doesNotMatch(free, /receipt/);
  assert.match(free, /coupon covered the full price/);
});

test("announcements no longer carry an edited footer", () => {
  const edited = buildPublicEventMessage({ ...event, edited_at: 1_000 });
  assert.doesNotMatch(edited.content ?? "", /-# Edited/);
});
