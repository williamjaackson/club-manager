# Club Manager

A Discord-native event announcement and RSVP bot for Griffith ICT Club.

Administrators create an event with `/event create`, review a private preview,
and publish it to a selected channel. Members RSVP through a button on the
announcement. RSVP data is stored in Neon PostgreSQL and mirrored to a private
audit channel.

## Current event flow

### Administrators

Run:

```text
/event create artwork:<optional image>
```

The modal collects the announcement channel, event name, schedule, location,
and complete announcement. The resulting preview is visible only to the
administrator and must be explicitly published or discarded.

The command is hidden from non-administrators by its Discord command
permissions. Every create, publish, and discard interaction also checks the
member's `Administrator` permission at runtime.

### Members

The published announcement has an **RSVP** button. Selecting it opens a private
summary containing only the event name, schedule, location, and current
first-event pricing message. It does not repeat the full announcement.

Confirmations and cancellations are idempotent: repeated button presses do not
create duplicate history or audit messages.

### RSVP audit

Each real state change creates an immutable audit message:

```text
@member RSVP’d for Event Name.
@member cancelled their RSVP for Event Name.
```

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
RSVP_LOG_CHANNEL_ID=1530755171645132921
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
HEALTH_PORT=3000
```

Never commit `.env`. Reset the token in the
[Discord Developer Portal](https://discord.com/developers/applications) if it
is exposed.

The bot requires these permissions in announcement and audit channels:

- View Channel
- Send Messages
- Embed Links
- Attach Files

## Run with Docker Compose

```sh
docker compose up --build -d
docker compose logs -f bot
```

Events and RSVP state are stored in Neon PostgreSQL and survive container
replacement and VPS restarts.

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
pnpm run check
pnpm test
pnpm run dev
```

Or use the development service:

```sh
docker compose --profile dev run --rm bot-dev
```

## Storage

The Neon PostgreSQL database contains:

- Event drafts and published message references
- Current RSVP state
- Immutable RSVP/cancellation history
- Pending and delivered audit notifications
- Open event-creation forms, with a 15-minute expiry

Pricing is presentation-only in this version. Every member currently sees the
$5 price reduced to $0 as their first-event offer; there is no eligibility or
payment processing yet.
