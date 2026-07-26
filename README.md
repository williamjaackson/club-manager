# Discord bot Docker Compose template

A small TypeScript bot using `discord.js`, packaged for development and
production with Docker Compose. It includes a `/ping` command, automatic slash
command registration, a container health check, and graceful shutdown.

## Set up Discord

1. Create an application in the
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Open **Bot**, create the bot, and reset/copy its token.
3. Open **OAuth2 → URL Generator**. Select the `bot` and
   `applications.commands` scopes, then select the permissions your bot needs.
4. Open the generated URL and invite the bot to your server.
5. Enable Discord's Developer Mode, right-click your server, and copy its ID.

## Run with Docker Compose

```sh
cp .env.example .env
```

Fill in `DISCORD_TOKEN` and `DISCORD_GUILD_ID`, then run:

```sh
docker compose up --build -d
docker compose logs -f bot
```

Try `/ping` in Discord. Stop the bot with:

```sh
docker compose down
```

Never commit `.env` or share the bot token. If a token is exposed, reset it in
the Discord Developer Portal.

## Development

The development profile watches `src/` and restarts on changes:

```sh
docker compose --profile dev run --rm bot-dev
```

For local development without Docker (using
[pnpm](https://pnpm.io/installation)):

```sh
pnpm install
pnpm run dev
```

## Add commands

Add each command's JSON definition to `commandDefinitions` in
`src/commands.ts`, then implement its matching case in `handleCommand`.
Commands are synchronized whenever the bot starts.

When `DISCORD_GUILD_ID` is set, commands are scoped to that server and update
quickly. Remove it for global commands once you are ready to deploy broadly.
