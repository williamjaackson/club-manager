function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? "3000");

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("HEALTH_PORT must be an integer between 1 and 65535");
  }

  return parsed;
}

function snowflake(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;

  if (!value || !/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a valid Discord ID`);
  }

  return value;
}

export const config = {
  token: required("DISCORD_TOKEN"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  healthPort: port(process.env.HEALTH_PORT),
  databasePath: process.env.DATABASE_PATH?.trim() || "/data/bot.sqlite",
  rsvpLogChannelId: snowflake(
    "RSVP_LOG_CHANNEL_ID",
    "1530755171645132921",
  ),
};
