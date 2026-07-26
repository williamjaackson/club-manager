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

export const config = {
  token: required("DISCORD_TOKEN"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  healthPort: port(process.env.HEALTH_PORT),
};
