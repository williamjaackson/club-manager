function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? "3000");

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("HTTP_PORT must be an integer between 1 and 65535");
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

function publicUrl(value: string): string {
  const parsed = new URL(value);

  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new Error("PUBLIC_BASE_URL must use http or https");
  }

  return parsed.toString().replace(/\/$/, "");
}

export const config = {
  token: required("DISCORD_TOKEN"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  // HEALTH_PORT is the legacy name from when this listener only served
  // health checks; it now also serves the Stripe webhook endpoints.
  httpPort: port(process.env.HTTP_PORT ?? process.env.HEALTH_PORT),
  databaseUrl: required("DATABASE_URL"),
  publicBaseUrl: publicUrl(required("PUBLIC_BASE_URL")),
  stripeSecretKey: required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: required("STRIPE_WEBHOOK_SECRET"),
  stripeTestSecretKey: optional("STRIPE_TEST_SECRET_KEY"),
  stripeTestWebhookSecret: optional("STRIPE_TEST_WEBHOOK_SECRET"),
  rsvpLogChannelId: snowflake("RSVP_LOG_CHANNEL_ID", "1530755171645132921"),
};
