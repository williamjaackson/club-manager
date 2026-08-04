import {
  Client,
  escapeMarkdown,
} from "discord.js";
import type { AuditOutboxRecord, Store } from "./database.js";

export class AuditLogger {
  readonly #client: Client;
  readonly #store: Store;
  readonly #channelId: string;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  constructor(client: Client, store: Store, channelId: string) {
    this.#client = client;
    this.#store = store;
    this.#channelId = channelId;
  }

  start(): void {
    if (this.#timer) return;

    const flush = () => {
      void this.flush().catch((error: unknown) => {
        console.error("Failed to flush RSVP audit outbox", error);
      });
    };

    flush();
    this.#timer = setInterval(flush, 30_000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async flush(): Promise<void> {
    if (this.#running) return this.#running;

    this.#running = this.#flushPending();

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
    const channel = await this.#client.channels.fetch(this.#channelId);

    if (!channel?.isSendable()) {
      throw new Error(
        `RSVP log channel ${this.#channelId} is unavailable or not sendable`,
      );
    }

    const action = {
      interest_rsvp: "showed interest in",
      interest_ticket: "showed ticket interest in",
      rsvp: "RSVP’d for",
      cancel: "cancelled their RSVP for",
      ticket_paid: "bought a ticket for",
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

    if (record.action === "ticket_paid") {
      await this.#sendTicketConfirmation(record, eventUrl);
    }
  }

  // Members can block DMs, so a failed confirmation must not keep the
  // outbox record retrying forever after the channel post succeeded.
  async #sendTicketConfirmation(
    record: AuditOutboxRecord,
    eventUrl: string,
  ): Promise<void> {
    try {
      const user = await this.#client.users.fetch(record.user_id);
      await user.send(
        (record.test_mode
          ? `✅ Your test ticket for **${escapeMarkdown(record.title)}** is confirmed. No real payment was made.`
          : `✅ Your ticket for **${escapeMarkdown(record.title)}** is confirmed. Stripe has emailed your receipt.`) +
          ` ${eventUrl}`,
      );
    } catch (error) {
      console.error(
        `Failed to DM ticket confirmation for audit ${record.id}`,
        error,
      );
    }
  }
}
