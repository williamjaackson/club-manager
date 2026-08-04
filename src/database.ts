import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import ws from "ws";
import { currentTimestamp, formatScheduleText } from "./time.js";

neonConfig.webSocketConstructor = ws;

export type EventStatus = "draft" | "publishing" | "published" | "discarded";
export type RsvpStatus = "active" | "cancelled";
export type AuditAction =
  | "interest_rsvp"
  | "interest_ticket"
  | "rsvp"
  | "cancel"
  | "ticket_paid"
  | "ticket_refunded"
  | "ticket_price_adjusted"
  | "event_cancelled";
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
  location_url: string | null;
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
  edited_at: number | null;
  cancelled_at: number | null;
  scheduled_event_id: string | null;
}

export interface NewEventDraft {
  guildId: string;
  announcementChannelId: string;
  creatorId: string;
  title: string;
  scheduleText: string;
  location: string;
  locationUrl?: string;
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
  location_url: string | null;
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
  edit_event_id: number | null;
}

export interface NewPendingEventCreate {
  token: string;
  userId: string;
  guildId: string;
  editEventId?: number;
  locationUrl?: string;
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
  locationUrl?: string;
}

export interface PendingEventAdmission {
  ticketPriceCents?: number;
  ticketCurrency?: string;
  ticketLimit?: number;
  testMode: boolean;
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
  detail: string | null;
  title: string;
  guild_id: string;
  announcement_channel_id: string;
  message_id: string;
  test_mode: boolean;
}

export interface RsvpChange {
  changed: boolean;
  status: RsvpStatus;
}

export interface CouponRecord {
  id: number;
  guild_id: string;
  user_id: string;
  percent_off: number;
  event_id: number | null;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  redeemed_order_id: number | null;
  redeemed_at: number | null;
}

export interface EventAttendeeRecord {
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  amountTotalCents: number | null;
  respondedAt: number | null;
}

export interface PriceDropRefund {
  orderId: number;
  userId: string;
  paymentIntentId: string | null;
  amountCents: number;
  newAmountTotal: number;
}

export interface GuildSettingsRecord {
  guild_id: string;
  rsvp_log_channel_id: string | null;
  verification_message_url: string | null;
  connected_role_id: string | null;
  exempt_role_id: string | null;
  updated_at: number;
}

export interface GuildSettingsUpdate {
  rsvpLogChannelId?: string | null;
  verificationMessageUrl?: string | null;
  connectedRoleId?: string | null;
  exemptRoleId?: string | null;
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

export class EventAdmissionClosedError extends Error {
  constructor() {
    super("This event is closed and no longer accepting RSVPs or ticket sales.");
    this.name = "EventAdmissionClosedError";
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

// After this many delivery failures an audit record is parked (kept unsent,
// never retried) so a permanently broken record can't loop forever.
const MAX_AUDIT_ATTEMPTS = 20;

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

// Neon's pooled endpoint (PgBouncer) can't run schema DDL reliably; strip the
// -pooler suffix to talk to the database directly for setup.
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
        location_url TEXT,
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
        published_at DOUBLE PRECISION,
        edited_at DOUBLE PRECISION,
        cancelled_at DOUBLE PRECISION,
        scheduled_event_id TEXT
      );

      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_price_cents INTEGER;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_currency TEXT;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_limit INTEGER;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS starts_at DOUBLE PRECISION;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ends_at DOUBLE PRECISION;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_sales_close_at DOUBLE PRECISION;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS location_url TEXT;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS edited_at DOUBLE PRECISION;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS cancelled_at DOUBLE PRECISION;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS scheduled_event_id TEXT;

      CREATE TABLE IF NOT EXISTS pending_event_creates (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        announcement_channel_id TEXT,
        title TEXT,
        location TEXT,
        location_url TEXT,
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
        expires_at DOUBLE PRECISION NOT NULL,
        edit_event_id INTEGER
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
      ALTER TABLE pending_event_creates ADD COLUMN IF NOT EXISTS location_url TEXT;
      ALTER TABLE pending_event_creates
        ADD COLUMN IF NOT EXISTS edit_event_id INTEGER;

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
            'interest_rsvp', 'interest_ticket', 'rsvp', 'cancel',
            'ticket_paid', 'ticket_refunded', 'ticket_price_adjusted',
            'event_cancelled'
          )),
        created_at DOUBLE PRECISION NOT NULL,
        next_attempt_at DOUBLE PRECISION NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        sent_at DOUBLE PRECISION,
        last_error TEXT
      );

      ALTER TABLE audit_outbox ADD COLUMN IF NOT EXISTS detail TEXT;
      ALTER TABLE audit_outbox
        DROP CONSTRAINT IF EXISTS audit_outbox_action_check;
      ALTER TABLE audit_outbox ADD CONSTRAINT audit_outbox_action_check
        CHECK (action IN (
          'interest_rsvp', 'interest_ticket', 'rsvp', 'cancel',
          'ticket_paid', 'ticket_refunded', 'ticket_price_adjusted',
          'event_cancelled'
        ));

      CREATE INDEX IF NOT EXISTS audit_outbox_pending
        ON audit_outbox (sent_at, next_attempt_at, id);

      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        percent_off INTEGER NOT NULL
          CHECK (percent_off >= 1 AND percent_off <= 100),
        event_id INTEGER REFERENCES events(id),
        created_by TEXT NOT NULL,
        created_at DOUBLE PRECISION NOT NULL,
        expires_at DOUBLE PRECISION,
        redeemed_order_id INTEGER,
        redeemed_at DOUBLE PRECISION
      );

      CREATE INDEX IF NOT EXISTS coupons_member
        ON coupons (guild_id, user_id, redeemed_at);

      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        rsvp_log_channel_id TEXT,
        verification_message_url TEXT,
        connected_role_id TEXT,
        exempt_role_id TEXT,
        updated_at DOUBLE PRECISION NOT NULL
      );
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase(connectionString: string): Promise<void> {
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
          location_url,
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
          $10, $11, $12, $13, $14, $15, $16, $17, $18
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
        draft.locationUrl ?? null,
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

  async getEventByAdmissionMessageId(
    guildId: string,
    messageId: string,
  ): Promise<EventRecord | undefined> {
    const result = await this.#pool.query(
      `
        SELECT events.*
        FROM events
        LEFT JOIN event_reminders
          ON event_reminders.event_id = events.id
        WHERE
          events.guild_id = $1
          AND (
            events.message_id = $2
            OR event_reminders.message_id = $2
          )
        LIMIT 1
      `,
      [guildId, messageId],
    );
    return result.rows[0] as EventRecord | undefined;
  }

  async getEventReminderMessageIds(eventId: number): Promise<string[]> {
    const result = await this.#pool.query(
      `
        SELECT message_id
        FROM event_reminders
        WHERE event_id = $1
        ORDER BY created_at, message_id
      `,
      [eventId],
    );
    return result.rows.map((row) => (row as { message_id: string }).message_id);
  }

  async closeEventAdmission(eventId: number, now = currentTimestamp()): Promise<boolean> {
    const result = await this.#pool.query(
      `
        UPDATE events
        SET ticket_sales_close_at = $1
        WHERE
          id = $2
          AND status = 'published'
          AND (
            ticket_sales_close_at IS NULL
            OR ticket_sales_close_at > $1
          )
      `,
      [now, eventId],
    );
    return result.rowCount === 1;
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

  async isEventAdmissionMessage(eventId: number, messageId: string): Promise<boolean> {
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
      const event = await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [
        eventId,
      ]);
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
    await this.#pool.query("DELETE FROM pending_event_creates WHERE expires_at <= $1", [
      now,
    ]);
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
          expires_at,
          edit_event_id,
          location_url
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
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
        pending.editEventId ?? null,
        pending.locationUrl ?? null,
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
          artwork_url = COALESCE($5, artwork_url),
          artwork_name = COALESCE($6, artwork_name)
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
        SET
          starts_at = $1,
          ends_at = $2,
          ticket_sales_close_at = $3,
          location_url = $4
        WHERE
          token = $5
          AND user_id = $6
          AND guild_id = $7
          AND expires_at > $8
      `,
      [
        schedule.startsAt,
        schedule.endsAt ?? null,
        schedule.ticketSalesCloseAt ?? null,
        schedule.locationUrl ?? null,
        token,
        userId,
        guildId,
        now,
      ],
    );
    return result.rowCount === 1;
  }

  async updatePendingEventAdmission(
    token: string,
    userId: string,
    guildId: string | null,
    admission: PendingEventAdmission,
    now = currentTimestamp(),
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `
        UPDATE pending_event_creates
        SET
          ticket_price_cents = $1,
          ticket_currency = $2,
          ticket_limit = $3,
          test_mode = $4
        WHERE
          token = $5
          AND user_id = $6
          AND guild_id = $7
          AND expires_at > $8
      `,
      [
        admission.ticketPriceCents ?? null,
        admission.ticketCurrency ?? null,
        admission.ticketLimit ?? null,
        admission.testMode,
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
    await this.#pool.query("DELETE FROM pending_event_creates WHERE token = $1", [token]);
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

  async getRsvpStatus(eventId: number, userId: string): Promise<RsvpStatus | undefined> {
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

  async getTicketOrder(id: number): Promise<TicketOrderRecord | undefined> {
    const result = await this.#pool.query("SELECT * FROM ticket_orders WHERE id = $1", [
      id,
    ]);
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
        event?.status !== "published" ||
        !event.ticket_price_cents ||
        !event.ticket_currency
      ) {
        throw new EventUnavailableError();
      }

      if (
        (event.ends_at !== null && event.ends_at <= now) ||
        (event.ticket_sales_close_at !== null && event.ticket_sales_close_at <= now)
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
      const existing = existingResult.rows[0] as TicketOrderRecord | undefined;

      if (existing?.status === "paid") {
        await client.query("COMMIT");
        return { order: existing, alreadyPaid: true };
      }

      if (existing?.status === "pending" && existing.reservation_expires_at > now) {
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
      const reservedCount = Number((capacityResult.rows[0] as { count: number }).count);

      if (event.ticket_limit !== null && reservedCount >= event.ticket_limit) {
        throw new TicketSoldOutError();
      }

      const checkoutExpiresAt = now + checkoutLifetimeSeconds;
      const reservationExpiresAt = checkoutExpiresAt + webhookGraceSeconds;
      let orderResult: { rows: unknown[] };

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
          [eventId, userId, now, now, checkoutExpiresAt, reservationExpiresAt],
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
      couponId?: number;
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

      if (order.checkout_session_id && order.checkout_session_id !== checkoutSessionId) {
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
      if (details.couponId !== undefined) {
        const redeemed = await client.query(
          `
            UPDATE coupons
            SET redeemed_order_id = $1, redeemed_at = $2
            WHERE id = $3 AND redeemed_at IS NULL
          `,
          [orderId, now, details.couponId],
        );
        if (redeemed.rowCount !== 1) {
          // The member already paid the discounted amount; never fail the
          // fulfillment over a stale coupon — just record it loudly.
          console.warn(
            `Coupon ${details.couponId} was already redeemed when order ` +
              `${orderId} was fulfilled`,
          );
        }
      }
      await client.query(
        `
          INSERT INTO audit_outbox (
            event_id, user_id, action, created_at, next_attempt_at
          ) VALUES ($1, $2, 'ticket_paid', $3, $4)
        `,
        [order.event_id, order.user_id, now, now],
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
  ): Promise<number | undefined> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
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
          RETURNING event_id, user_id
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
      const order = result.rows[0] as { event_id: number; user_id: string } | undefined;

      if (order) {
        await client.query(
          `
            INSERT INTO audit_outbox (
              event_id, user_id, action, created_at, next_attempt_at
            ) VALUES ($1, $2, 'ticket_refunded', $3, $4)
          `,
          [order.event_id, order.user_id, now, now],
        );
      }

      await client.query("COMMIT");
      return order?.event_id;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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

      if (event?.status !== "published") {
        throw new EventUnavailableError();
      }
      if (status === "active" && event.ends_at !== null && event.ends_at <= now) {
        throw new EventFinishedError();
      }
      if (
        status === "active" &&
        event.ticket_sales_close_at !== null &&
        event.ticket_sales_close_at <= now
      ) {
        throw new EventAdmissionClosedError();
      }
      if (status === "active" && event.ticket_price_cents !== null) {
        throw new EventUnavailableError();
      }

      const currentStatus = await this.#getRsvpStatus(client, eventId, userId);

      if (currentStatus === status || (status === "cancelled" && !currentStatus)) {
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
        const activeCount = Number((capacityResult.rows[0] as { count: number }).count);
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
          audit_outbox.detail,
          events.title,
          events.guild_id,
          events.announcement_channel_id,
          events.message_id,
          events.test_mode
        FROM audit_outbox
        JOIN events ON events.id = audit_outbox.event_id
        WHERE
          audit_outbox.sent_at IS NULL
          AND audit_outbox.next_attempt_at <= $1
          AND audit_outbox.attempt_count < ${MAX_AUDIT_ATTEMPTS}
          AND events.message_id IS NOT NULL
        ORDER BY audit_outbox.id
        LIMIT $2
      `,
      [now, limit],
    );
    return result.rows as AuditOutboxRecord[];
  }

  async markAuditSent(id: number, now = currentTimestamp()): Promise<void> {
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
      Number(
        (current.rows[0] as { attempt_count: number } | undefined)?.attempt_count ?? 0,
      ) + 1;
    const delay = Math.min(300, 5 * 2 ** Math.min(attempts - 1, 6));

    if (attempts >= MAX_AUDIT_ATTEMPTS) {
      console.error(
        `Audit outbox record ${id} failed ${attempts} times and is parked; ` +
          `last error: ${error.slice(0, 200)}`,
      );
    }

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

  // Applies a completed edit form to its published event. Validates the
  // immutable properties, enforces the capacity floor, and returns the
  // partial refunds owed after a price drop (already-paid orders keep their
  // ticket; the difference is refunded by the caller through Stripe).
  async applyEventEdit(
    pending: PendingEventCreateRecord,
    now = currentTimestamp(),
  ): Promise<{ event: EventRecord; refunds: PriceDropRefund[] }> {
    if (!pending.edit_event_id) {
      throw new Error("This form is not an edit session.");
    }
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const event = await this.#getEvent(client, pending.edit_event_id, true);
      if (event?.status !== "published") {
        throw new EventUnavailableError();
      }

      const wasPaid = event.ticket_price_cents !== null;
      const isPaid = pending.ticket_price_cents !== null;
      if (wasPaid !== isPaid) {
        throw new Error(
          "Events cannot switch between free RSVPs and paid tickets after publishing.",
        );
      }
      if (pending.test_mode !== event.test_mode) {
        throw new Error("Stripe test mode cannot change after publishing.");
      }
      if (
        pending.announcement_channel_id &&
        pending.announcement_channel_id !== event.announcement_channel_id
      ) {
        throw new Error("The announcement channel cannot change after publishing.");
      }

      if (pending.ticket_limit !== null) {
        const admitted = isPaid
          ? await client.query(
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
              [event.id, now],
            )
          : await client.query(
              `
                SELECT COUNT(*)::integer AS count
                FROM rsvps
                WHERE event_id = $1 AND status = 'active'
              `,
              [event.id],
            );
        const count = Number((admitted.rows[0] as { count: number }).count);
        if (pending.ticket_limit < count) {
          throw new Error(
            `Capacity cannot be below the ${count} member(s) already admitted.`,
          );
        }
      }

      const updated = await client.query(
        `
          UPDATE events
          SET
            title = $1,
            location = $2,
            location_url = $3,
            announcement = $4,
            artwork_url = $5,
            artwork_name = $6,
            schedule_text = $7,
            starts_at = $8,
            ends_at = $9,
            ticket_sales_close_at = $10,
            ticket_price_cents = $11,
            ticket_limit = $12,
            edited_at = $13
          WHERE id = $14
          RETURNING *
        `,
        [
          pending.title,
          pending.location,
          pending.location_url,
          pending.announcement,
          pending.artwork_url,
          pending.artwork_name,
          pending.starts_at === null
            ? event.schedule_text
            : formatScheduleText(pending.starts_at, pending.ends_at ?? undefined),
          pending.starts_at,
          pending.ends_at,
          pending.ticket_sales_close_at,
          pending.ticket_price_cents,
          pending.ticket_limit,
          now,
          event.id,
        ],
      );

      let refunds: PriceDropRefund[] = [];
      if (isPaid && pending.ticket_price_cents !== null) {
        const newPrice = pending.ticket_price_cents;
        const owed = await client.query(
          `
            SELECT id, user_id, stripe_payment_intent_id, amount_total
            FROM ticket_orders
            WHERE event_id = $1 AND status = 'paid' AND amount_total > $2
            ORDER BY id
          `,
          [event.id, newPrice],
        );
        refunds = (
          owed.rows as {
            id: number;
            user_id: string;
            stripe_payment_intent_id: string | null;
            amount_total: number;
          }[]
        ).map((row) => ({
          orderId: row.id,
          userId: row.user_id,
          paymentIntentId: row.stripe_payment_intent_id,
          amountCents: row.amount_total - newPrice,
          newAmountTotal: newPrice,
        }));
      }

      await client.query("COMMIT");
      return { event: updated.rows[0] as EventRecord, refunds };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createCoupon(
    coupon: {
      guildId: string;
      userId: string;
      percentOff: number;
      eventId?: number;
      createdBy: string;
      expiresAt?: number;
    },
    now = currentTimestamp(),
  ): Promise<CouponRecord> {
    const result = await this.#pool.query(
      `
        INSERT INTO coupons (
          guild_id, user_id, percent_off, event_id,
          created_by, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        coupon.guildId,
        coupon.userId,
        coupon.percentOff,
        coupon.eventId ?? null,
        coupon.createdBy,
        now,
        coupon.expiresAt ?? null,
      ],
    );
    return result.rows[0] as CouponRecord;
  }

  // The member's best live coupon for this event: unredeemed, unexpired,
  // and either event-scoped or valid anywhere. Highest discount wins.
  async findBestCoupon(
    guildId: string,
    userId: string,
    eventId: number,
    now = currentTimestamp(),
  ): Promise<CouponRecord | undefined> {
    const result = await this.#pool.query(
      `
        SELECT *
        FROM coupons
        WHERE
          guild_id = $1
          AND user_id = $2
          AND redeemed_at IS NULL
          AND (expires_at IS NULL OR expires_at > $3)
          AND (event_id IS NULL OR event_id = $4)
        ORDER BY percent_off DESC, id
        LIMIT 1
      `,
      [guildId, userId, now, eventId],
    );
    return result.rows[0] as CouponRecord | undefined;
  }

  // Fulfills a 100%-off (or sub-minimum) order without Stripe: the order is
  // paid at zero, the coupon is redeemed, and the usual notification queues.
  async fulfillCouponFreeOrder(
    orderId: number,
    couponId: number,
    now = currentTimestamp(),
  ): Promise<TicketOrderRecord> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const redeemed = await client.query(
        `
          UPDATE coupons
          SET redeemed_order_id = $1, redeemed_at = $2
          WHERE id = $3 AND redeemed_at IS NULL
        `,
        [orderId, now, couponId],
      );
      if (redeemed.rowCount !== 1) {
        throw new Error("That coupon has already been used.");
      }

      const result = await client.query(
        `
          UPDATE ticket_orders
          SET status = 'paid', amount_total = 0, updated_at = $1, paid_at = $1
          WHERE id = $2 AND status = 'pending'
          RETURNING *
        `,
        [now, orderId],
      );
      const order = result.rows[0] as TicketOrderRecord | undefined;
      if (!order) {
        throw new Error("This ticket reservation is no longer active.");
      }

      await client.query(
        `
          INSERT INTO audit_outbox (
            event_id, user_id, action, detail, created_at, next_attempt_at
          ) VALUES ($1, $2, 'ticket_paid', 'Free with coupon.', $3, $4)
        `,
        [order.event_id, order.user_id, now, now],
      );

      await client.query("COMMIT");
      return order;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async setEventScheduledEventId(
    eventId: number,
    scheduledEventId: string | null,
  ): Promise<void> {
    await this.#pool.query("UPDATE events SET scheduled_event_id = $1 WHERE id = $2", [
      scheduledEventId,
      eventId,
    ]);
  }

  async listEvents(
    guildId: string,
    offset: number,
    limit: number,
  ): Promise<{ events: EventRecord[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.#pool.query(
        `
          SELECT * FROM events
          WHERE guild_id = $1 AND status <> 'discarded'
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3
        `,
        [guildId, limit, offset],
      ),
      this.#pool.query(
        "SELECT COUNT(*)::integer AS count FROM events WHERE guild_id = $1 AND status <> 'discarded'",
        [guildId],
      ),
    ]);
    return {
      events: rows.rows as EventRecord[],
      total: Number((count.rows[0] as { count: number }).count),
    };
  }

  async getEventAttendees(eventId: number): Promise<EventAttendeeRecord[]> {
    const event = await this.#getEvent(this.#pool, eventId);
    if (!event) return [];

    if (event.ticket_price_cents !== null) {
      const result = await this.#pool.query(
        `
          SELECT user_id, customer_name, customer_email, amount_total, paid_at
          FROM ticket_orders
          WHERE event_id = $1 AND status = 'paid'
          ORDER BY paid_at, id
        `,
        [eventId],
      );
      return (
        result.rows as {
          user_id: string;
          customer_name: string | null;
          customer_email: string | null;
          amount_total: number | null;
          paid_at: number | null;
        }[]
      ).map((row) => ({
        userId: row.user_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        amountTotalCents: row.amount_total,
        respondedAt: row.paid_at,
      }));
    }

    const result = await this.#pool.query(
      `
        SELECT user_id, updated_at
        FROM rsvps
        WHERE event_id = $1 AND status = 'active'
        ORDER BY updated_at, user_id
      `,
      [eventId],
    );
    return (result.rows as { user_id: string; updated_at: number }[]).map((row) => ({
      userId: row.user_id,
      customerName: null,
      customerEmail: null,
      amountTotalCents: null,
      respondedAt: row.updated_at,
    }));
  }

  // Cancels a published event: admission closes immediately, every active
  // attendee gets a DM-only notification row, and the paid orders that need
  // full Stripe refunds are returned to the caller.
  async cancelEvent(
    eventId: number,
    now = currentTimestamp(),
  ): Promise<
    | {
        event: EventRecord;
        refunds: { orderId: number; userId: string; paymentIntentId: string | null }[];
      }
    | undefined
  > {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const current = await this.#getEvent(client, eventId, true);
      if (current?.status !== "published" || typeof current.cancelled_at === "number") {
        await client.query("COMMIT");
        return undefined;
      }

      const updated = await client.query(
        `
          UPDATE events
          SET cancelled_at = $1, ticket_sales_close_at = $1
          WHERE id = $2
          RETURNING *
        `,
        [now, eventId],
      );
      const event = updated.rows[0] as EventRecord;

      const attendees =
        event.ticket_price_cents !== null
          ? await client.query(
              `
                SELECT user_id FROM ticket_orders
                WHERE event_id = $1 AND status = 'paid'
              `,
              [eventId],
            )
          : await client.query(
              "SELECT user_id FROM rsvps WHERE event_id = $1 AND status = 'active'",
              [eventId],
            );
      for (const row of attendees.rows as { user_id: string }[]) {
        await client.query(
          `
            INSERT INTO audit_outbox (
              event_id, user_id, action, created_at, next_attempt_at
            ) VALUES ($1, $2, 'event_cancelled', $3, $4)
          `,
          [eventId, row.user_id, now, now],
        );
      }

      let refunds: {
        orderId: number;
        userId: string;
        paymentIntentId: string | null;
      }[] = [];
      if (event.ticket_price_cents !== null) {
        const orders = await client.query(
          `
            SELECT id, user_id, stripe_payment_intent_id
            FROM ticket_orders
            WHERE event_id = $1 AND status = 'paid'
            ORDER BY id
          `,
          [eventId],
        );
        refunds = (
          orders.rows as {
            id: number;
            user_id: string;
            stripe_payment_intent_id: string | null;
          }[]
        ).map((row) => ({
          orderId: row.id,
          userId: row.user_id,
          paymentIntentId: row.stripe_payment_intent_id,
        }));
      }

      await client.query("COMMIT");
      return { event, refunds };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // Permanently removes an event and every dependent row. Does not touch
  // Discord messages or Stripe; cancel first if refunds are needed.
  async deleteEventCascade(eventId: number): Promise<boolean> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM audit_outbox WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM coupons WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM ticket_orders WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM rsvps WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM rsvp_history WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM event_interest WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM event_reminders WHERE event_id = $1", [eventId]);
      const result = await client.query("DELETE FROM events WHERE id = $1", [eventId]);
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // How many members currently hold a place: active RSVPs for free events,
  // paid or actively-reserved orders for ticketed events.
  async getEventAttendance(
    eventId: number,
    now = currentTimestamp(),
  ): Promise<{ going: number }> {
    const event = await this.#getEvent(this.#pool, eventId);
    if (!event) return { going: 0 };

    const result =
      event.ticket_price_cents !== null
        ? await this.#pool.query(
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
          )
        : await this.#pool.query(
            `
              SELECT COUNT(*)::integer AS count
              FROM rsvps
              WHERE event_id = $1 AND status = 'active'
            `,
            [eventId],
          );
    return { going: Number((result.rows[0] as { count: number }).count) };
  }

  async previewPriceDropRefunds(
    eventId: number,
    newPriceCents: number,
  ): Promise<{ count: number; totalCents: number }> {
    const result = await this.#pool.query(
      `
        SELECT amount_total
        FROM ticket_orders
        WHERE event_id = $1 AND status = 'paid' AND amount_total > $2
      `,
      [eventId, newPriceCents],
    );
    const rows = result.rows as { amount_total: number }[];
    return {
      count: rows.length,
      totalCents: rows.reduce(
        (total, row) => total + (Number(row.amount_total) - newPriceCents),
        0,
      ),
    };
  }

  // Marks a partial price-difference refund as settled and queues the
  // member's notification. Only called after Stripe accepted the refund.
  async finalizePriceAdjustment(
    orderId: number,
    newAmountTotal: number,
    detail: string,
    now = currentTimestamp(),
  ): Promise<void> {
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          UPDATE ticket_orders
          SET amount_total = $1, updated_at = $2
          WHERE id = $3
          RETURNING event_id, user_id
        `,
        [newAmountTotal, now, orderId],
      );
      const order = result.rows[0] as { event_id: number; user_id: string } | undefined;
      if (order) {
        await client.query(
          `
            INSERT INTO audit_outbox (
              event_id, user_id, action, detail, created_at, next_attempt_at
            ) VALUES ($1, $2, 'ticket_price_adjusted', $3, $4, $5)
          `,
          [order.event_id, order.user_id, detail, now, now],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getGuildSettings(guildId: string): Promise<GuildSettingsRecord | undefined> {
    const result = await this.#pool.query(
      "SELECT * FROM guild_settings WHERE guild_id = $1",
      [guildId],
    );
    return result.rows[0] as GuildSettingsRecord | undefined;
  }

  async upsertGuildSettings(
    guildId: string,
    update: GuildSettingsUpdate,
    now = currentTimestamp(),
  ): Promise<GuildSettingsRecord> {
    const result = await this.#pool.query(
      `
        INSERT INTO guild_settings (
          guild_id,
          rsvp_log_channel_id,
          verification_message_url,
          connected_role_id,
          exempt_role_id,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (guild_id) DO UPDATE SET
          rsvp_log_channel_id = $2,
          verification_message_url = $3,
          connected_role_id = $4,
          exempt_role_id = $5,
          updated_at = $6
        RETURNING *
      `,
      [
        guildId,
        update.rsvpLogChannelId ?? null,
        update.verificationMessageUrl ?? null,
        update.connectedRoleId ?? null,
        update.exemptRoleId ?? null,
        now,
      ],
    );
    return result.rows[0] as GuildSettingsRecord;
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
