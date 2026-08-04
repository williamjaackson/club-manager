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
export type AuditAction =
  | "interest_rsvp"
  | "interest_ticket"
  | "rsvp"
  | "cancel";
export type InterestKind = "rsvp" | "ticket";
export type TicketOrderStatus = "pending" | "paid" | "refunded";

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
  ticket_price_cents: number | null;
  ticket_currency: string | null;
  ticket_limit: number | null;
  test_mode: boolean;
  starts_at: number | null;
  ends_at: number | null;
  ticket_sales_close_at: number | null;
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
  ticketPriceCents?: number;
  ticketCurrency?: string;
  ticketLimit?: number;
  testMode?: boolean;
  startsAt?: number;
  endsAt?: number;
  ticketSalesCloseAt?: number;
}

export interface PendingEventCreateRecord {
  token: string;
  user_id: string;
  guild_id: string;
  announcement_channel_id: string | null;
  title: string | null;
  location: string | null;
  announcement: string | null;
  artwork_url: string | null;
  artwork_name: string | null;
  ticket_price_cents: number | null;
  ticket_currency: string | null;
  ticket_limit: number | null;
  test_mode: boolean;
  starts_at: number | null;
  ends_at: number | null;
  ticket_sales_close_at: number | null;
  created_at: number;
  expires_at: number;
}

export interface NewPendingEventCreate {
  token: string;
  userId: string;
  guildId: string;
  announcementChannelId?: string;
  title?: string;
  location?: string;
  announcement?: string;
  artworkUrl?: string;
  artworkName?: string;
  ticketPriceCents?: number;
  ticketCurrency?: string;
  ticketLimit?: number;
  testMode?: boolean;
  startsAt?: number;
  endsAt?: number;
  ticketSalesCloseAt?: number;
}

export interface PendingEventDetails {
  announcementChannelId: string;
  title: string;
  location: string;
  announcement: string;
  artworkUrl?: string;
  artworkName?: string;
}

export interface PendingEventSchedule {
  startsAt: number;
  endsAt?: number;
  ticketSalesCloseAt?: number;
}

export interface TicketOrderRecord {
  id: number;
  event_id: number;
  user_id: string;
  status: TicketOrderStatus;
  attempt: number;
  checkout_session_id: string | null;
  checkout_url: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_refund_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  amount_total: number | null;
  currency: string | null;
  created_at: number;
  updated_at: number;
  checkout_expires_at: number;
  reservation_expires_at: number;
  paid_at: number | null;
  refunded_at: number | null;
}

export interface TicketCheckoutReservation {
  order: TicketOrderRecord;
  alreadyPaid: boolean;
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

export class TicketSoldOutError extends Error {
  constructor() {
    super("Tickets for this event are sold out.");
    this.name = "TicketSoldOutError";
  }
}

export class RsvpCapacityReachedError extends Error {
  constructor() {
    super("This event has reached its RSVP capacity.");
    this.name = "RsvpCapacityReachedError";
  }
}

export class EventFinishedError extends Error {
  constructor() {
    super("This event has finished and is no longer accepting responses.");
    this.name = "EventFinishedError";
  }
}

export class TicketSalesClosedError extends Error {
  constructor() {
    super("Ticket sales for this event are closed.");
    this.name = "TicketSalesClosedError";
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
        ticket_price_cents INTEGER,
        ticket_currency TEXT,
        ticket_limit INTEGER,
        test_mode BOOLEAN NOT NULL DEFAULT FALSE,
        starts_at DOUBLE PRECISION,
        ends_at DOUBLE PRECISION,
        ticket_sales_close_at DOUBLE PRECISION,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'publishing', 'published', 'discarded')),
        created_at DOUBLE PRECISION NOT NULL,
        published_at DOUBLE PRECISION
      );

      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_price_cents INTEGER;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_currency TEXT;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_limit INTEGER;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS starts_at DOUBLE PRECISION;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ends_at DOUBLE PRECISION;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_sales_close_at DOUBLE PRECISION;

      CREATE TABLE IF NOT EXISTS pending_event_creates (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        announcement_channel_id TEXT,
        title TEXT,
        location TEXT,
        announcement TEXT,
        artwork_url TEXT,
        artwork_name TEXT,
        ticket_price_cents INTEGER,
        ticket_currency TEXT,
        ticket_limit INTEGER,
        test_mode BOOLEAN NOT NULL DEFAULT FALSE,
        starts_at DOUBLE PRECISION,
        ends_at DOUBLE PRECISION,
        ticket_sales_close_at DOUBLE PRECISION,
        created_at DOUBLE PRECISION NOT NULL,
        expires_at DOUBLE PRECISION NOT NULL
      );

      ALTER TABLE pending_event_creates
        ADD COLUMN IF NOT EXISTS announcement_channel_id TEXT;
      ALTER TABLE pending_event_creates ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE pending_event_creates ADD COLUMN IF NOT EXISTS location TEXT;
      ALTER TABLE pending_event_creates ADD COLUMN IF NOT EXISTS announcement TEXT;
      ALTER TABLE pending_event_creates
        ADD COLUMN IF NOT EXISTS ticket_price_cents INTEGER;
      ALTER TABLE pending_event_creates
        ADD COLUMN IF NOT EXISTS ticket_currency TEXT;
      ALTER TABLE pending_event_creates
        ADD COLUMN IF NOT EXISTS ticket_limit INTEGER;
      ALTER TABLE pending_event_creates
        ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE pending_event_creates ADD COLUMN IF NOT EXISTS starts_at DOUBLE PRECISION;
      ALTER TABLE pending_event_creates ADD COLUMN IF NOT EXISTS ends_at DOUBLE PRECISION;
      ALTER TABLE pending_event_creates
        ADD COLUMN IF NOT EXISTS ticket_sales_close_at DOUBLE PRECISION;

      CREATE TABLE IF NOT EXISTS ticket_orders (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CONSTRAINT ticket_orders_status_check
          CHECK (status IN ('pending', 'paid', 'refunded')),
        attempt INTEGER NOT NULL DEFAULT 1,
        checkout_session_id TEXT UNIQUE,
        checkout_url TEXT,
        stripe_payment_intent_id TEXT,
        stripe_charge_id TEXT,
        stripe_refund_id TEXT,
        customer_email TEXT,
        customer_name TEXT,
        amount_total INTEGER,
        currency TEXT,
        created_at DOUBLE PRECISION NOT NULL,
        updated_at DOUBLE PRECISION NOT NULL,
        checkout_expires_at DOUBLE PRECISION NOT NULL,
        reservation_expires_at DOUBLE PRECISION NOT NULL,
        paid_at DOUBLE PRECISION,
        refunded_at DOUBLE PRECISION,
        UNIQUE (event_id, user_id)
      );

      ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;
      ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT;
      ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS refunded_at DOUBLE PRECISION;
      ALTER TABLE ticket_orders DROP CONSTRAINT IF EXISTS ticket_orders_status_check;
      ALTER TABLE ticket_orders ADD CONSTRAINT ticket_orders_status_check
        CHECK (status IN ('pending', 'paid', 'refunded'));

      CREATE INDEX IF NOT EXISTS ticket_orders_capacity
        ON ticket_orders (event_id, status, reservation_expires_at);
      CREATE INDEX IF NOT EXISTS ticket_orders_payment_intent
        ON ticket_orders (stripe_payment_intent_id);

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

      CREATE TABLE IF NOT EXISTS event_interest (
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('rsvp', 'ticket')),
        created_at DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (event_id, user_id, kind)
      );

      CREATE TABLE IF NOT EXISTS event_reminders (
        event_id INTEGER NOT NULL REFERENCES events(id),
        message_id TEXT PRIMARY KEY,
        created_at DOUBLE PRECISION NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_outbox (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        user_id TEXT NOT NULL,
        action TEXT NOT NULL CONSTRAINT audit_outbox_action_check
          CHECK (action IN (
            'interest_rsvp', 'interest_ticket', 'rsvp', 'cancel'
          )),
        created_at DOUBLE PRECISION NOT NULL,
        next_attempt_at DOUBLE PRECISION NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        sent_at DOUBLE PRECISION,
        last_error TEXT
      );

      ALTER TABLE audit_outbox
        DROP CONSTRAINT IF EXISTS audit_outbox_action_check;
      ALTER TABLE audit_outbox ADD CONSTRAINT audit_outbox_action_check
        CHECK (action IN (
          'interest_rsvp', 'interest_ticket', 'rsvp', 'cancel'
        ));

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
          ticket_price_cents,
          ticket_currency,
          ticket_limit,
          test_mode,
          starts_at,
          ends_at,
          ticket_sales_close_at,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17
        )
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
        draft.ticketPriceCents ?? null,
        draft.ticketCurrency ?? null,
        draft.ticketLimit ?? null,
        draft.testMode ?? false,
        draft.startsAt ?? null,
        draft.endsAt ?? null,
        draft.ticketSalesCloseAt ?? null,
        now,
      ],
    );

    return result.rows[0] as EventRecord;
  }

  async getEvent(id: number): Promise<EventRecord | undefined> {
    return this.#getEvent(this.#pool, id);
  }

  async getEventByMessageId(
    guildId: string,
    messageId: string,
  ): Promise<EventRecord | undefined> {
    const result = await this.#pool.query(
      "SELECT * FROM events WHERE guild_id = $1 AND message_id = $2",
      [guildId, messageId],
    );
    return result.rows[0] as EventRecord | undefined;
  }

  async recordEventReminder(
    eventId: number,
    messageId: string,
    now = currentTimestamp(),
  ): Promise<void> {
    await this.#pool.query(
      `
        INSERT INTO event_reminders (event_id, message_id, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id) DO NOTHING
      `,
      [eventId, messageId, now],
    );
  }

  async isEventAdmissionMessage(
    eventId: number,
    messageId: string,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `
        SELECT 1 FROM events WHERE id = $1 AND message_id = $2
        UNION ALL
        SELECT 1 FROM event_reminders WHERE event_id = $1 AND message_id = $2
        LIMIT 1
      `,
      [eventId, messageId],
    );
    return result.rows.length > 0;
  }

  async recordInterest(
    eventId: number,
    userId: string,
    kind: InterestKind,
    now = currentTimestamp(),
  ): Promise<boolean> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const event = await client.query(
        "SELECT id FROM events WHERE id = $1 FOR UPDATE",
        [eventId],
      );
      if (event.rows.length === 0) {
        throw new Error("Event does not exist.");
      }
      const existing = await client.query(
        `
          SELECT 1 FROM event_interest
          WHERE event_id = $1 AND user_id = $2 AND kind = $3
        `,
        [eventId, userId, kind],
      );
      if (existing.rows.length > 0) {
        await client.query("COMMIT");
        return false;
      }

      await client.query(
        `
          INSERT INTO event_interest (event_id, user_id, kind, created_at)
          VALUES ($1, $2, $3, $4)
        `,
        [eventId, userId, kind, now],
      );

      await client.query(
        `
          INSERT INTO audit_outbox (
            event_id, user_id, action, created_at, next_attempt_at
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          eventId,
          userId,
          kind === "rsvp" ? "interest_rsvp" : "interest_ticket",
          now,
          now,
        ],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
          announcement_channel_id,
          title,
          location,
          announcement,
          artwork_url,
          artwork_name,
          ticket_price_cents,
          ticket_currency,
          ticket_limit,
          test_mode,
          starts_at,
          ends_at,
          ticket_sales_close_at,
          created_at,
          expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
      `,
      [
        pending.token,
        pending.userId,
        pending.guildId,
        pending.announcementChannelId ?? null,
        pending.title ?? null,
        pending.location ?? null,
        pending.announcement ?? null,
        pending.artworkUrl ?? null,
        pending.artworkName ?? null,
        pending.ticketPriceCents ?? null,
        pending.ticketCurrency ?? null,
        pending.ticketLimit ?? null,
        pending.testMode ?? false,
        pending.startsAt ?? null,
        pending.endsAt ?? null,
        pending.ticketSalesCloseAt ?? null,
        now,
        now + lifetimeSeconds,
      ],
    );
  }

  async updatePendingEventDetails(
    token: string,
    userId: string,
    guildId: string | null,
    details: PendingEventDetails,
    now = currentTimestamp(),
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `
        UPDATE pending_event_creates
        SET
          announcement_channel_id = $1,
          title = $2,
          location = $3,
          announcement = $4,
          artwork_url = $5,
          artwork_name = $6
        WHERE
          token = $7
          AND user_id = $8
          AND guild_id = $9
          AND expires_at > $10
      `,
      [
        details.announcementChannelId,
        details.title,
        details.location,
        details.announcement,
        details.artworkUrl ?? null,
        details.artworkName ?? null,
        token,
        userId,
        guildId,
        now,
      ],
    );
    return result.rowCount === 1;
  }

  async updatePendingEventSchedule(
    token: string,
    userId: string,
    guildId: string | null,
    schedule: PendingEventSchedule,
    now = currentTimestamp(),
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `
        UPDATE pending_event_creates
        SET starts_at = $1, ends_at = $2, ticket_sales_close_at = $3
        WHERE
          token = $4
          AND user_id = $5
          AND guild_id = $6
          AND expires_at > $7
      `,
      [
        schedule.startsAt,
        schedule.endsAt ?? null,
        schedule.ticketSalesCloseAt ?? null,
        token,
        userId,
        guildId,
        now,
      ],
    );
    return result.rowCount === 1;
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

  async getTicketOrder(
    id: number,
  ): Promise<TicketOrderRecord | undefined> {
    const result = await this.#pool.query(
      "SELECT * FROM ticket_orders WHERE id = $1",
      [id],
    );
    return result.rows[0] as TicketOrderRecord | undefined;
  }

  async getTicketOrderForMember(
    eventId: number,
    userId: string,
  ): Promise<TicketOrderRecord | undefined> {
    const result = await this.#pool.query(
      `
        SELECT *
        FROM ticket_orders
        WHERE event_id = $1 AND user_id = $2
      `,
      [eventId, userId],
    );
    return result.rows[0] as TicketOrderRecord | undefined;
  }

  async getTicketOrderByCheckoutSession(
    checkoutSessionId: string,
  ): Promise<TicketOrderRecord | undefined> {
    const result = await this.#pool.query(
      "SELECT * FROM ticket_orders WHERE checkout_session_id = $1",
      [checkoutSessionId],
    );
    return result.rows[0] as TicketOrderRecord | undefined;
  }

  async reserveTicketCheckout(
    eventId: number,
    userId: string,
    now = currentTimestamp(),
    checkoutLifetimeSeconds = 31 * 60,
    webhookGraceSeconds = 5 * 60,
  ): Promise<TicketCheckoutReservation> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const event = await this.#getEvent(client, eventId, true);

      if (
        !event ||
        event.status !== "published" ||
        !event.ticket_price_cents ||
        !event.ticket_currency
      ) {
        throw new EventUnavailableError();
      }

      if (
        (event.ends_at !== null && event.ends_at <= now) ||
        (event.ticket_sales_close_at !== null &&
          event.ticket_sales_close_at <= now)
      ) {
        throw new TicketSalesClosedError();
      }

      const existingResult = await client.query(
        `
          SELECT *
          FROM ticket_orders
          WHERE event_id = $1 AND user_id = $2
          FOR UPDATE
        `,
        [eventId, userId],
      );
      const existing = existingResult.rows[0] as
        | TicketOrderRecord
        | undefined;

      if (existing?.status === "paid") {
        await client.query("COMMIT");
        return { order: existing, alreadyPaid: true };
      }

      if (
        existing?.status === "pending" &&
        existing.reservation_expires_at > now
      ) {
        await client.query("COMMIT");
        return { order: existing, alreadyPaid: false };
      }

      const capacityResult = await client.query(
        `
          SELECT COUNT(*)::integer AS count
          FROM ticket_orders
          WHERE
            event_id = $1
            AND (
              status = 'paid'
              OR (status = 'pending' AND reservation_expires_at > $2)
            )
        `,
        [eventId, now],
      );
      const reservedCount = Number(
        (capacityResult.rows[0] as { count: number }).count,
      );

      if (event.ticket_limit !== null && reservedCount >= event.ticket_limit) {
        throw new TicketSoldOutError();
      }

      const checkoutExpiresAt = now + checkoutLifetimeSeconds;
      const reservationExpiresAt = checkoutExpiresAt + webhookGraceSeconds;
      let orderResult;

      if (existing) {
        orderResult = await client.query(
          `
            UPDATE ticket_orders
            SET
              status = 'pending',
              attempt = attempt + 1,
              checkout_session_id = NULL,
              checkout_url = NULL,
              stripe_payment_intent_id = NULL,
              stripe_charge_id = NULL,
              stripe_refund_id = NULL,
              customer_email = NULL,
              customer_name = NULL,
              amount_total = NULL,
              currency = NULL,
              updated_at = $1,
              checkout_expires_at = $2,
              reservation_expires_at = $3,
              paid_at = NULL,
              refunded_at = NULL
            WHERE id = $4
            RETURNING *
          `,
          [now, checkoutExpiresAt, reservationExpiresAt, existing.id],
        );
      } else {
        orderResult = await client.query(
          `
            INSERT INTO ticket_orders (
              event_id,
              user_id,
              status,
              created_at,
              updated_at,
              checkout_expires_at,
              reservation_expires_at
            ) VALUES ($1, $2, 'pending', $3, $4, $5, $6)
            RETURNING *
          `,
          [
            eventId,
            userId,
            now,
            now,
            checkoutExpiresAt,
            reservationExpiresAt,
          ],
        );
      }

      await client.query("COMMIT");
      return {
        order: orderResult.rows[0] as TicketOrderRecord,
        alreadyPaid: false,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async attachTicketCheckout(
    orderId: number,
    attempt: number,
    checkoutSessionId: string,
    checkoutUrl: string,
    now = currentTimestamp(),
  ): Promise<TicketOrderRecord> {
    const result = await this.#pool.query(
      `
        UPDATE ticket_orders
        SET
          checkout_session_id = $1,
          checkout_url = $2,
          updated_at = $3
        WHERE
          id = $4
          AND attempt = $5
          AND status = 'pending'
          AND (checkout_session_id IS NULL OR checkout_session_id = $1)
        RETURNING *
      `,
      [checkoutSessionId, checkoutUrl, now, orderId, attempt],
    );
    const order = result.rows[0] as TicketOrderRecord | undefined;

    if (!order) {
      throw new Error("This ticket checkout reservation is no longer active.");
    }

    return order;
  }

  async fulfillTicketOrder(
    orderId: number,
    checkoutSessionId: string,
    details: {
      paymentIntentId?: string;
      customerEmail?: string;
      customerName?: string;
      amountTotal: number;
      currency: string;
    },
    now = currentTimestamp(),
  ): Promise<boolean> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM ticket_orders WHERE id = $1 FOR UPDATE",
        [orderId],
      );
      const order = result.rows[0] as TicketOrderRecord | undefined;

      if (!order) throw new Error("Ticket order does not exist.");

      if (order.status === "paid") {
        if (order.checkout_session_id !== checkoutSessionId) {
          throw new Error("Ticket order was paid by a different Checkout Session.");
        }

        await client.query("COMMIT");
        return false;
      }

      if (order.status === "refunded") {
        if (order.checkout_session_id !== checkoutSessionId) {
          throw new Error("Ticket order was refunded from a different Checkout Session.");
        }

        await client.query("COMMIT");
        return false;
      }

      if (
        order.checkout_session_id &&
        order.checkout_session_id !== checkoutSessionId
      ) {
        throw new Error("Checkout Session does not match this ticket order.");
      }

      await client.query(
        `
          UPDATE ticket_orders
          SET
            status = 'paid',
            checkout_session_id = $1,
            stripe_payment_intent_id = $2,
            customer_email = $3,
            customer_name = $4,
            amount_total = $5,
            currency = $6,
            updated_at = $7,
            paid_at = $8
          WHERE id = $9
        `,
        [
          checkoutSessionId,
          details.paymentIntentId ?? null,
          details.customerEmail ?? null,
          details.customerName ?? null,
          details.amountTotal,
          details.currency,
          now,
          now,
          orderId,
        ],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async refundTicketOrderByPaymentIntent(
    paymentIntentId: string,
    details: {
      chargeId: string;
      refundId?: string;
      testMode: boolean;
    },
    now = currentTimestamp(),
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `
        UPDATE ticket_orders
        SET
          status = 'refunded',
          stripe_charge_id = $1,
          stripe_refund_id = $2,
          updated_at = $3,
          refunded_at = $4
        WHERE
          stripe_payment_intent_id = $5
          AND status = 'paid'
          AND event_id IN (SELECT id FROM events WHERE test_mode = $6)
        RETURNING id
      `,
      [
        details.chargeId,
        details.refundId ?? null,
        now,
        now,
        paymentIntentId,
        details.testMode,
      ],
    );
    return result.rows.length > 0;
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
      if (
        status === "active" &&
        event.ends_at !== null &&
        event.ends_at <= now
      ) {
        throw new EventFinishedError();
      }
      if (status === "active" && event.ticket_price_cents !== null) {
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

      if (status === "active" && event.ticket_limit !== null) {
        const capacityResult = await client.query(
          `
            SELECT COUNT(*)::integer AS count
            FROM rsvps
            WHERE event_id = $1 AND status = 'active'
          `,
          [eventId],
        );
        const activeCount = Number(
          (capacityResult.rows[0] as { count: number }).count,
        );
        if (activeCount >= event.ticket_limit) {
          throw new RsvpCapacityReachedError();
        }
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
