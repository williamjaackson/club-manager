import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type EventStatus =
  | "draft"
  | "publishing"
  | "published"
  | "discarded";
export type RsvpStatus = "active" | "cancelled";
export type AuditAction = "rsvp" | "cancel";

export interface EventRecord {
  id: number;
  guild_id: string;
  announcement_channel_id: string;
  message_id: string | null;
  creator_id: string;
  title: string;
  schedule_text: string;
  location: string;
  announcement: string;
  artwork_url: string | null;
  artwork_name: string | null;
  status: EventStatus;
  created_at: number;
  published_at: number | null;
}

export interface NewEventDraft {
  guildId: string;
  announcementChannelId: string;
  creatorId: string;
  title: string;
  scheduleText: string;
  location: string;
  announcement: string;
  artworkUrl?: string;
  artworkName?: string;
}

export interface AuditOutboxRecord {
  id: number;
  event_id: number;
  user_id: string;
  action: AuditAction;
  title: string;
  guild_id: string;
  announcement_channel_id: string;
  message_id: string;
}

export interface RsvpChange {
  changed: boolean;
  status: RsvpStatus;
}

export class EventUnavailableError extends Error {
  constructor() {
    super("This event is no longer accepting RSVP changes.");
    this.name = "EventUnavailableError";
  }
}

export class Store {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        announcement_channel_id TEXT NOT NULL,
        message_id TEXT,
        creator_id TEXT NOT NULL,
        title TEXT NOT NULL,
        schedule_text TEXT NOT NULL,
        location TEXT NOT NULL,
        announcement TEXT NOT NULL,
        artwork_url TEXT,
        artwork_name TEXT,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'publishing', 'published', 'discarded')),
        created_at INTEGER NOT NULL,
        published_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS rsvps (
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS rsvp_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('rsvp', 'cancel')),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('rsvp', 'cancel')),
        created_at INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        sent_at INTEGER,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS audit_outbox_pending
        ON audit_outbox (sent_at, next_attempt_at, id);
    `);
  }

  close(): void {
    this.#database.close();
  }

  createEventDraft(
    draft: NewEventDraft,
    now = currentTimestamp(),
  ): EventRecord {
    const result = this.#database
      .prepare(
        `
          INSERT INTO events (
            guild_id,
            announcement_channel_id,
            creator_id,
            title,
            schedule_text,
            location,
            announcement,
            artwork_url,
            artwork_name,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        draft.guildId,
        draft.announcementChannelId,
        draft.creatorId,
        draft.title,
        draft.scheduleText,
        draft.location,
        draft.announcement,
        draft.artworkUrl ?? null,
        draft.artworkName ?? null,
        now,
      );

    return this.getEvent(Number(result.lastInsertRowid))!;
  }

  getEvent(id: number): EventRecord | undefined {
    return this.#database
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(id) as EventRecord | undefined;
  }

  claimEventForPublishing(id: number): boolean {
    const result = this.#database
      .prepare(
        "UPDATE events SET status = 'publishing' WHERE id = ? AND status = 'draft'",
      )
      .run(id);
    return result.changes === 1;
  }

  releaseEventForPublishing(id: number): void {
    this.#database
      .prepare(
        "UPDATE events SET status = 'draft' WHERE id = ? AND status = 'publishing'",
      )
      .run(id);
  }

  finishPublishing(
    id: number,
    messageId: string,
    now = currentTimestamp(),
  ): void {
    const result = this.#database
      .prepare(
        `
          UPDATE events
          SET status = 'published', message_id = ?, published_at = ?
          WHERE id = ? AND status = 'publishing'
        `,
      )
      .run(messageId, now, id);

    if (result.changes !== 1) {
      throw new Error(`Event ${id} could not be marked as published`);
    }
  }

  discardEventDraft(id: number): boolean {
    const result = this.#database
      .prepare(
        "UPDATE events SET status = 'discarded' WHERE id = ? AND status = 'draft'",
      )
      .run(id);
    return result.changes === 1;
  }

  getRsvpStatus(eventId: number, userId: string): RsvpStatus | undefined {
    const row = this.#database
      .prepare("SELECT status FROM rsvps WHERE event_id = ? AND user_id = ?")
      .get(eventId, userId) as { status: RsvpStatus } | undefined;
    return row?.status;
  }

  confirmRsvp(
    eventId: number,
    userId: string,
    now = currentTimestamp(),
  ): RsvpChange {
    return this.#changeRsvp(eventId, userId, "active", "rsvp", now);
  }

  cancelRsvp(
    eventId: number,
    userId: string,
    now = currentTimestamp(),
  ): RsvpChange {
    return this.#changeRsvp(eventId, userId, "cancelled", "cancel", now);
  }

  #changeRsvp(
    eventId: number,
    userId: string,
    status: RsvpStatus,
    action: AuditAction,
    now: number,
  ): RsvpChange {
    this.#database.exec("BEGIN IMMEDIATE");

    try {
      const event = this.getEvent(eventId);

      if (!event || event.status !== "published") {
        throw new EventUnavailableError();
      }

      const currentStatus = this.getRsvpStatus(eventId, userId);

      if (currentStatus === status || (status === "cancelled" && !currentStatus)) {
        this.#database.exec("COMMIT");
        return { changed: false, status };
      }

      this.#database
        .prepare(
          `
            INSERT INTO rsvps (
              event_id, user_id, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (event_id, user_id) DO UPDATE SET
              status = excluded.status,
              updated_at = excluded.updated_at
          `,
        )
        .run(eventId, userId, status, now, now);
      this.#database
        .prepare(
          `
            INSERT INTO rsvp_history (event_id, user_id, action, created_at)
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(eventId, userId, action, now);
      this.#database
        .prepare(
          `
            INSERT INTO audit_outbox (
              event_id, user_id, action, created_at, next_attempt_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(eventId, userId, action, now, now);

      this.#database.exec("COMMIT");
      return { changed: true, status };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getPendingAudit(
    now = currentTimestamp(),
    limit = 25,
  ): AuditOutboxRecord[] {
    return this.#database
      .prepare(
        `
          SELECT
            audit_outbox.id,
            audit_outbox.event_id,
            audit_outbox.user_id,
            audit_outbox.action,
            events.title,
            events.guild_id,
            events.announcement_channel_id,
            events.message_id
          FROM audit_outbox
          JOIN events ON events.id = audit_outbox.event_id
          WHERE
            audit_outbox.sent_at IS NULL
            AND audit_outbox.next_attempt_at <= ?
            AND events.message_id IS NOT NULL
          ORDER BY audit_outbox.id
          LIMIT ?
        `,
      )
      .all(now, limit) as unknown as AuditOutboxRecord[];
  }

  markAuditSent(id: number, now = currentTimestamp()): void {
    this.#database
      .prepare(
        `
          UPDATE audit_outbox
          SET sent_at = ?, last_error = NULL
          WHERE id = ? AND sent_at IS NULL
        `,
      )
      .run(now, id);
  }

  markAuditFailed(
    id: number,
    error: string,
    now = currentTimestamp(),
  ): void {
    const current = this.#database
      .prepare("SELECT attempt_count FROM audit_outbox WHERE id = ?")
      .get(id) as { attempt_count: number } | undefined;
    const attempts = (current?.attempt_count ?? 0) + 1;
    const delay = Math.min(300, 5 * 2 ** Math.min(attempts - 1, 6));

    this.#database
      .prepare(
        `
          UPDATE audit_outbox
          SET
            attempt_count = ?,
            next_attempt_at = ?,
            last_error = ?
          WHERE id = ? AND sent_at IS NULL
        `,
      )
      .run(attempts, now + delay, error.slice(0, 1000), id);
  }

  countRsvpHistory(eventId: number): number {
    const row = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM rsvp_history WHERE event_id = ?",
      )
      .get(eventId) as { count: number };
    return row.count;
  }
}

function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
