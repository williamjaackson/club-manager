import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from "discord.js";
import type { EventRecord, Store } from "./database.js";
import { testModeNote } from "./event-ui.js";
import { currentTimestamp } from "./time.js";

const OFFER_WINDOW_SECONDS = 24 * 60 * 60;

// Promotes waitlisted members when seats free up. Each promoted member gets
// a DM with a 24-hour claim button; lapsed offers drop off the list so the
// seat rolls to the next member on the following sweep.
export class WaitlistManager {
  readonly #client: Client;
  readonly #store: Store;

  constructor(client: Client, store: Store) {
    this.#client = client;
    this.#store = store;
  }

  // Never rejects; called from the announcement refresher's sweep.
  async promote(event: EventRecord, availableSeats: number): Promise<void> {
    try {
      const now = currentTimestamp();
      await this.#store.expireWaitlistOffers(event.id, now);
      const held = await this.#store.countActiveWaitlistOffers(event.id, now);
      const open = availableSeats - held;
      if (open <= 0) return;

      const candidates = await this.#store.nextWaitlistCandidates(event.id, open);
      for (const candidate of candidates) {
        const expiresAt = now + OFFER_WINDOW_SECONDS;
        try {
          await this.#sendOffer(event, candidate.user_id, expiresAt);
          await this.#store.markWaitlistOffered(event.id, candidate.user_id, expiresAt);
        } catch (error) {
          // Unreachable members (blocked DMs) lose their spot; the next
          // sweep offers the seat to the following member.
          console.warn(
            `Could not DM waitlist offer for event ${event.id} to ` +
              `${candidate.user_id}; removing them from the waitlist`,
            error,
          );
          await this.#store
            .removeWaitlistEntry(event.id, candidate.user_id)
            .catch(() => undefined);
        }
      }
    } catch (error) {
      console.error(`Waitlist promotion failed for event ${event.id}`, error);
    }
  }

  async #sendOffer(event: EventRecord, userId: string, expiresAt: number): Promise<void> {
    const user = await this.#client.users.fetch(userId);
    const note = testModeNote(event.test_mode);
    const claim = new ButtonBuilder()
      .setCustomId(`event:claim:${event.id}`)
      .setLabel(event.ticket_price_cents ? "Claim your ticket" : "Claim your spot")
      .setStyle(ButtonStyle.Success);

    await user.send({
      content:
        `🎉 A spot opened up for **${event.title}**! ` +
        `Claim it before <t:${expiresAt}:F> (<t:${expiresAt}:R>) or it goes to ` +
        `the next member in line.${note ? `\n${note}` : ""}`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(claim)],
    });
  }
}
