import type { Client } from "discord.js";
import type { Store } from "./database.js";
import { buildAdmissionComponents, buildEventAnnouncementText } from "./event-ui.js";
import { fetchEventChannel, findOrCreateEventWebhook } from "./event-webhook.js";
import { currentTimestamp } from "./time.js";

// Keeps live attendance counts and sold-out button states on published
// announcements. Edits are trailing-throttled: any number of RSVP or ticket
// changes inside one interval collapse into a single webhook edit per event.
//
// Renders happen for two reasons: something marked the event dirty (an RSVP,
// checkout, webhook, or admin action), or a purely time-based transition
// arrived — a hold or reservation expiring, admission closing, or the event
// finishing. Each render schedules the event's next transition in #watch so
// state that changes with no interaction still updates the message.
export class AnnouncementRefresher {
  readonly #client: Client;
  readonly #store: Store;
  readonly #dirty = new Set<number>();
  readonly #watch = new Map<number, number>();
  #timer: NodeJS.Timeout | undefined;
  #running = false;

  constructor(client: Client, store: Store) {
    this.#client = client;
    this.#store = store;
  }

  start(intervalMs = 20_000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.flush(), intervalMs);
    this.#timer.unref();
    // Re-render every live announcement once on boot: counts may have
    // drifted while the bot was down, and this seeds the transition watch.
    void this.#seed();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  markDirty(eventId: number): void {
    this.#dirty.add(eventId);
  }

  // Never rejects; failed refreshes are retried on the next interval.
  async flush(): Promise<void> {
    if (this.#running) return;
    this.#running = true;

    try {
      const now = currentTimestamp();
      for (const [eventId, transitionAt] of this.#watch) {
        if (transitionAt <= now) {
          this.#watch.delete(eventId);
          this.#dirty.add(eventId);
        }
      }
      if (this.#dirty.size === 0) return;

      const eventIds = [...this.#dirty];
      this.#dirty.clear();

      for (const eventId of eventIds) {
        try {
          await this.#refresh(eventId);
        } catch (error) {
          console.error(`Failed to refresh announcement for event ${eventId}`, error);
          this.#dirty.add(eventId);
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #seed(): Promise<void> {
    try {
      const eventIds = await this.#store.getActivePublishedEventIds();
      for (const eventId of eventIds) {
        this.#dirty.add(eventId);
      }
    } catch (error) {
      console.error("Failed to seed announcement refresher", error);
    }
  }

  async #refresh(eventId: number): Promise<void> {
    const event = await this.#store.getEvent(eventId);
    if (event?.status !== "published" || !event.message_id) {
      this.#watch.delete(eventId);
      return;
    }
    if (!this.#client.user) return;

    const attendance = await this.#store.getEventAttendance(eventId);
    const channel = await fetchEventChannel(this.#client, event.announcement_channel_id);
    if (!channel) throw new Error("announcement channel unavailable");

    const components = buildAdmissionComponents(event, undefined, attendance);
    const webhook = await findOrCreateEventWebhook(channel, this.#client.user.id);
    await webhook.editMessage(event.message_id, {
      content: buildEventAnnouncementText(event, attendance),
      components,
    });

    const reminderIds = await this.#store.getEventReminderMessageIds(eventId);
    for (const reminderId of reminderIds) {
      await channel.messages
        .fetch(reminderId)
        .then((message) => message.edit({ components }))
        .catch((error) => {
          console.error(`Failed to refresh reminder ${reminderId}`, error);
        });
    }

    const nextTransition = await this.#store.getNextEventTransition(eventId);
    if (nextTransition !== undefined && typeof event.cancelled_at !== "number") {
      this.#watch.set(eventId, nextTransition);
    } else {
      this.#watch.delete(eventId);
    }
  }
}
