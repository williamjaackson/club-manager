# Club Manager

A Discord-native event announcement, RSVP, and Stripe ticketing bot for
Griffith ICT Club.

Administrators create an event with `/event create`, review a private preview,
and publish it to a selected channel. Free events accept RSVPs; paid events sell
capacity-limited tickets through Stripe Checkout. RSVP and ticket data are
stored in Neon PostgreSQL;
RSVP changes are also mirrored to a private audit channel.

## Current event flow

### Administrators

Run:

```text
/event create
```

The command opens the event details form, then a persistent private **draft
panel** that previews the event as it takes shape. Edit any section — details,
schedule, or admission — in any order through its button; each form is
pre-filled with the current values, and parsed times are echoed back
immediately so typos are caught before publishing. **Create draft** (enabled
once the details and start time exist) produces the final preview, which must
be explicitly published or discarded; **Discard form** abandons the draft.
The panel edits itself in place, so the wizard never stacks messages. Forms
survive bot restarts and expire after 15 minutes of inactivity.

Times are entered in Brisbane time. Start time is required, while finish time
is optional and may be on a later date for a multi-day event. Published times
use Discord timestamps, which each member sees in their own local time.

Leave ticket price blank for an RSVP-only event. When a price is present, the
event post shows it and a **Buy ticket** button. Optional capacity limits either
completed free RSVPs or reserved/paid tickets. Ticket prices currently use AUD.
The optional ticket close time can close paid sales before the event finishes
and can only be used with a ticket price. Without it, ticket sales close at the
finish time when one is set.

Select **Stripe test event** with a ticket price to exercise the complete
Stripe sandbox Checkout and ticket-fulfillment flow. Test events are clearly
labelled and never use the primary Stripe key or charge real money.

The command is hidden from non-administrators by its Discord command
permissions. Every create, publish, and discard interaction also checks the
member's `Administrator` permission at runtime.

Run `/reminder announcement:<event message link> message:<your text>` to reply
to a published announcement. The reminder supports mentions such as `@everyone`
and repeats the event's trusted RSVP or ticket button. Closed admission buttons
are shown disabled.

Right-click a published event announcement or one of its reminders and select
**Apps → Edit Event** to change it after publishing. The same draft panel used
for creation opens pre-filled; saving updates the announcement in place and
adds a small "Edited" note. Events cannot switch between free and paid after
publishing, test mode is locked, and capacity cannot drop below the members
already admitted. Lowering a paid event's price asks for confirmation, then
refunds every earlier buyer the difference through Stripe automatically —
ticket holders keep their tickets and are notified by DM. (Stripe does not
return the original processing fees when refunding.)

Run `/event list` to browse every event, newest first, five per page. Pick an
event from the menu to see its status and live count, list its attendees or
ticket holders, export them as CSV (including Stripe names and emails for paid
tickets), cancel it, or delete it. **Cancel event** closes admission, updates
the announcement, DMs every attendee, and issues full Stripe refunds for paid
tickets after an explicit confirmation that shows the total being refunded.
**Delete from database** permanently removes the event and all of its records
after a confirmation — it never refunds, so cancel first when money is
involved.

Right-click a published event announcement or one of its reminders and select
**Apps → Close Event** to stop admission immediately. The administrator-only
message command closes free RSVPs and paid ticket sales, updates the original
announcement's close time, and disables admission buttons on the announcement
and recorded reminders. Buttons that cannot be edited are still refused by the
controller and database.

### Members

Free-event announcements have an **RSVP** button. Selecting it opens a private
summary containing the schedule and location. Paid events instead have a
**Buy ticket** button; they do not accept RSVPs. Buying creates a private,
approximately 30-minute reservation and links the member to Stripe-hosted
Checkout. One Discord member can hold one paid ticket for an event. Selecting
the button after purchase shows the existing ticket confirmation instead of
charging again.

RSVP interactions stop at the event finish time when one is set. New ticket
Checkout links stop at the optional ticket close time, or at finish time when
no earlier close is set. Events without either deadline remain open. The
context-menu action can close either admission type early. The controller and
database both enforce these deadlines, manual closures, and capacities,
including for buttons copied onto reminders.

Stripe's signed webhook is the source of truth for payment fulfillment. The
success redirect never creates a ticket. Checkout creation and webhook
fulfillment are both idempotent, and a short webhook grace period prevents an
expiring reservation from reallocating capacity before a delayed webhook is
processed. A full Stripe refund automatically revokes the ticket and releases
its capacity; a partial refund leaves the ticket valid.

Confirmations and cancellations are idempotent: repeated button presses do not
create duplicate history or audit messages.

### RSVP audit

Each real state change creates an immutable audit message:

```text
@member RSVP’d for Event Name.
@member cancelled their RSVP for Event Name.
@member bought a ticket for Event Name.
@member showed interest in Event Name.
@member showed ticket interest in Event Name.
```

Paid-ticket confirmations are also sent to the buyer as a direct message.

The first RSVP or ticket-button click by each member also logs that they showed
interest, even if they do not verify, confirm, or finish Checkout.

The message also links to the original announcement. Neon is the source of
truth. An outbox retries audit messages when Discord or the configured channel
is temporarily unavailable.

## Configuration

Copy the example and fill in your Discord application details:

```sh
cp .env.example .env
```

```dotenv
DISCORD_TOKEN=replace-me
DISCORD_GUILD_ID=replace-me
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
PUBLIC_BASE_URL=https://club.example.com
STRIPE_SECRET_KEY=sk_test_replace-me
STRIPE_WEBHOOK_SECRET=whsec_replace-me
STRIPE_TEST_SECRET_KEY=sk_test_replace-me
STRIPE_TEST_WEBHOOK_SECRET=whsec_replace-me
HTTP_PORT=3000
```

Per-guild settings — the RSVP log channel, verification roles, and the
verification message link — are configured in Discord with the
administrator-only `/config` command, which opens a pre-filled form and
stores the values in the database. The environment variables
`RSVP_LOG_CHANNEL_ID`, `VERIFICATION_MESSAGE_URL`,
`STUDENT_CONNECTION_ROLE_ID`, and `STUDENT_NUMBER_EXEMPT_ROLE_ID` still act
as fallbacks for guilds that have never run `/config`. When no verification
roles are configured at all, events accept responses from every member.

Never commit `.env`. Reset the token in the
[Discord Developer Portal](https://discord.com/developers/applications) if it
is exposed.

The bot requires these permissions in announcement and audit channels:

- View Channel
- Send Messages
- Read Message History
- Embed Links
- Attach Files
- Manage Webhooks (announcement channels only)
- Mention Everyone (only when `/reminder` should ping `@everyone`)

Published announcements are sent through a bot-owned webhook using the
publishing administrator's server display name and profile picture. The bot
reuses its event webhook in each announcement channel and creates it on the
first publish when needed.

## Stripe setup

1. Set `STRIPE_SECRET_KEY` to the secret key from the Stripe Dashboard.
2. Proxy `/stripe/` from `PUBLIC_BASE_URL` to the bot's loopback listener at
   `127.0.0.1:3001` through HTTPS. (Compose maps host port 3001 to the
   container's `HEALTH_PORT`, which defaults to 3000 — the `stripe listen`
   example below talks to the bot directly, so it uses 3000.)
3. Add a Stripe webhook endpoint at
   `https://your-public-host/stripe/webhook`.
4. Subscribe it to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, and `charge.refunded`.
5. Put that endpoint's `whsec_...` signing secret in
   `STRIPE_WEBHOOK_SECRET`.

To enable `test_event:true` alongside live sales:

1. Put a Stripe sandbox secret key in `STRIPE_TEST_SECRET_KEY`.
2. In Stripe's test mode, add
   `https://your-public-host/stripe/test-webhook` as a separate endpoint.
3. Subscribe it to the same three events listed above.
4. Put its separate signing secret in `STRIPE_TEST_WEBHOOK_SECRET` and restart
   the bot.

For local webhook testing, run the bot and use the Stripe CLI:

```sh
stripe listen --forward-to localhost:3000/stripe/webhook
```

Use the signing secret printed by `stripe listen` and Stripe's test card
`4242 4242 4242 4242`. The Checkout success and cancel pages are also served
by the bot under `/stripe/`.

Stripe Dashboard settings control the enabled payment methods. Tax treatment
and the club's refund policy still need to be configured for its operational
requirements.

## Run with Docker Compose

```sh
docker compose up --build -d
docker compose logs -f bot
```

Events, RSVPs, and ticket state are stored in Neon PostgreSQL and survive
container replacement and VPS restarts.

Stop the bot with:

```sh
docker compose down
```

## Development

Requirements:

- Node.js 24 or newer
- pnpm 11

```sh
pnpm install
pnpm run db:setup
pnpm run lint
pnpm run check
pnpm test
pnpm run dev
```

Linting and formatting use [Biome](https://biomejs.dev); run
`pnpm run format` to apply fixes. CI runs lint, type-check, and tests on
every pull request and again before every deploy.

Deploys run from GitHub Actions over SSH. Run
`./scripts/setup-deploy-user.sh` once to create a dedicated `deploy` user on
the VPS, pin its host key, and rotate the Actions secrets away from root.

Or use the development service:

```sh
docker compose --profile dev run --rm bot-dev
```

## Storage

The Neon PostgreSQL database contains:

- Event drafts and published message references
- Structured start, optional finish, and optional ticket-close times
- Current RSVP state
- Immutable RSVP/cancellation history
- Idempotent RSVP and ticket interest records
- Reminder message references for trusted copied buttons
- Pending and delivered audit notifications
- Persistent multi-step event-creation forms, with a 15-minute expiry
- RSVP and ticket prices/capacities
- Pending Checkout reservations and fulfilled paid tickets
- Stripe Checkout, PaymentIntent, customer, and receipt-reconciliation fields
