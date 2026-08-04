import assert from "node:assert/strict";
import test from "node:test";
import { ScheduledEventSync } from "../dist/scheduled-events.js";

function makeEvent(overrides = {}) {
  return {
    id: 42,
    title: "Native event",
    location: "Gold Coast",
    announcement: "Come along.",
    starts_at: Math.floor(Date.now() / 1000) + 3600,
    ends_at: null,
    scheduled_event_id: null,
    ...overrides,
  };
}

test("creates a native scheduled event and stores its id", async () => {
  let created;
  let stored;
  const sync = new ScheduledEventSync({
    async setEventScheduledEventId(eventId, scheduledEventId) {
      stored = { eventId, scheduledEventId };
    },
  });
  const guild = {
    scheduledEvents: {
      async create(options) {
        created = options;
        return { id: "82345678901234567" };
      },
    },
  };

  const event = makeEvent();
  await sync.create(guild, event);

  assert.equal(created.name, "Native event");
  assert.equal(created.entityMetadata.location, "Gold Coast");
  assert.ok(created.scheduledEndTime > created.scheduledStartTime);
  assert.deepEqual(stored, { eventId: 42, scheduledEventId: "82345678901234567" });
});

test("skips creation gracefully without a guild, start time, or permission", async () => {
  const sync = new ScheduledEventSync({
    async setEventScheduledEventId() {
      assert.fail("nothing should be stored");
    },
  });

  await sync.create(null, makeEvent());
  await sync.create(
    {
      scheduledEvents: {
        async create() {
          assert.fail("no start time");
        },
      },
    },
    makeEvent({ starts_at: null }),
  );
  // A permission failure logs but never throws.
  await sync.create(
    {
      scheduledEvents: {
        async create() {
          throw new Error("Missing Permissions");
        },
      },
    },
    makeEvent(),
  );
});

test("cancels the native event and clears the stored id", async () => {
  let edited;
  let cleared;
  const sync = new ScheduledEventSync({
    async setEventScheduledEventId(eventId, scheduledEventId) {
      cleared = { eventId, scheduledEventId };
    },
  });
  const guild = {
    scheduledEvents: {
      async edit(id, options) {
        edited = { id, options };
      },
    },
  };

  await sync.cancel(guild, makeEvent({ scheduled_event_id: "82345678901234567" }));

  assert.equal(edited.id, "82345678901234567");
  assert.deepEqual(cleared, { eventId: 42, scheduledEventId: null });
});
