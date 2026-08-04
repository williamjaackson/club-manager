import type { Client } from "discord.js";
import type { EventRecord, Store } from "./database.js";
import { buildAdmissionComponents, buildEventAnnouncementText } from "./event-ui.js";
import { fetchEventChannel, findOrCreateEventWebhook } from "./event-webhook.js";

// Keeps live attendance counts and sold-out button states on published
// announcements. Edits are trailing-throttled: any number of RSVP or ticket
// changes inside one interval collapse into a single webhook edit per event.
export class AnnouncementRefresher {
  readonly #client: Client;
  readonly #store: Store;
  readonly #onSeatsAvailable: (event: EventRecord, availableSeats: number) => void;
  readonly #dirty = new Set<number>();
  #timer: NodeJS.Timeout | undefined;
  #running = false;

  constructor(
    client: Client,
    store: Store,
    onSeatsAvailable: (event: EventRecord, availableSeats: number) => void = () => {},
  ) {
    this.#client = client;
    this.#store = store;
    this.#onSeatsAvailable = onSeatsAvailable;
  }

  start(intervalMs = 20_000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.flush(), intervalMs);
    this.#timer.unref();
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
    if (this.#running || this.#dirty.size === 0) return;
    this.#running = true;

    const eventIds = [...this.#dirty];
    this.#dirty.clear();

    try {
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

  async #refresh(eventId: number): Promise<void> {
    const event = await this.#store.getEvent(eventId);
    if (event?.status !== "published" || !event.message_id) return;
    if (!this.#client.user) return;

    const attendance = await this.#store.getEventAttendance(eventId);
    if (
      typeof event.ticket_limit === "number" &&
      event.cancelled_at === null &&
      attendance.going < event.ticket_limit
    ) {
      this.#onSeatsAvailable(event, event.ticket_limit - attendance.going);
    }

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
  }
}
