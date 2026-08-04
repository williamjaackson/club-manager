import {
  ChannelType,
  type Client,
  type NewsChannel,
  type TextChannel,
  type Webhook,
  type WebhookType,
} from "discord.js";

export const eventWebhookName = "Club Manager Event Announcements";

export type EventChannel = TextChannel | NewsChannel;

export async function fetchEventChannel(
  client: Client,
  channelId: string,
): Promise<EventChannel | undefined> {
  const channel = await client.channels.fetch(channelId);
  return channel?.type === ChannelType.GuildText ||
    channel?.type === ChannelType.GuildAnnouncement
    ? channel
    : undefined;
}

export async function findOrCreateEventWebhook(
  channel: EventChannel,
  botUserId: string,
): Promise<Webhook<WebhookType.Incoming>> {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find(
    (candidate) =>
      candidate.name === eventWebhookName &&
      candidate.owner?.id === botUserId &&
      candidate.isIncoming() &&
      Boolean(candidate.token),
  );

  if (existing?.isIncoming()) return existing;

  return channel.createWebhook({
    name: eventWebhookName,
    reason: "Publish event announcements as the command runner",
  });
}
