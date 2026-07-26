import assert from "node:assert/strict";
import test from "node:test";
import { ButtonStyle } from "discord.js";
import {
  buildCreateEventModal,
  buildCurrentRsvp,
  buildEventPreview,
  buildPublicEventMessage,
  buildRsvpPrompt,
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
  assert.equal(modal.components.length, 5);
  assert.deepEqual(
    modal.components.map(({ label }) => label),
    [
      "Announcement channel",
      "Event name",
      "Date and time",
      "Location",
      "Announcement",
    ],
  );
  assert.deepEqual(
    modal.components.map(({ component }) => component.custom_id),
    [
      "event-channel",
      "event-title",
      "event-schedule",
      "event-location",
      "event-announcement",
    ],
  );
});

test("keeps the waiver private and the long announcement out of RSVP prompts", () => {
  const publicMessage = buildPublicEventMessage(event);
  const rsvpPrompt = buildRsvpPrompt(event);

  assert.deepEqual(publicMessage.embeds ?? [], []);
  assert.match(publicMessage.content ?? "", /Secret long-form details/);
  assert.doesNotMatch(publicMessage.content ?? "", /\$0|reduced to/);

  assert.deepEqual(rsvpPrompt.embeds ?? [], []);
  assert.match(rsvpPrompt.content ?? "", /\$5/);
  assert.match(rsvpPrompt.content ?? "", /~~\$5\.00~~ → \*\*\$FREE\*\*/);
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
