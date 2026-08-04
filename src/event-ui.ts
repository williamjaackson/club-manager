import {
  ChannelSelectMenuBuilder,
  CheckboxBuilder,
  FileUploadBuilder,
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
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageCreateOptions,
  TextInputStyle,
} from "discord.js";
import type { EventRecord, PendingEventCreateRecord } from "./database.js";
import { formatCurrencyAmount } from "./money.js";
import {
  currentTimestamp,
  formatBrisbaneDateTimeInput,
  isSameBrisbaneDay,
} from "./time.js";

export type EventReplyOptions = Pick<
  InteractionReplyOptions,
  "content" | "embeds" | "components"
>;

export const eventIds = {
  channel: "event-channel",
  title: "event-title",
  location: "event-location",
  announcement: "event-announcement",
  artwork: "event-artwork",
  startsAt: "event-starts-at",
  endsAt: "event-ends-at",
  ticketSalesCloseAt: "event-ticket-sales-close-at",
  ticketPrice: "event-ticket-price",
  capacity: "event-capacity",
  testMode: "event-test-mode",
  locationUrl: "event-location-url",
} as const;

// One shared subtext line marks test-mode content everywhere; never
// hand-write test-mode copy in an individual message.
export function testModeNote(testMode: boolean): string {
  return testMode ? "-# 🧪 Test event — Stripe test mode, no real money is charged" : "";
}

function withTestNote(event: EventRecord, content: string): string {
  const note = testModeNote(event.test_mode);
  return note ? `${content}\n\n${note}` : content;
}

function scheduleBlock(event: EventRecord, relative: boolean): string {
  if (typeof event.starts_at !== "number") {
    return `📅 **${event.schedule_text}**\n`;
  }

  const startTag = `<t:${event.starts_at}:F>${relative ? ` (<t:${event.starts_at}:R>)` : ""}`;
  if (
    typeof event.ends_at === "number" &&
    isSameBrisbaneDay(event.starts_at, event.ends_at)
  ) {
    return `📅 ${startTag} – <t:${event.ends_at}:t>\n`;
  }

  let block = `📅 **Starts:** ${startTag}\n`;
  if (typeof event.ends_at === "number") {
    block += `🏁 **Finishes:** <t:${event.ends_at}:F>\n`;
  }
  return block;
}

function locationLine(event: EventRecord): string {
  return event.location_url
    ? `📍 [**${event.location}**](${event.location_url})`
    : `📍 **${event.location}**`;
}

export function buildCreateEventDetailsModal(
  token: string,
  current?: PendingEventCreateRecord,
): ModalBuilder {
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId(eventIds.channel)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (current?.announcement_channel_id) {
    channel.setDefaultChannels(current.announcement_channel_id);
  }
  const title = new TextInputBuilder()
    .setCustomId(eventIds.title)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Griffith AI-Hackathon 2026")
    .setMaxLength(100)
    .setRequired(true);
  if (current?.title) title.setValue(current.title);
  const location = new TextInputBuilder()
    .setCustomId(eventIds.location)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("In person, Gold Coast — room TBD")
    .setMaxLength(200)
    .setRequired(true);
  if (current?.location) location.setValue(current.location);
  const announcement = new TextInputBuilder()
    .setCustomId(eventIds.announcement)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(
      "Write the complete announcement, including themes, food, teams, prizes, and pricing.",
    )
    .setMaxLength(1_250)
    .setRequired(true);
  if (current?.announcement) announcement.setValue(current.announcement);
  const artwork = new FileUploadBuilder()
    .setCustomId(eventIds.artwork)
    .setMinValues(0)
    .setMaxValues(1)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(`event:create:details:${token}`)
    .setTitle("Event details (1/3)")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Announcement channel")
        .setDescription("The event will be posted here after preview.")
        .setChannelSelectMenuComponent(channel),
      new LabelBuilder().setLabel("Event name").setTextInputComponent(title),
      new LabelBuilder().setLabel("Location").setTextInputComponent(location),
      new LabelBuilder()
        .setLabel("Announcement")
        .setDescription("This appears in full on the public event post.")
        .setTextInputComponent(announcement),
      new LabelBuilder()
        .setLabel("Artwork (optional)")
        .setDescription("Upload one image shown below the announcement.")
        .setFileUploadComponent(artwork),
    );
}

export function buildCreateEventScheduleModal(
  token: string,
  current?: PendingEventCreateRecord,
): ModalBuilder {
  const startsAt = new TextInputBuilder()
    .setCustomId(eventIds.startsAt)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("2026-08-10 09:00")
    .setMaxLength(16)
    .setRequired(true);
  if (typeof current?.starts_at === "number") {
    startsAt.setValue(formatBrisbaneDateTimeInput(current.starts_at));
  }
  const endsAt = new TextInputBuilder()
    .setCustomId(eventIds.endsAt)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("2026-08-12 17:00")
    .setMaxLength(16)
    .setRequired(false);
  if (typeof current?.ends_at === "number") {
    endsAt.setValue(formatBrisbaneDateTimeInput(current.ends_at));
  }
  const ticketSalesCloseAt = new TextInputBuilder()
    .setCustomId(eventIds.ticketSalesCloseAt)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("2026-08-09 17:00")
    .setMaxLength(16)
    .setRequired(false);
  if (typeof current?.ticket_sales_close_at === "number") {
    ticketSalesCloseAt.setValue(
      formatBrisbaneDateTimeInput(current.ticket_sales_close_at),
    );
  }
  const locationUrl = new TextInputBuilder()
    .setCustomId(eventIds.locationUrl)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://maps.app.goo.gl/…")
    .setMaxLength(300)
    .setRequired(false);
  if (current?.location_url) locationUrl.setValue(current.location_url);

  return new ModalBuilder()
    .setCustomId(`event:create:schedule:${token}`)
    .setTitle("Event schedule (2/3)")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Start time")
        .setDescription("Required · YYYY-MM-DD HH:mm in Brisbane time.")
        .setTextInputComponent(startsAt),
      new LabelBuilder()
        .setLabel("Finish time (optional)")
        .setDescription("May be on a later date for multi-day events.")
        .setTextInputComponent(endsAt),
      new LabelBuilder()
        .setLabel("Ticket sales close (optional)")
        .setDescription("Paid events only · may close before the finish.")
        .setTextInputComponent(ticketSalesCloseAt),
      new LabelBuilder()
        .setLabel("Google Maps link (optional)")
        .setDescription("Turns the location line into a link.")
        .setTextInputComponent(locationUrl),
    );
}

export function buildCreateEventAdmissionModal(
  token: string,
  current?: PendingEventCreateRecord,
): ModalBuilder {
  const ticketPrice = new TextInputBuilder()
    .setCustomId(eventIds.ticketPrice)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Leave blank for a free RSVP event")
    .setMaxLength(10)
    .setRequired(false);
  if (typeof current?.ticket_price_cents === "number") {
    ticketPrice.setValue((current.ticket_price_cents / 100).toFixed(2));
  }
  const capacity = new TextInputBuilder()
    .setCustomId(eventIds.capacity)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Leave blank for unlimited")
    .setMaxLength(6)
    .setRequired(false);
  if (typeof current?.ticket_limit === "number") {
    capacity.setValue(String(current.ticket_limit));
  }
  const testMode = new CheckboxBuilder()
    .setCustomId(eventIds.testMode)
    .setDefault(current?.test_mode === true);

  return new ModalBuilder()
    .setCustomId(`event:create:admission:${token}`)
    .setTitle("Event admission (3/3)")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Ticket price in AUD (optional)")
        .setDescription("Leave blank to use free RSVPs instead of tickets.")
        .setTextInputComponent(ticketPrice),
      new LabelBuilder()
        .setLabel("Capacity (optional)")
        .setDescription("Maximum completed RSVPs or reserved/paid tickets.")
        .setTextInputComponent(capacity),
      new LabelBuilder()
        .setLabel("Stripe test event")
        .setDescription("No real money is charged; requires a ticket price.")
        .setCheckboxComponent(testMode),
    );
}

export function buildWizardHub(pending: PendingEventCreateRecord): EventReplyOptions {
  const ready = Boolean(
    pending.announcement_channel_id &&
      pending.title &&
      pending.location &&
      pending.announcement &&
      typeof pending.starts_at === "number",
  );

  let body = `## ${pending.title ?? "Untitled event"}\n`;
  if (typeof pending.starts_at === "number") {
    body += `📅 <t:${pending.starts_at}:F>`;
    if (typeof pending.ends_at === "number") {
      body += isSameBrisbaneDay(pending.starts_at, pending.ends_at)
        ? ` – <t:${pending.ends_at}:t>`
        : ` → <t:${pending.ends_at}:F>`;
    }
    body += "\n";
  } else {
    body += "📅 *Schedule not set*\n";
  }
  body += pending.location
    ? `📍 ${
        pending.location_url
          ? `[**${pending.location}**](${pending.location_url})`
          : `**${pending.location}**`
      }\n`
    : "📍 *Location not set*\n";
  body += pending.announcement_channel_id
    ? `📣 Posts in <#${pending.announcement_channel_id}>\n`
    : "📣 *Channel not set*\n";
  if (typeof pending.ticket_price_cents === "number") {
    body += `🎟️ Paid tickets — ${(pending.ticket_price_cents / 100).toFixed(2)} ${(
      pending.ticket_currency ?? "aud"
    ).toUpperCase()}`;
    if (typeof pending.ticket_limit === "number") {
      body += ` · ${pending.ticket_limit}-ticket capacity`;
    }
    body += "\n";
  } else {
    body += `🎟️ Free RSVP event${
      typeof pending.ticket_limit === "number"
        ? ` · ${pending.ticket_limit}-person capacity`
        : ""
    }\n`;
  }
  if (typeof pending.ticket_sales_close_at === "number") {
    body += `⏳ Sales close <t:${pending.ticket_sales_close_at}:F>\n`;
  }
  if (pending.announcement) {
    body += `\n${pending.announcement}\n`;
  }

  const editing = typeof pending.edit_event_id === "number";
  let content =
    (editing
      ? "**Editing published event** — saving updates the announcement immediately."
      : "**Event draft** — edit any section, then create the draft to preview and publish.") +
    `${ready ? "" : "\n-# Details and a start time are required."}\n\n${body}`;
  const note = testModeNote(pending.test_mode);
  if (note) content += `\n${note}`;

  const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event:create:edit-details:${pending.token}`)
      .setLabel("Edit details")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`event:create:edit-schedule:${pending.token}`)
      .setLabel("Edit schedule")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`event:create:edit-admission:${pending.token}`)
      .setLabel("Edit admission")
      .setStyle(ButtonStyle.Secondary),
  );
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event:create:finish:${pending.token}`)
      .setLabel(editing ? "Save changes" : "Create draft")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!ready),
    new ButtonBuilder()
      .setCustomId(`event:create:abort:${pending.token}`)
      .setLabel(editing ? "Cancel editing" : "Discard form")
      .setStyle(ButtonStyle.Danger),
  );

  return { content, embeds: [], components: [editRow, actionRow] };
}

export function buildEditRefundConfirm(
  pending: PendingEventCreateRecord,
  refundTotalCents: number,
  refundCount: number,
): EventReplyOptions {
  const total = formatCurrencyAmount(refundTotalCents, pending.ticket_currency ?? "aud");
  return {
    content:
      `⚠️ **Price drop refunds** — saving will refund a total of **${total}** ` +
      `across **${refundCount}** already-sold ticket${refundCount === 1 ? "" : "s"}. ` +
      "Ticket holders keep their tickets and are notified by DM.\n" +
      "-# Stripe does not return the original processing fees when refunding.",
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event:create:confirm-apply:${pending.token}`)
          .setLabel(`Refund ${total} and save`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`event:create:back:${pending.token}`)
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildEventPreview(event: EventRecord): InteractionEditReplyOptions {
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
    files.push(new AttachmentBuilder(event.artwork_url, { name: event.artwork_name }));
  }

  return {
    content:
      `**Preview** — this will be posted in ` +
      `<#${event.announcement_channel_id}>.\n\n` +
      buildEventAnnouncementText(event),
    embeds: [],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(publish, discard)],
    files,
  };
}

export function buildPublicEventMessage(event: EventRecord): MessageCreateOptions {
  const files: AttachmentBuilder[] = [];

  if (event.artwork_url && event.artwork_name) {
    files.push(new AttachmentBuilder(event.artwork_url, { name: event.artwork_name }));
  }

  return {
    content: buildEventAnnouncementText(event),
    components: [buildAdmissionRow(event)],
    files,
  };
}

// Current admission components for an event: the button disables itself when
// admission is closed and re-enables when a deadline is extended.
export function buildAdmissionComponents(
  event: EventRecord,
  now = currentTimestamp(),
): ActionRowBuilder<ButtonBuilder>[] {
  return [buildAdmissionRow(event, admissionClosed(event, now))];
}

export function buildReminderMessage(
  event: EventRecord,
  content: string,
  now = currentTimestamp(),
): MessageCreateOptions {
  return {
    content,
    components: [buildAdmissionRow(event, admissionClosed(event, now))],
    allowedMentions: { parse: ["everyone", "roles", "users"] },
  };
}

function buildAdmissionRow(
  event: EventRecord,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  const admission =
    event.ticket_price_cents && event.ticket_currency
      ? new ButtonBuilder()
          .setCustomId(`event:buy:${event.id}`)
          .setLabel(
            event.test_mode
              ? `Test checkout — ${formatTicketPrice(event)}`
              : `Buy ticket — ${formatTicketPrice(event)}`,
          )
          .setEmoji("💳")
          .setStyle(ButtonStyle.Success)
      : new ButtonBuilder()
          .setCustomId(`event:rsvp:${event.id}`)
          .setLabel("RSVP")
          .setEmoji("🎟️")
          .setStyle(ButtonStyle.Secondary);
  admission.setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(admission);
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
      "No payment is required to RSVP.",
    ),
    embeds: [],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, notNow)],
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
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(cancel)],
  };
}

export function buildRsvpComplete(
  event: EventRecord,
  changed: boolean,
): EventReplyOptions {
  return {
    content: withTestNote(
      event,
      changed ? "✅ RSVP confirmed." : "✅ You’re already RSVP’d.",
    ),
    embeds: [],
    components: [],
  };
}

export function buildTicketCheckout(
  event: EventRecord,
  checkoutUrl: string,
): EventReplyOptions {
  const checkout = new ButtonBuilder()
    .setLabel(event.test_mode ? "Open Stripe test checkout" : "Open secure checkout")
    .setURL(checkoutUrl)
    .setStyle(ButtonStyle.Link);
  return {
    content: withTestNote(
      event,
      `A ticket for **${event.title}** is reserved for about 30 minutes.\n\n` +
        `Price: **${formatTicketPrice(event)}**\n` +
        (event.test_mode
          ? "Use a Stripe test card such as 4242 4242 4242 4242."
          : "Stripe will collect payment and email your receipt."),
    ),
    embeds: [],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(checkout)],
  };
}

export function buildTicketConfirmed(event: EventRecord): EventReplyOptions {
  return {
    content: withTestNote(
      event,
      `✅ Your ticket for **${event.title}** is confirmed.` +
        (event.test_mode ? "" : " Stripe has emailed your receipt."),
    ),
    embeds: [],
    components: [],
  };
}

export function buildCancellationComplete(
  event: EventRecord,
  changed: boolean,
): EventReplyOptions {
  return {
    content: withTestNote(
      event,
      changed ? "Your RSVP has been cancelled." : "You don’t have an active RSVP.",
    ),
    embeds: [],
    components: [],
  };
}

export function buildEventAnnouncementText(event: EventRecord): string {
  let text = `# ${event.title}\n\n`;
  text += scheduleBlock(event, true);
  text += `${locationLine(event)}\n\n${event.announcement}`;

  if (event.ticket_price_cents && event.ticket_currency) {
    text += `\n\n🎟️ **Tickets: ${formatTicketPrice(event)}**`;
    if (typeof event.ticket_limit === "number") {
      text += ` · ${event.ticket_limit}-ticket capacity`;
    }
    const salesClose = event.ticket_sales_close_at ?? event.ends_at;
    if (typeof salesClose === "number") {
      text += `\n⏳ **Ticket sales close:** <t:${salesClose}:F> (<t:${salesClose}:R>)`;
    }
  } else {
    if (typeof event.ticket_limit === "number") {
      text += `\n\n🎟️ **RSVP capacity:** ${event.ticket_limit} people`;
    }
    const rsvpClose = event.ticket_sales_close_at ?? event.ends_at;
    if (typeof rsvpClose === "number") {
      text +=
        `\n${typeof event.ticket_limit === "number" ? "" : "\n"}` +
        `⏳ **RSVPs close:** <t:${rsvpClose}:F> (<t:${rsvpClose}:R>)`;
    }
  }

  if (typeof event.edited_at === "number") {
    text += `\n\n-# Edited <t:${event.edited_at}:R>`;
  }

  return withTestNote(event, text);
}

function buildCompactRsvpText(
  event: EventRecord,
  heading: string,
  message: string,
): string {
  const schedule = scheduleBlock(event, false);
  return withTestNote(
    event,
    `**${heading}**\n\n${schedule}${locationLine(event)}\n\n${message}`,
  );
}

function admissionClosed(event: EventRecord, now: number): boolean {
  if (typeof event.ends_at === "number" && event.ends_at <= now) return true;
  return (
    typeof event.ticket_sales_close_at === "number" && event.ticket_sales_close_at <= now
  );
}

function formatTicketPrice(event: EventRecord): string {
  if (!event.ticket_price_cents || !event.ticket_currency) {
    throw new Error("This event does not have a ticket price.");
  }

  return formatCurrencyAmount(event.ticket_price_cents, event.ticket_currency);
}
