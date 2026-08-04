import {
  type Guild,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
} from "discord.js";
import type { EventRecord, Store } from "./database.js";

// Mirrors published announcements into Discord's native Events tab so members
// get platform reminders for free. Every operation is best-effort: a missing
// Manage Events permission must never break publishing or editing.
export class ScheduledEventSync {
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  async create(guild: Guild | null, event: EventRecord): Promise<void> {
    if (!guild || typeof event.starts_at !== "number") return;
    if (event.starts_at * 1000 <= Date.now()) return;

    try {
      const scheduled = await guild.scheduledEvents.create({
        name: event.title.slice(0, 100),
        scheduledStartTime: event.starts_at * 1000,
        scheduledEndTime: endTimeMs(event),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: event.location.slice(0, 100) },
        description: event.announcement.slice(0, 1000),
      });
      await this.#store.setEventScheduledEventId(event.id, scheduled.id);
    } catch (error) {
      console.warn(
        `Could not create a Discord scheduled event for event ${event.id} ` +
          "(missing Manage Events permission?)",
        error,
      );
    }
  }

  async update(guild: Guild | null, event: EventRecord): Promise<void> {
    if (!guild || !event.scheduled_event_id) return;
    if (typeof event.starts_at !== "number" || event.starts_at * 1000 <= Date.now()) {
      return;
    }

    try {
      await guild.scheduledEvents.edit(event.scheduled_event_id, {
        name: event.title.slice(0, 100),
        scheduledStartTime: event.starts_at * 1000,
        scheduledEndTime: endTimeMs(event),
        entityMetadata: { location: event.location.slice(0, 100) },
        description: event.announcement.slice(0, 1000),
      });
    } catch (error) {
      console.warn(
        `Could not update the Discord scheduled event for event ${event.id}`,
        error,
      );
    }
  }

  async cancel(guild: Guild | null, event: EventRecord): Promise<void> {
    if (!guild || !event.scheduled_event_id) return;

    try {
      await guild.scheduledEvents.edit(event.scheduled_event_id, {
        status: GuildScheduledEventStatus.Canceled,
      });
    } catch (error) {
      console.warn(
        `Could not cancel the Discord scheduled event for event ${event.id}`,
        error,
      );
    } finally {
      await this.#store.setEventScheduledEventId(event.id, null).catch(() => undefined);
    }
  }
}

// External scheduled events require an end time; default to two hours.
function endTimeMs(event: EventRecord): number {
  return typeof event.ends_at === "number"
    ? event.ends_at * 1000
    : ((event.starts_at as number) + 2 * 60 * 60) * 1000;
}
