import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, MessageFlags } from "discord.js";
import { EventController } from "../dist/event-controller.js";

test("acknowledges a modal before preparing its artwork preview", async () => {
  let modal;
  let deferred = false;
  let preview;
  let finishPendingSave;

  const event = {
    id: 42,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: null,
    creator_id: "32345678901234567",
    title: "Test event",
    schedule_text: "Saturday, 10:00 am–5:00 pm",
    location: "Gold Coast",
    announcement: "A complete announcement.",
    artwork_url: "https://cdn.discordapp.com/attachments/example/artwork.png",
    artwork_name: "artwork.png",
    status: "draft",
    created_at: 100,
    published_at: null,
  };
  let pendingCreate;
  const store = {
    createPendingEventCreate(pending) {
      pendingCreate = {
        token: pending.token,
        user_id: pending.userId,
        guild_id: pending.guildId,
        artwork_url: pending.artworkUrl ?? null,
        artwork_name: pending.artworkName ?? null,
        starts_at: pending.startsAt ?? null,
        ends_at: pending.endsAt ?? null,
        ticket_sales_close_at: pending.ticketSalesCloseAt ?? null,
      };
      return new Promise((resolve) => {
        finishPendingSave = resolve;
      });
    },
    consumePendingEventCreate(token, userId, guildId) {
      assert.equal(deferred, true);
      if (
        pendingCreate?.token !== token ||
        pendingCreate.user_id !== userId ||
        pendingCreate.guild_id !== guildId
      ) {
        return undefined;
      }

      const consumed = pendingCreate;
      pendingCreate = undefined;
      return consumed;
    },
    createEventDraft(draft) {
      assert.equal(deferred, true);
      return { ...event, ...draft };
    },
  };
  const controller = new EventController(store, {});
  const administrator = {
    has() {
      return true;
    },
  };

  await controller.handleCommand({
    commandName: "event",
    guildId: event.guild_id,
    user: { id: event.creator_id },
    memberPermissions: administrator,
    inGuild() {
      return true;
    },
    options: {
      getSubcommand() {
        return "create";
      },
      getAttachment() {
        return {
          contentType: "image/png",
          name: event.artwork_name,
          url: event.artwork_url,
        };
      },
      getNumber() {
        return null;
      },
      getInteger() {
        return null;
      },
      getBoolean() {
        return null;
      },
      getString(name) {
        if (name === "start_time") return "2099-08-08 10:00";
        if (name === "finish_time") return "2099-08-08 17:00";
        return null;
      },
    },
    async showModal(value) {
      modal = value.toJSON();
      finishPendingSave();
    },
  });

  const values = {
    "event-title": event.title,
    "event-location": event.location,
    "event-announcement": event.announcement,
  };

  await controller.handleModal({
    customId: modal.custom_id,
    guildId: event.guild_id,
    user: { id: event.creator_id },
    memberPermissions: administrator,
    inGuild() {
      return true;
    },
    fields: {
      getSelectedChannels() {
        return {
          first() {
            return {
              id: event.announcement_channel_id,
              isSendable() {
                return true;
              },
            };
          },
        };
      },
      getTextInputValue(customId) {
        return values[customId];
      },
    },
    async deferReply(options) {
      assert.equal(options.flags, MessageFlags.Ephemeral);
      deferred = true;
    },
    async editReply(options) {
      preview = options;
    },
    async reply() {
      assert.fail("valid modal submissions should be deferred, not replied to");
    },
  });

  assert.equal(deferred, true);
  assert.equal(pendingCreate, undefined);
  assert.equal(preview.files.length, 1);
  assert.equal(preview.files[0].name, event.artwork_name);
});

test("records the test-event flag with paid event creation", async () => {
  let pending;
  const controller = new EventController({
    async createPendingEventCreate(value) {
      pending = value;
    },
  }, {});

  await controller.handleCommand({
    commandName: "event",
    guildId: "12345678901234567",
    user: { id: "32345678901234567" },
    memberPermissions: { has() { return true; } },
    inGuild() { return true; },
    options: {
      getSubcommand() { return "create"; },
      getAttachment() { return null; },
      getNumber() { return 12.5; },
      getInteger() { return 50; },
      getBoolean() { return true; },
      getString(name) {
        if (name === "start_time") return "2099-08-08 10:00";
        if (name === "finish_time") return "2099-08-08 17:00";
        if (name === "ticket_close_time") return "2099-08-07 17:00";
        return null;
      },
    },
    async showModal() {},
  });

  assert.equal(pending.ticketPriceCents, 1250);
  assert.equal(pending.ticketLimit, 50);
  assert.equal(pending.testMode, true);
  assert.equal(
    pending.startsAt,
    Math.floor(Date.parse("2099-08-08T10:00:00+10:00") / 1000),
  );
  assert.equal(
    pending.ticketSalesCloseAt,
    Math.floor(Date.parse("2099-08-07T17:00:00+10:00") / 1000),
  );
});

test("replies to an event announcement with a reusable admission button", async () => {
  const event = {
    id: 42,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "32345678901234567",
    title: "Reminder event",
    ticket_price_cents: null,
    ticket_currency: null,
    ends_at: Math.floor(Date.now() / 1000) + 86_400,
    status: "published",
  };
  let replyOptions;
  let recorded;
  let confirmation;
  const reminder = {
    id: "42345678901234567",
    async delete() { assert.fail("successful reminders must not be deleted"); },
  };
  const controller = new EventController({
    async getEventByMessageId(guildId, messageId) {
      assert.equal(guildId, event.guild_id);
      assert.equal(messageId, event.message_id);
      return event;
    },
    async recordEventReminder(eventId, messageId) {
      recorded = { eventId, messageId };
    },
  }, {}, {});

  await controller.handleCommand({
    commandName: "reminder",
    guildId: event.guild_id,
    memberPermissions: { has() { return true; } },
    inGuild() { return true; },
    options: {
      getString(name) {
        if (name === "announcement") {
          return `https://discord.com/channels/${event.guild_id}/${event.announcement_channel_id}/${event.message_id}`;
        }
        return "@everyone Reminder this Saturday";
      },
    },
    client: {
      channels: {
        async fetch(channelId) {
          assert.equal(channelId, event.announcement_channel_id);
          return {
            type: ChannelType.GuildText,
            messages: {
              async fetch(messageId) {
                assert.equal(messageId, event.message_id);
                return {
                  async reply(options) {
                    replyOptions = options;
                    return reminder;
                  },
                };
              },
            },
          };
        },
      },
    },
    async deferReply(options) {
      assert.equal(options.flags, MessageFlags.Ephemeral);
    },
    async editReply(options) { confirmation = options; },
  });

  assert.equal(replyOptions.content, "@everyone Reminder this Saturday");
  assert.equal(
    replyOptions.components[0].components[0].toJSON().custom_id,
    `event:rsvp:${event.id}`,
  );
  assert.deepEqual(recorded, {
    eventId: event.id,
    messageId: reminder.id,
  });
  assert.match(confirmation.content, /Sent a reminder/);
});

test("logs interest but refuses admission buttons after their deadlines", async () => {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    id: 42,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "32345678901234567",
    creator_id: "42345678901234567",
    title: "Closed event",
    schedule_text: "Saturday",
    location: "Gold Coast",
    announcement: "Test.",
    artwork_url: null,
    artwork_name: null,
    status: "published",
    created_at: 100,
    published_at: 101,
  };
  const cases = [
    {
      action: "rsvp",
      kind: "rsvp",
      event: {
        ...base,
        ticket_price_cents: null,
        ticket_currency: null,
        ends_at: now - 1,
      },
      error: /event has finished/i,
    },
    {
      action: "buy",
      kind: "ticket",
      event: {
        ...base,
        ticket_price_cents: 1250,
        ticket_currency: "aud",
        ends_at: now + 3_600,
        ticket_sales_close_at: now - 1,
      },
      error: /ticket sales.*closed/i,
    },
  ];

  for (const testCase of cases) {
    let interest;
    const controller = new EventController({
      async getEvent() { return testCase.event; },
      async recordInterest(eventId, userId, kind) {
        interest = { eventId, userId, kind };
        return true;
      },
      async getRsvpStatus() {
        assert.fail("closed buttons must stop before RSVP lookup");
      },
    }, { async flush() {} }, {
      async startCheckout() {
        assert.fail("closed buttons must stop before Checkout");
      },
    });

    await assert.rejects(
      controller.handleButton({
        customId: `event:${testCase.action}:${base.id}`,
        guildId: base.guild_id,
        user: { id: "52345678901234567" },
        message: { id: base.message_id },
        member: { roles: ["1257896371973914674"] },
        async deferReply() {},
        async editReply() {},
      }),
      testCase.error,
    );
    assert.deepEqual(interest, {
      eventId: base.id,
      userId: "52345678901234567",
      kind: testCase.kind,
    });
  }
});

test("requires a connected or exempt role before showing the RSVP confirmation", async () => {
  const event = { id: 42, guild_id: "12345678901234567", announcement_channel_id: "22345678901234567", message_id: "42345678901234567", creator_id: "32345678901234567", title: "Test event", schedule_text: "Saturday", location: "Gold Coast", announcement: "Test.", artwork_url: null, artwork_name: null, status: "published", created_at: 100, published_at: 101 };
  let reply;
  const controller = new EventController({
    async getEvent() { return event; },
    async recordInterest(eventId, userId, kind) {
      assert.deepEqual(
        { eventId, userId, kind },
        { eventId: event.id, userId: "42345678901234567", kind: "rsvp" },
      );
      return true;
    },
    async getRsvpStatus() { assert.fail("ineligible members must not reach the RSVP lookup"); },
  }, { async flush() {} }, {});

  await controller.handleButton({
    customId: `event:rsvp:${event.id}`,
    guildId: event.guild_id,
    user: { id: "42345678901234567" },
    message: { id: event.message_id },
    member: { roles: [] },
    async deferReply(options) { assert.equal(options.flags, MessageFlags.Ephemeral); },
    async editReply(options) { reply = options; },
  });

  assert.match(reply.content, /please verify first/i);
  assert.match(reply.content, /1348722902375071785/);
});

test("checks RSVP eligibility again when confirming", async () => {
  const event = { id: 42, guild_id: "12345678901234567", announcement_channel_id: "22345678901234567", message_id: "42345678901234567", creator_id: "32345678901234567", title: "Test event", schedule_text: "Saturday", location: "Gold Coast", announcement: "Test.", artwork_url: null, artwork_name: null, status: "published", created_at: 100, published_at: 101 };
  let reply;
  const controller = new EventController({
    async getEvent() { return event; },
    async confirmRsvp() { assert.fail("ineligible members must not be recorded as RSVP'd"); },
  }, {});

  await controller.handleButton({
    customId: `event:rsvp-confirm:${event.id}`,
    guildId: event.guild_id,
    user: { id: "42345678901234567" },
    member: { roles: [] },
    async deferUpdate() {},
    async editReply(options) { reply = options; },
  });

  assert.match(reply.content, /please verify first/i);
  assert.match(reply.content, /1348722902375071785/);
});

test("rejects RSVP buttons for paid events", async () => {
  const event = {
    id: 42,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "42345678901234567",
    creator_id: "32345678901234567",
    title: "Paid event",
    schedule_text: "Saturday",
    location: "Gold Coast",
    announcement: "Test.",
    artwork_url: null,
    artwork_name: null,
    ticket_price_cents: 1250,
    ticket_currency: "aud",
    ticket_limit: 50,
    status: "published",
    created_at: 100,
    published_at: 101,
  };
  const controller = new EventController({
    async getEvent() { return event; },
    async getRsvpStatus() {
      assert.fail("paid events must not reach the RSVP lookup");
    },
  }, {});

  await assert.rejects(
    controller.handleButton({
      customId: `event:rsvp:${event.id}`,
      guildId: event.guild_id,
      user: { id: "52345678901234567" },
      message: { id: event.message_id },
      member: { roles: [] },
      async deferReply() {},
      async editReply() {},
    }),
    /paid event.*Buy ticket/i,
  );
});

test("publishes through a new webhook as the command runner", async () => {
  const event = eventDraft(42);
  let createdWebhook;
  let sent;
  let publishedMessageId;
  let webhookCreates = 0;
  const webhook = {
    async send(options) {
      sent = options;
      return { id: "52345678901234567" };
    },
    async deleteMessage() {
      assert.fail("successful webhook messages must not be deleted");
    },
  };
  const channel = {
    id: event.announcement_channel_id,
    type: ChannelType.GuildText,
    async fetchWebhooks() {
      return { find() { return undefined; } };
    },
    async createWebhook(options) {
      webhookCreates += 1;
      createdWebhook = options;
      return webhook;
    },
    async send() {
      assert.fail("event announcements must not be sent as the bot");
    },
  };
  const controller = new EventController({
    async getEvent() { return event; },
    async claimEventForPublishing() { return true; },
    async finishPublishing(_eventId, messageId) { publishedMessageId = messageId; },
  }, {});
  let reply;

  await controller.handleButton(publishInteraction(event, channel, (options) => { reply = options; }));

  assert.equal(webhookCreates, 1);
  assert.equal(createdWebhook.name, "Club Manager Event Announcements");
  assert.equal(sent.username, "Event Admin");
  assert.equal(sent.avatarURL, "https://cdn.example/admin-server-avatar.png");
  assert.equal(sent.withComponents, true);
  assert.equal(sent.components.length, 1);
  assert.equal(publishedMessageId, "52345678901234567");
  assert.match(reply.content, /Published/);
});

test("reuses the bot-owned event webhook", async () => {
  const event = eventDraft(43);
  let sends = 0;
  const webhook = {
    name: "Club Manager Event Announcements",
    owner: { id: "62345678901234567" },
    token: "webhook-token",
    isIncoming() { return true; },
    async send() { sends += 1; return { id: "72345678901234567" }; },
  };
  const channel = {
    id: event.announcement_channel_id,
    type: ChannelType.GuildAnnouncement,
    async fetchWebhooks() {
      return { find(predicate) { return predicate(webhook) ? webhook : undefined; } };
    },
    async createWebhook() {
      assert.fail("an existing bot-owned event webhook should be reused");
    },
  };
  const controller = new EventController({
    async getEvent() { return event; },
    async claimEventForPublishing() { return true; },
    async finishPublishing() {},
  }, {});

  await controller.handleButton(publishInteraction(event, channel, () => {}));

  assert.equal(sends, 1);
});

function eventDraft(id) {
  return {
    id,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: null,
    creator_id: "32345678901234567",
    title: "Test event",
    schedule_text: "Saturday",
    location: "Gold Coast",
    announcement: "Test.",
    artwork_url: null,
    artwork_name: null,
    ticket_price_cents: null,
    ticket_currency: null,
    ticket_limit: null,
    status: "draft",
    created_at: 100,
    published_at: null,
  };
}

function publishInteraction(event, channel, editReply) {
  return {
    customId: `event:publish:${event.id}`,
    guildId: event.guild_id,
    user: {
      id: event.creator_id,
      globalName: "Global Admin",
      username: "admin",
      displayAvatarURL() { return "https://cdn.example/admin-avatar.png"; },
    },
    member: {
      displayName: "Event Admin",
      displayAvatarURL() { return "https://cdn.example/admin-server-avatar.png"; },
    },
    memberPermissions: { has() { return true; } },
    inGuild() { return true; },
    client: {
      user: { id: "62345678901234567" },
      channels: { async fetch() { return channel; } },
    },
    async deferUpdate() {},
    async editReply(options) { editReply(options); },
  };
}

test("opens Stripe Checkout privately for an eligible paid-event member", async () => {
  const event = {
    id: 42,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "42345678901234567",
    creator_id: "32345678901234567",
    title: "Paid test event",
    schedule_text: "Saturday",
    location: "Gold Coast",
    announcement: "Test.",
    artwork_url: null,
    artwork_name: null,
    ticket_price_cents: 1250,
    ticket_currency: "aud",
    ticket_limit: 50,
    status: "published",
    created_at: 100,
    published_at: 101,
  };
  let reply;
  const controller = new EventController(
    {
      async getEvent() {
        return event;
      },
      async recordInterest(eventId, userId, kind) {
        assert.deepEqual(
          { eventId, userId, kind },
          { eventId: event.id, userId: "52345678901234567", kind: "ticket" },
        );
        return true;
      },
    },
    { async flush() {} },
    {
      async startCheckout(receivedEvent, userId) {
        assert.equal(receivedEvent, event);
        assert.equal(userId, "52345678901234567");
        return {
          alreadyPaid: false,
          order: { id: 7 },
          checkoutUrl: "https://checkout.stripe.com/test",
        };
      },
    },
  );

  await controller.handleButton({
    customId: `event:buy:${event.id}`,
    guildId: event.guild_id,
    user: { id: "52345678901234567" },
    message: { id: event.message_id },
    member: { roles: ["1257896371973914674"] },
    async deferReply(options) {
      assert.equal(options.flags, MessageFlags.Ephemeral);
    },
    async editReply(options) {
      reply = options;
    },
  });

  assert.match(reply.content, /reserved for about 30 minutes/);
  assert.equal(
    reply.components[0].components[0].toJSON().url,
    "https://checkout.stripe.com/test",
  );
});
