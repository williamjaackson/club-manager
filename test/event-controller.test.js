import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, MessageFlags } from "discord.js";
import { EventController } from "../dist/event-controller.js";

test("creates a paid multi-day test event through the persistent wizard", async () => {
  const guildId = "12345678901234567";
  const channelId = "22345678901234567";
  const userId = "32345678901234567";
  const administrator = { has() { return true; } };
  let pending;
  let createdDraft;
  let modal;
  let response;
  const store = {
    async createPendingEventCreate(value) {
      pending = {
        token: value.token,
        user_id: value.userId,
        guild_id: value.guildId,
        announcement_channel_id: null,
        title: null,
        location: null,
        announcement: null,
        artwork_url: null,
        artwork_name: null,
        starts_at: null,
        ends_at: null,
        ticket_sales_close_at: null,
      };
    },
    async getPendingEventCreate() { return pending; },
    async updatePendingEventDetails(token, owner, guild, details) {
      assert.deepEqual([token, owner, guild], [pending.token, userId, guildId]);
      Object.assign(pending, {
        announcement_channel_id: details.announcementChannelId,
        title: details.title,
        location: details.location,
        announcement: details.announcement,
        artwork_url: details.artworkUrl ?? null,
        artwork_name: details.artworkName ?? null,
      });
      return true;
    },
    async updatePendingEventSchedule(token, owner, guild, schedule) {
      assert.deepEqual([token, owner, guild], [pending.token, userId, guildId]);
      Object.assign(pending, {
        starts_at: schedule.startsAt,
        ends_at: schedule.endsAt ?? null,
        ticket_sales_close_at: schedule.ticketSalesCloseAt ?? null,
      });
      return true;
    },
    async consumePendingEventCreate() {
      const value = pending;
      pending = undefined;
      return value;
    },
    async createEventDraft(draft) {
      createdDraft = draft;
      return {
        id: 42,
        guild_id: draft.guildId,
        announcement_channel_id: draft.announcementChannelId,
        message_id: null,
        creator_id: draft.creatorId,
        title: draft.title,
        schedule_text: draft.scheduleText,
        location: draft.location,
        announcement: draft.announcement,
        artwork_url: draft.artworkUrl ?? null,
        artwork_name: draft.artworkName ?? null,
        ticket_price_cents: draft.ticketPriceCents ?? null,
        ticket_currency: draft.ticketCurrency ?? null,
        ticket_limit: draft.ticketLimit ?? null,
        test_mode: draft.testMode ?? false,
        starts_at: draft.startsAt ?? null,
        ends_at: draft.endsAt ?? null,
        ticket_sales_close_at: draft.ticketSalesCloseAt ?? null,
        status: "draft",
        created_at: 100,
        published_at: null,
      };
    },
  };
  const controller = new EventController(store, {});
  const baseInteraction = {
    guildId,
    user: { id: userId },
    memberPermissions: administrator,
    inGuild() { return true; },
  };

  await controller.handleCommand({
    ...baseInteraction,
    commandName: "event",
    options: { getSubcommand() { return "create"; } },
    async showModal(value) { modal = value.toJSON(); },
  });
  assert.match(modal.custom_id, /^event:create:details:/);

  const artwork = {
    contentType: "image/png",
    name: "artwork.png",
    url: "https://cdn.discordapp.com/ephemeral/artwork.png",
  };
  const details = {
    "event-title": "Test event",
    "event-location": "Gold Coast",
    "event-announcement": "A complete announcement.",
  };
  await controller.handleModal({
    ...baseInteraction,
    customId: modal.custom_id,
    fields: {
      getSelectedChannels() {
        return { first() { return { id: channelId, isSendable() { return true; } }; } };
      },
      getUploadedFiles() { return { first() { return artwork; } }; },
      getTextInputValue(id) { return details[id]; },
    },
    async deferReply(options) { assert.equal(options.flags, MessageFlags.Ephemeral); },
    async editReply(options) { response = options; },
  });

  const scheduleButton = response.components[0].components[0].toJSON().custom_id;
  await controller.handleButton({
    ...baseInteraction,
    customId: scheduleButton,
    async showModal(value) { modal = value.toJSON(); },
  });
  const schedule = {
    "event-starts-at": "2099-08-08 10:00",
    "event-ends-at": "2099-08-10 17:00",
    "event-ticket-sales-close-at": "2099-08-07 17:00",
  };
  await controller.handleModal({
    ...baseInteraction,
    customId: modal.custom_id,
    fields: { getTextInputValue(id) { return schedule[id]; } },
    async deferReply() {},
    async editReply(options) { response = options; },
  });

  const admissionButton = response.components[0].components[0].toJSON().custom_id;
  await controller.handleButton({
    ...baseInteraction,
    customId: admissionButton,
    async showModal(value) { modal = value.toJSON(); },
  });
  await controller.handleModal({
    ...baseInteraction,
    customId: modal.custom_id,
    fields: {
      getTextInputValue(id) {
        return id === "event-ticket-price" ? "12.50" : "50";
      },
      getCheckbox() { return true; },
    },
    async deferReply() {},
    async editReply(options) { response = options; },
  });

  assert.equal(pending, undefined);
  assert.equal(createdDraft.ticketPriceCents, 1250);
  assert.equal(createdDraft.ticketLimit, 50);
  assert.equal(createdDraft.testMode, true);
  assert.ok(createdDraft.endsAt > createdDraft.startsAt);
  assert.match(createdDraft.scheduleText, /8 August 2099.*10 August 2099/);
  assert.equal(response.files[0].name, artwork.name);
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

test("closes an event from its message context menu and disables its buttons", async () => {
  const now = Math.floor(Date.now() / 1000);
  const event = {
    id: 42,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "32345678901234567",
    creator_id: "42345678901234567",
    title: "Context event",
    schedule_text: "Saturday",
    location: "Gold Coast",
    announcement: "Complete announcement.",
    artwork_url: null,
    artwork_name: null,
    ticket_price_cents: null,
    ticket_currency: null,
    ticket_limit: 50,
    test_mode: false,
    starts_at: now + 3_600,
    ends_at: null,
    ticket_sales_close_at: null,
    status: "published",
    created_at: now,
    published_at: now,
  };
  const closedEvent = { ...event, ticket_sales_close_at: now };
  let originalUpdate;
  let reminderUpdate;
  let confirmation;
  const webhook = {
    name: "Club Manager Event Announcements",
    owner: { id: "52345678901234567" },
    token: "webhook-token",
    isIncoming() { return true; },
    async editMessage(messageId, options) {
      assert.equal(messageId, event.message_id);
      originalUpdate = options;
    },
  };
  const channel = {
    type: ChannelType.GuildText,
    async fetchWebhooks() {
      return { find(predicate) { return predicate(webhook) ? webhook : undefined; } };
    },
    messages: {
      async fetch(messageId) {
        assert.equal(messageId, "62345678901234567");
        return { async edit(options) { reminderUpdate = options; } };
      },
    },
  };
  const controller = new EventController({
    async getEventByAdmissionMessageId() { return event; },
    async closeEventAdmission(eventId) {
      assert.equal(eventId, event.id);
      return true;
    },
    async getEvent() { return closedEvent; },
    async getEventReminderMessageIds() { return ["62345678901234567"]; },
  }, {}, {});

  await controller.handleContextMenu({
    commandName: "Close Event",
    guildId: event.guild_id,
    targetMessage: { id: event.message_id },
    memberPermissions: { has() { return true; } },
    inGuild() { return true; },
    client: {
      user: { id: webhook.owner.id },
      channels: { async fetch() { return channel; } },
    },
    async deferReply(options) {
      assert.equal(options.flags, MessageFlags.Ephemeral);
    },
    async editReply(options) { confirmation = options; },
  });

  assert.equal(
    originalUpdate.components[0].components[0].toJSON().disabled,
    true,
  );
  assert.match(originalUpdate.content, /RSVPs close/);
  assert.equal(
    reminderUpdate.components[0].components[0].toJSON().disabled,
    true,
  );
  assert.match(confirmation.content, /Closed.*No new RSVPs/i);
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
