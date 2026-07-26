import {
  Pool,
  neonConfig,
  type PoolClient,
} from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

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

export interface PendingEventCreateRecord {
  token: string;
  user_id: string;
  guild_id: string;
  artwork_url: string | null;
  artwork_name: string | null;
  created_at: number;
  expires_at: number;
}

export interface NewPendingEventCreate {
  token: string;
  userId: string;
  guildId: string;
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

type Queryable = Pool | PoolClient;

export function createDatabasePool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 60_000,
  });
  pool.on("error", (error: unknown) => {
    console.error("Unexpected Neon connection pool error", error);
  });
  return pool;
}

export function directDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}

export async function setupDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
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
        created_at DOUBLE PRECISION NOT NULL,
        published_at DOUBLE PRECISION
      );

      CREATE TABLE IF NOT EXISTS pending_event_creates (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        artwork_url TEXT,
        artwork_name TEXT,
        created_at DOUBLE PRECISION NOT NULL,
        expires_at DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rsvps (
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
        created_at DOUBLE PRECISION NOT NULL,
        updated_at DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (event_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS rsvp_history (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('rsvp', 'cancel')),
        created_at DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_outbox (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('rsvp', 'cancel')),
        created_at DOUBLE PRECISION NOT NULL,
        next_attempt_at DOUBLE PRECISION NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        sent_at DOUBLE PRECISION,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS audit_outbox_pending
        ON audit_outbox (sent_at, next_attempt_at, id);
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase(
  connectionString: string,
): Promise<void> {
  const pool = createDatabasePool(directDatabaseUrl(connectionString));

  try {
    await setupDatabase(pool);
  } finally {
    await pool.end();
  }
}

export class Store {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async createEventDraft(
    draft: NewEventDraft,
    now = currentTimestamp(),
  ): Promise<EventRecord> {
    const result = await this.#pool.query(
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
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
      ],
    );

    return result.rows[0] as EventRecord;
  }

  async getEvent(id: number): Promise<EventRecord | undefined> {
    return this.#getEvent(this.#pool, id);
  }

  async createPendingEventCreate(
    pending: NewPendingEventCreate,
    now = currentTimestamp(),
    lifetimeSeconds = 15 * 60,
  ): Promise<void> {
    await this.#pool.query(
      "DELETE FROM pending_event_creates WHERE expires_at <= $1",
      [now],
    );
    await this.#pool.query(
      `
        INSERT INTO pending_event_creates (
          token,
          user_id,
          guild_id,
          artwork_url,
          artwork_name,
          created_at,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        pending.token,
        pending.userId,
        pending.guildId,
        pending.artworkUrl ?? null,
        pending.artworkName ?? null,
        now,
        now + lifetimeSeconds,
      ],
    );
  }

  async getPendingEventCreate(
    token: string,
    now = currentTimestamp(),
  ): Promise<PendingEventCreateRecord | undefined> {
    const result = await this.#pool.query(
      `
        SELECT *
        FROM pending_event_creates
        WHERE token = $1 AND expires_at > $2
      `,
      [token, now],
    );
    return result.rows[0] as PendingEventCreateRecord | undefined;
  }

  async deletePendingEventCreate(token: string): Promise<void> {
    await this.#pool.query(
      "DELETE FROM pending_event_creates WHERE token = $1",
      [token],
    );
  }

  async consumePendingEventCreate(
    token: string,
    userId: string,
    guildId: string | null,
    now = currentTimestamp(),
  ): Promise<PendingEventCreateRecord | undefined> {
    const result = await this.#pool.query(
      `
        DELETE FROM pending_event_creates
        WHERE
          token = $1
          AND user_id = $2
          AND guild_id = $3
          AND expires_at > $4
        RETURNING *
      `,
      [token, userId, guildId, now],
    );
    return result.rows[0] as PendingEventCreateRecord | undefined;
  }

  async claimEventForPublishing(id: number): Promise<boolean> {
    const result = await this.#pool.query(
      `
        UPDATE events
        SET status = 'publishing'
        WHERE id = $1 AND status = 'draft'
      `,
      [id],
    );
    return result.rowCount === 1;
  }

  async releaseEventForPublishing(id: number): Promise<void> {
    await this.#pool.query(
      `
        UPDATE events
        SET status = 'draft'
        WHERE id = $1 AND status = 'publishing'
      `,
      [id],
    );
  }

  async finishPublishing(
    id: number,
    messageId: string,
    now = currentTimestamp(),
  ): Promise<void> {
    const result = await this.#pool.query(
      `
        UPDATE events
        SET status = 'published', message_id = $1, published_at = $2
        WHERE id = $3 AND status = 'publishing'
      `,
      [messageId, now, id],
    );

    if (result.rowCount !== 1) {
      throw new Error(`Event ${id} could not be marked as published`);
    }
  }

  async discardEventDraft(id: number): Promise<boolean> {
    const result = await this.#pool.query(
      `
        UPDATE events
        SET status = 'discarded'
        WHERE id = $1 AND status = 'draft'
      `,
      [id],
    );
    return result.rowCount === 1;
  }

  async getRsvpStatus(
    eventId: number,
    userId: string,
  ): Promise<RsvpStatus | undefined> {
    return this.#getRsvpStatus(this.#pool, eventId, userId);
  }

  async confirmRsvp(
    eventId: number,
    userId: string,
    now = currentTimestamp(),
  ): Promise<RsvpChange> {
    return this.#changeRsvp(eventId, userId, "active", "rsvp", now);
  }

  async cancelRsvp(
    eventId: number,
    userId: string,
    now = currentTimestamp(),
  ): Promise<RsvpChange> {
    return this.#changeRsvp(eventId, userId, "cancelled", "cancel", now);
  }

  async #changeRsvp(
    eventId: number,
    userId: string,
    status: RsvpStatus,
    action: AuditAction,
    now: number,
  ): Promise<RsvpChange> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      // Lock one stable row before reading/updating an RSVP. This preserves
      // idempotency when Discord retries the same interaction concurrently.
      const event = await this.#getEvent(client, eventId, true);

      if (!event || event.status !== "published") {
        throw new EventUnavailableError();
      }

      const currentStatus = await this.#getRsvpStatus(
        client,
        eventId,
        userId,
      );

      if (
        currentStatus === status ||
        (status === "cancelled" && !currentStatus)
      ) {
        await client.query("COMMIT");
        return { changed: false, status };
      }

      await client.query(
        `
          INSERT INTO rsvps (
            event_id, user_id, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (event_id, user_id) DO UPDATE SET
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        `,
        [eventId, userId, status, now, now],
      );
      await client.query(
        `
          INSERT INTO rsvp_history (event_id, user_id, action, created_at)
          VALUES ($1, $2, $3, $4)
        `,
        [eventId, userId, action, now],
      );
      await client.query(
        `
          INSERT INTO audit_outbox (
            event_id, user_id, action, created_at, next_attempt_at
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [eventId, userId, action, now, now],
      );

      await client.query("COMMIT");
      return { changed: true, status };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getPendingAudit(
    now = currentTimestamp(),
    limit = 25,
  ): Promise<AuditOutboxRecord[]> {
    const result = await this.#pool.query(
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
          AND audit_outbox.next_attempt_at <= $1
          AND events.message_id IS NOT NULL
        ORDER BY audit_outbox.id
        LIMIT $2
      `,
      [now, limit],
    );
    return result.rows as AuditOutboxRecord[];
  }

  async markAuditSent(
    id: number,
    now = currentTimestamp(),
  ): Promise<void> {
    await this.#pool.query(
      `
        UPDATE audit_outbox
        SET sent_at = $1, last_error = NULL
        WHERE id = $2 AND sent_at IS NULL
      `,
      [now, id],
    );
  }

  async markAuditFailed(
    id: number,
    error: string,
    now = currentTimestamp(),
  ): Promise<void> {
    const current = await this.#pool.query(
      "SELECT attempt_count FROM audit_outbox WHERE id = $1",
      [id],
    );
    const attempts =
      Number((current.rows[0] as { attempt_count: number } | undefined)
        ?.attempt_count ?? 0) + 1;
    const delay = Math.min(300, 5 * 2 ** Math.min(attempts - 1, 6));

    await this.#pool.query(
      `
        UPDATE audit_outbox
        SET
          attempt_count = $1,
          next_attempt_at = $2,
          last_error = $3
        WHERE id = $4 AND sent_at IS NULL
      `,
      [attempts, now + delay, error.slice(0, 1000), id],
    );
  }

  async countRsvpHistory(eventId: number): Promise<number> {
    const result = await this.#pool.query(
      "SELECT COUNT(*)::integer AS count FROM rsvp_history WHERE event_id = $1",
      [eventId],
    );
    return (result.rows[0] as { count: number }).count;
  }

  async #getEvent(
    database: Queryable,
    id: number,
    forUpdate = false,
  ): Promise<EventRecord | undefined> {
    const result = await database.query(
      `SELECT * FROM events WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
      [id],
    );
    return result.rows[0] as EventRecord | undefined;
  }

  async #getRsvpStatus(
    database: Queryable,
    eventId: number,
    userId: string,
  ): Promise<RsvpStatus | undefined> {
    const result = await database.query(
      "SELECT status FROM rsvps WHERE event_id = $1 AND user_id = $2",
      [eventId, userId],
    );
    return (result.rows[0] as { status: RsvpStatus } | undefined)?.status;
  }
}

function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
