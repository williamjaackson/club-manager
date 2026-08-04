import { type Client, escapeMarkdown } from "discord.js";
import type { AuditOutboxRecord, Store } from "./database.js";
import { testModeNote } from "./event-ui.js";
import type { SettingsResolver } from "./settings.js";

export class AuditLogger {
  readonly #client: Client;
  readonly #store: Store;
  readonly #settings: SettingsResolver;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  constructor(client: Client, store: Store, settings: SettingsResolver) {
    this.#client = client;
    this.#store = store;
    this.#settings = settings;
  }

  start(): void {
    if (this.#timer) return;

    const flush = () => void this.flush();

    flush();
    this.#timer = setInterval(flush, 30_000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  // Never rejects, so every call site can safely fire-and-forget.
  async flush(): Promise<void> {
    if (this.#running) return this.#running;

    this.#running = this.#flushPending().catch((error: unknown) => {
      console.error("Failed to flush RSVP audit outbox", error);
    });

    try {
      await this.#running;
    } finally {
      this.#running = undefined;
    }
  }

  async #flushPending(): Promise<void> {
    const records = await this.#store.getPendingAudit();

    for (const record of records) {
      try {
        await this.#send(record);
        await this.#store.markAuditSent(record.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to send RSVP audit ${record.id}`, error);
        await this.#store.markAuditFailed(record.id, message);
      }
    }
  }

  async #send(record: AuditOutboxRecord): Promise<void> {
    const { rsvpLogChannelId } = await this.#settings.resolve(record.guild_id);
    if (!rsvpLogChannelId) {
      throw new Error(`Guild ${record.guild_id} has no RSVP log channel; run /config`);
    }

    const channel = await this.#client.channels.fetch(rsvpLogChannelId);

    if (!channel?.isSendable()) {
      throw new Error(
        `RSVP log channel ${rsvpLogChannelId} is unavailable or not sendable`,
      );
    }

    const action = {
      interest_rsvp: "showed interest in",
      interest_ticket: "showed ticket interest in",
      rsvp: "RSVP’d for",
      cancel: "cancelled their RSVP for",
      ticket_paid: "bought a ticket for",
      ticket_refunded: "had their ticket refunded for",
      ticket_price_adjusted: "was refunded a price difference for",
    }[record.action];
    const eventUrl =
      `https://discord.com/channels/${record.guild_id}/` +
      `${record.announcement_channel_id}/${record.message_id}`;

    await channel.send({
      content:
        `<@${record.user_id}> ${action} ` +
        `**${escapeMarkdown(record.title)}**. ${eventUrl}`,
      allowedMentions: {
        parse: [],
        users: [record.user_id],
      },
    });

    if (
      record.action === "ticket_paid" ||
      record.action === "ticket_refunded" ||
      record.action === "ticket_price_adjusted"
    ) {
      await this.#sendTicketDm(record, eventUrl);
    }
  }

  // Members can block DMs, so a failed confirmation must not keep the
  // outbox record retrying forever after the channel post succeeded.
  async #sendTicketDm(record: AuditOutboxRecord, eventUrl: string): Promise<void> {
    const title = escapeMarkdown(record.title);
    let content: string;
    if (record.action === "ticket_paid") {
      content =
        `✅ Your ticket for **${title}** is confirmed.` +
        (record.test_mode ? "" : " Stripe has emailed your receipt.");
    } else if (record.action === "ticket_price_adjusted") {
      content = `💸 The ticket price for **${title}** dropped — your ticket is still valid.`;
    } else {
      content =
        `↩️ Your ticket for **${title}** was refunded and is no longer valid.` +
        (record.test_mode ? "" : " Stripe will return the payment to your card.");
    }
    if (record.detail) content += ` ${record.detail}`;

    const note = testModeNote(record.test_mode);
    try {
      const user = await this.#client.users.fetch(record.user_id);
      await user.send(`${content} ${eventUrl}${note ? `\n${note}` : ""}`);
    } catch (error) {
      console.error(`Failed to DM ticket notification for audit ${record.id}`, error);
    }
  }
}
