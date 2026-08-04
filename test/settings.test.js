import assert from "node:assert/strict";
import test from "node:test";
import { GuildSettingsService } from "../dist/settings.js";

test("resolves stored settings over environment fallbacks and caches them", async () => {
  let lookups = 0;
  const store = {
    async getGuildSettings() {
      lookups += 1;
      return {
        guild_id: "1",
        rsvp_log_channel_id: "22345678901234567",
        verification_message_url: null,
        connected_role_id: null,
        exempt_role_id: null,
        updated_at: 100,
      };
    },
  };
  const service = new GuildSettingsService(store, {
    rsvpLogChannelId: "32345678901234567",
    verificationMessageUrl: "https://discord.com/channels/1/2/3",
  });

  const resolved = await service.resolve("1");
  assert.equal(resolved.rsvpLogChannelId, "22345678901234567");
  assert.equal(resolved.verificationMessageUrl, "https://discord.com/channels/1/2/3");
  assert.equal(resolved.connectedRoleId, undefined);

  await service.resolve("1");
  assert.equal(lookups, 1);
});

test("update writes through the store and refreshes the cache", async () => {
  let written;
  let stored;
  const store = {
    async getGuildSettings() {
      return stored;
    },
    async upsertGuildSettings(guildId, update) {
      written = { guildId, update };
      stored = {
        guild_id: guildId,
        rsvp_log_channel_id: update.rsvpLogChannelId ?? null,
        verification_message_url: update.verificationMessageUrl ?? null,
        connected_role_id: update.connectedRoleId ?? null,
        exempt_role_id: update.exemptRoleId ?? null,
        updated_at: 1,
      };
      return stored;
    },
  };
  const service = new GuildSettingsService(store);

  assert.deepEqual(await service.resolve("1"), {});
  const resolved = await service.update("1", {
    rsvpLogChannelId: "22345678901234567",
    connectedRoleId: "42345678901234567",
  });

  assert.equal(written.guildId, "1");
  assert.equal(resolved.rsvpLogChannelId, "22345678901234567");
  assert.equal(resolved.connectedRoleId, "42345678901234567");
  assert.deepEqual(await service.resolve("1"), resolved);
});
