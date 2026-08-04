import assert from "node:assert/strict";
import test from "node:test";
import { WaitlistManager } from "../dist/waitlist.js";

test("offers freed seats to the front of the queue with a claim DM", async () => {
  const offered = [];
  const dms = [];
  const store = {
    async expireWaitlistOffers() {},
    async countActiveWaitlistOffers() {
      return 1;
    },
    async nextWaitlistCandidates(eventId, limit) {
      assert.equal(limit, 2, "active offers hold seats");
      return [
        { event_id: eventId, user_id: "62345678901234567" },
        { event_id: eventId, user_id: "72345678901234567" },
      ];
    },
    async markWaitlistOffered(_eventId, userId, expiresAt) {
      offered.push({ userId, expiresAt });
    },
    async removeWaitlistEntry() {
      assert.fail("reachable members must stay on the waitlist");
    },
  };
  const client = {
    users: {
      async fetch(userId) {
        return {
          async send(options) {
            dms.push({ userId, options });
          },
        };
      },
    },
  };
  const manager = new WaitlistManager(client, store);

  const event = {
    id: 42,
    title: "Full event",
    ticket_price_cents: null,
    ticket_currency: null,
    test_mode: false,
  };
  await manager.promote(event, 3);

  assert.equal(offered.length, 2);
  assert.equal(dms.length, 2);
  assert.match(dms[0].options.content, /spot opened up for \*\*Full event\*\*/);
  assert.match(
    dms[0].options.components[0].toJSON().components[0].custom_id,
    /^event:claim:42$/,
  );
});

test("drops unreachable members so the seat rolls onward", async () => {
  const removed = [];
  const store = {
    async expireWaitlistOffers() {},
    async countActiveWaitlistOffers() {
      return 0;
    },
    async nextWaitlistCandidates() {
      return [{ event_id: 42, user_id: "62345678901234567" }];
    },
    async markWaitlistOffered() {
      assert.fail("an undeliverable offer must not be marked");
    },
    async removeWaitlistEntry(eventId, userId) {
      removed.push({ eventId, userId });
    },
  };
  const client = {
    users: {
      async fetch() {
        throw new Error("Cannot send messages to this user");
      },
    },
  };
  const manager = new WaitlistManager(client, store);

  await manager.promote(
    { id: 42, title: "Full event", ticket_price_cents: null, test_mode: false },
    1,
  );

  assert.deepEqual(removed, [{ eventId: 42, userId: "62345678901234567" }]);
});
