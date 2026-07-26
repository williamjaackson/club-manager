import {
  ChannelSelectMenuBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  TextInputStyle,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageCreateOptions,
} from "discord.js";
import type { EventRecord } from "./database.js";

export type EventReplyOptions = Pick<
  InteractionReplyOptions,
  "content" | "embeds" | "components"
>;

export const eventIds = {
  channel: "event-channel",
  title: "event-title",
  schedule: "event-schedule",
  location: "event-location",
  announcement: "event-announcement",
} as const;

export function buildCreateEventModal(token: string): ModalBuilder {
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId(eventIds.channel)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  const title = new TextInputBuilder()
    .setCustomId(eventIds.title)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Griffith AI-Hackathon 2026")
    .setMaxLength(100)
    .setRequired(true);
  const schedule = new TextInputBuilder()
    .setCustomId(eventIds.schedule)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Saturday 1 August 2026, 10:00 am–5:00 pm")
    .setMaxLength(200)
    .setRequired(true);
  const location = new TextInputBuilder()
    .setCustomId(eventIds.location)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("In person, Gold Coast — room TBD")
    .setMaxLength(200)
    .setRequired(true);
  const announcement = new TextInputBuilder()
    .setCustomId(eventIds.announcement)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(
      "Write the complete announcement, including themes, food, teams, prizes, and pricing.",
    )
    .setMaxLength(1_250)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`event:create:${token}`)
    .setTitle("Create an event")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Announcement channel")
        .setDescription("The event will be posted here after preview.")
        .setChannelSelectMenuComponent(channel),
      new LabelBuilder().setLabel("Event name").setTextInputComponent(title),
      new LabelBuilder()
        .setLabel("Date and time")
        .setTextInputComponent(schedule),
      new LabelBuilder().setLabel("Location").setTextInputComponent(location),
      new LabelBuilder()
        .setLabel("Announcement")
        .setDescription("This appears in full on the public event post.")
        .setTextInputComponent(announcement),
    );
}

export function buildEventPreview(
  event: EventRecord,
): InteractionEditReplyOptions {
  const publish = new ButtonBuilder()
    .setCustomId(`event:publish:${event.id}`)
    .setLabel("Publish")
    .setStyle(ButtonStyle.Success);
  const discard = new ButtonBuilder()
    .setCustomId(`event:discard:${event.id}`)
    .setLabel("Discard")
    .setStyle(ButtonStyle.Danger);
  const files: AttachmentBuilder[] = [];

  if (event.artwork_url && event.artwork_name) {
    files.push(
      new AttachmentBuilder(event.artwork_url, { name: event.artwork_name }),
    );
  }

  return {
    content:
      `**Preview** — this will be posted in ` +
      `<#${event.announcement_channel_id}>.\n\n` +
      buildAnnouncementText(event),
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(publish, discard),
    ],
    files,
  };
}

export function buildPublicEventMessage(
  event: EventRecord,
): MessageCreateOptions {
  const rsvp = new ButtonBuilder()
    .setCustomId(`event:rsvp:${event.id}`)
    .setLabel("RSVP")
    .setEmoji("🎟️")
    .setStyle(ButtonStyle.Secondary);
  const files: AttachmentBuilder[] = [];

  if (event.artwork_url && event.artwork_name) {
    files.push(
      new AttachmentBuilder(event.artwork_url, { name: event.artwork_name }),
    );
  }

  return {
    content: buildAnnouncementText(event),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(rsvp),
    ],
    files,
  };
}

export function buildRsvpPrompt(event: EventRecord): EventReplyOptions {
  const confirm = new ButtonBuilder()
    .setCustomId(`event:rsvp-confirm:${event.id}`)
    .setLabel("Yes, RSVP")
    .setStyle(ButtonStyle.Success);
  const notNow = new ButtonBuilder()
    .setCustomId(`event:dismiss:${event.id}`)
    .setLabel("Not now")
    .setStyle(ButtonStyle.Secondary);
  return {
    content: buildCompactRsvpText(
      event,
      "Would you like to RSVP?",
      "🎉 **First-event discount applied**\n" +
        "~~$5.00~~ → **$FREE**",
    ),
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, notNow),
    ],
  };
}

export function buildCurrentRsvp(event: EventRecord): EventReplyOptions {
  const cancel = new ButtonBuilder()
    .setCustomId(`event:cancel-confirm:${event.id}`)
    .setLabel("Cancel RSVP")
    .setStyle(ButtonStyle.Danger);
  return {
    content: buildCompactRsvpText(
      event,
      "You’re RSVP’d.",
      "You can cancel your RSVP below.",
    ),
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(cancel),
    ],
  };
}

export function buildRsvpComplete(
  event: EventRecord,
  changed: boolean,
): EventReplyOptions {
  return {
    content: changed
      ? "✅ RSVP confirmed. Your **$5.00 first-event discount** has been applied."
      : "✅ You’re already RSVP’d.",
    embeds: [],
    components: [],
  };
}

export function buildCancellationComplete(
  event: EventRecord,
  changed: boolean,
): EventReplyOptions {
  return {
    content: changed
      ? "Your RSVP has been cancelled."
      : "You don’t have an active RSVP.",
    embeds: [],
    components: [],
  };
}

function buildAnnouncementText(event: EventRecord): string {
  return (
    `# ${event.title}\n\n` +
    `📅 **${event.schedule_text}**\n` +
    `📍 **${event.location}**\n\n` +
    event.announcement
  );
}

function buildCompactRsvpText(
  event: EventRecord,
  heading: string,
  message: string,
): string {
  return (
    `**${heading}**\n\n` +
    `📅 **${event.schedule_text}**\n` +
    `📍 **${event.location}**\n\n` +
    message
  );
}
