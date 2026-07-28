import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
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
    },
    async showModal(value) {
      modal = value.toJSON();
      finishPendingSave();
    },
  });

  const values = {
    "event-title": event.title,
    "event-schedule": event.schedule_text,
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

test("requires a connected or exempt role before showing the RSVP confirmation", async () => {
  const event = { id: 42, guild_id: "12345678901234567", announcement_channel_id: "22345678901234567", message_id: "42345678901234567", creator_id: "32345678901234567", title: "Test event", schedule_text: "Saturday", location: "Gold Coast", announcement: "Test.", artwork_url: null, artwork_name: null, status: "published", created_at: 100, published_at: 101 };
  let reply;
  const controller = new EventController({
    async getEvent() { return event; },
    async getRsvpStatus() { assert.fail("ineligible members must not reach the RSVP lookup"); },
  }, {});

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
