import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EventUnavailableError,
  Store,
} from "../dist/database.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "club-manager-test-"));
  const store = new Store(join(directory, "bot.sqlite"));
  const event = store.createEventDraft(
    {
      guildId: "12345678901234567",
      announcementChannelId: "22345678901234567",
      creatorId: "32345678901234567",
      title: "Test event",
      scheduleText: "Saturday, 10:00 am–5:00 pm",
      location: "Gold Coast",
      announcement: "A complete announcement.",
    },
    100,
  );

  return {
    directory,
    store,
    event,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("publishes a draft exactly once", () => {
  const context = fixture();

  try {
    assert.equal(context.event.status, "draft");
    assert.equal(context.store.claimEventForPublishing(context.event.id), true);
    assert.equal(context.store.claimEventForPublishing(context.event.id), false);

    context.store.finishPublishing(context.event.id, "42345678901234567", 200);
    const published = context.store.getEvent(context.event.id);

    assert.equal(published?.status, "published");
    assert.equal(published?.message_id, "42345678901234567");
    assert.equal(published?.published_at, 200);
  } finally {
    context.close();
  }
});

test("records only real RSVP state changes and queues their audit trail", () => {
  const context = fixture();

  try {
    context.store.claimEventForPublishing(context.event.id);
    context.store.finishPublishing(
      context.event.id,
      "42345678901234567",
      200,
    );

    const confirmed = context.store.confirmRsvp(
      context.event.id,
      "52345678901234567",
      300,
    );
    const duplicate = context.store.confirmRsvp(
      context.event.id,
      "52345678901234567",
      301,
    );

    assert.deepEqual(confirmed, { changed: true, status: "active" });
    assert.deepEqual(duplicate, { changed: false, status: "active" });
    assert.equal(context.store.countRsvpHistory(context.event.id), 1);

    const cancellation = context.store.cancelRsvp(
      context.event.id,
      "52345678901234567",
      400,
    );
    const duplicateCancellation = context.store.cancelRsvp(
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
    assert.equal(context.store.countRsvpHistory(context.event.id), 2);

    const audits = context.store.getPendingAudit(500);
    assert.deepEqual(
      audits.map(({ action }) => action),
      ["rsvp", "cancel"],
    );
    assert.equal(audits[0]?.message_id, "42345678901234567");
  } finally {
    context.close();
  }
});

test("rejects RSVPs before an event is published", () => {
  const context = fixture();

  try {
    assert.throws(
      () =>
        context.store.confirmRsvp(
          context.event.id,
          "52345678901234567",
          300,
        ),
      EventUnavailableError,
    );
    assert.equal(context.store.countRsvpHistory(context.event.id), 0);
  } finally {
    context.close();
  }
});

test("keeps open event forms across database restarts", () => {
  const directory = mkdtempSync(join(tmpdir(), "club-manager-test-"));
  const path = join(directory, "bot.sqlite");
  let store = new Store(path);

  try {
    store.createPendingEventCreate(
      {
        token: "persistent-form",
        userId: "12345678901234567",
        guildId: "22345678901234567",
        artworkUrl: "https://cdn.discordapp.com/artwork.png",
        artworkName: "artwork.png",
      },
      100,
      900,
    );
    store.close();

    store = new Store(path);
    const pending = store.getPendingEventCreate("persistent-form", 200);

    assert.equal(pending?.user_id, "12345678901234567");
    assert.equal(pending?.guild_id, "22345678901234567");
    assert.equal(pending?.artwork_name, "artwork.png");
    assert.equal(
      store.getPendingEventCreate("persistent-form", 1_000),
      undefined,
    );

    store.deletePendingEventCreate("persistent-form");
    assert.equal(
      store.getPendingEventCreate("persistent-form", 200),
      undefined,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
