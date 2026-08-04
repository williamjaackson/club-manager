import assert from "node:assert/strict";
import test from "node:test";
import { AnnouncementRefresher } from "../dist/announcement-refresher.js";

test("collapses dirty marks into one webhook edit per event", async () => {
  const edits = [];
  const event = {
    id: 42,
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "32345678901234567",
    creator_id: "42345678901234567",
    title: "Live event",
    schedule_text: "Saturday",
    location: "Gold Coast",
    location_url: null,
    announcement: "Come along.",
    artwork_url: null,
    artwork_name: null,
    ticket_price_cents: null,
    ticket_currency: null,
    ticket_limit: 10,
    test_mode: false,
    starts_at: null,
    ends_at: null,
    ticket_sales_close_at: null,
    status: "published",
    created_at: 100,
    published_at: 101,
    edited_at: null,
  };
  const store = {
    async getEvent() {
      return event;
    },
    async getEventAttendance() {
      return { going: 4 };
    },
    async getEventReminderMessageIds() {
      return [];
    },
  };
  const client = {
    user: { id: "52345678901234567" },
    channels: {
      async fetch() {
        return {
          type: 0,
          async fetchWebhooks() {
            return {
              find() {
                return {
                  isIncoming() {
                    return true;
                  },
                  async editMessage(messageId, options) {
                    edits.push({ messageId, options });
                  },
                };
              },
            };
          },
          messages: {
            async fetch() {
              throw new Error("no reminders");
            },
          },
        };
      },
    },
  };
  const refresher = new AnnouncementRefresher(client, store);

  refresher.markDirty(42);
  refresher.markDirty(42);
  refresher.markDirty(42);
  await refresher.flush();

  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, event.message_id);
  assert.match(edits[0].options.content, /-# 🙋 4 going · 6 left/);
});
