import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { EventAttendeeRecord, EventRecord } from "./database.js";
import type { EventAttendance, EventReplyOptions } from "./event-ui.js";
import { formatCurrencyAmount } from "./money.js";
import { buildPagerRow, pageHeading } from "./pagination.js";

export const EVENT_LIST_PAGE_SIZE = 5;

export const eventAdminIds = {
  select: "event-admin:select",
} as const;

export function buildEventList(
  events: EventRecord[],
  total: number,
  offset: number,
): EventReplyOptions {
  if (total === 0) {
    return {
      content: "No events yet. Run `/event create` to make one.",
      embeds: [],
      components: [],
    };
  }

  const lines = events.map((event, index) => {
    const position = offset + index + 1;
    const status =
      typeof event.cancelled_at === "number"
        ? "❌ cancelled"
        : event.status === "published"
          ? "🟢 published"
          : event.status;
    const when = typeof event.starts_at === "number" ? ` · <t:${event.starts_at}:D>` : "";
    const kind = event.ticket_price_cents ? "🎟️ paid" : "🙋 free";
    return `${position}. **${event.title}** — ${status} · ${kind}${when}`;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(eventAdminIds.select)
    .setPlaceholder("Manage an event…")
    .addOptions(
      events.map((event) => ({
        label: event.title.slice(0, 100),
        description: `#${event.id} · ${event.status}`,
        value: String(event.id),
      })),
    );
  const pager = buildPagerRow("event-admin", offset, total, EVENT_LIST_PAGE_SIZE);

  return {
    content: `${pageHeading("Events", offset, total, EVENT_LIST_PAGE_SIZE)}\n\n${lines.join("\n")}`,
    embeds: [],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      pager,
    ],
  };
}

export function buildEventManageView(
  event: EventRecord,
  attendance: EventAttendance,
): EventReplyOptions {
  const cancelled = typeof event.cancelled_at === "number";
  const status = cancelled
    ? `❌ Cancelled <t:${event.cancelled_at}:R>`
    : `Status: ${event.status}`;
  const paid = event.ticket_price_cents !== null && event.ticket_currency !== null;
  const admission = paid
    ? `🎟️ ${formatCurrencyAmount(
        event.ticket_price_cents as number,
        event.ticket_currency as string,
      )} · ${attendance.going} sold`
    : `🙋 Free · ${attendance.going} going`;
  const link = event.message_id
    ? `\nhttps://discord.com/channels/${event.guild_id}/${event.announcement_channel_id}/${event.message_id}`
    : "";

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event-admin:attendees:${event.id}`)
      .setLabel(paid ? "Ticket holders" : "Attendees")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`event-admin:csv:${event.id}`)
      .setLabel("Export CSV")
      .setStyle(ButtonStyle.Secondary),
  );
  const danger = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event-admin:cancel:${event.id}`)
      .setLabel("Cancel event")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(cancelled || event.status !== "published"),
    new ButtonBuilder()
      .setCustomId(`event-admin:delete:${event.id}`)
      .setLabel("Delete from database")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("event-admin:page:0")
      .setLabel("Back to list")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content:
      `**${event.title}** (#${event.id})\n` +
      `${status}\n${admission}` +
      (typeof event.starts_at === "number" ? `\n📅 <t:${event.starts_at}:F>` : "") +
      link,
    embeds: [],
    components: [actions, danger],
  };
}

export function buildCancelConfirm(
  event: EventRecord,
  paidCount: number,
  refundTotalCents: number,
): EventReplyOptions {
  const currency = event.ticket_currency ?? "aud";
  const refundText =
    paidCount > 0
      ? `Every attendee is notified by DM and **${formatCurrencyAmount(
          refundTotalCents,
          currency,
        )}** is refunded in full across **${paidCount}** ticket${
          paidCount === 1 ? "" : "s"
        }.\n-# Stripe does not return the original processing fees when refunding.`
      : "Every attendee is notified by DM. No paid tickets need refunding.";
  return {
    content:
      `⚠️ **Cancel ${event.title}?** The announcement is updated, admission closes, ` +
      `and this cannot be undone.\n${refundText}`,
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event-admin:cancel-confirm:${event.id}`)
          .setLabel("Cancel event")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`event-admin:manage:${event.id}`)
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildDeleteConfirm(
  event: EventRecord,
  attendance: EventAttendance,
  hasPaidTickets: boolean,
): EventReplyOptions {
  return {
    content:
      `⚠️ **Delete ${event.title} from the database?** All RSVPs, orders, ` +
      `history, and notifications for it are removed permanently. The Discord ` +
      `announcement message is left untouched.` +
      (hasPaidTickets
        ? `\n\n**This event has paid tickets (${attendance.going}).** Deleting does ` +
          "**not** refund anyone — cancel the event first if refunds are needed."
        : ""),
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event-admin:delete-confirm:${event.id}`)
          .setLabel("Delete permanently")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`event-admin:manage:${event.id}`)
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildAttendeeList(
  event: EventRecord,
  attendees: EventAttendeeRecord[],
): EventReplyOptions {
  const paid = event.ticket_price_cents !== null;
  const shown = attendees.slice(0, 30);
  const lines = shown.map((attendee, index) => {
    let line = `${index + 1}. <@${attendee.userId}>`;
    if (attendee.customerName) line += ` — ${attendee.customerName}`;
    if (paid && typeof attendee.amountTotalCents === "number") {
      line += ` (${formatCurrencyAmount(
        attendee.amountTotalCents,
        event.ticket_currency ?? "aud",
      )})`;
    }
    return line;
  });
  const more =
    attendees.length > shown.length
      ? `\n…and ${attendees.length - shown.length} more. Use Export CSV for the full list.`
      : "";

  return {
    content: `**${event.title}** — ${attendees.length} ${paid ? "ticket holder" : "attendee"}${
      attendees.length === 1 ? "" : "s"
    }\n\n${lines.join("\n") || "Nobody yet."}${more}`,
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event-admin:manage:${event.id}`)
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildAttendeesCsv(
  event: EventRecord,
  attendees: EventAttendeeRecord[],
): string {
  const paid = event.ticket_price_cents !== null;
  const header = paid
    ? "discord_user_id,customer_name,customer_email,amount_paid,paid_at"
    : "discord_user_id,rsvp_at";
  const rows = attendees.map((attendee) => {
    if (!paid) {
      return `${attendee.userId},${isoOrEmpty(attendee.respondedAt)}`;
    }
    return [
      attendee.userId,
      csvField(attendee.customerName),
      csvField(attendee.customerEmail),
      typeof attendee.amountTotalCents === "number"
        ? (attendee.amountTotalCents / 100).toFixed(2)
        : "",
      isoOrEmpty(attendee.respondedAt),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

function csvField(value: string | null): string {
  if (!value) return "";
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function isoOrEmpty(timestamp: number | null): string {
  return timestamp === null ? "" : new Date(timestamp * 1000).toISOString();
}
