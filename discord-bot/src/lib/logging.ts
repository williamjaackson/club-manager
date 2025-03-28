import { ChannelType, Client } from "discord.js";
import config from "../../config.json";

export async function log(client: Client, message: string) {
  const channel = await client.channels.fetch(config.logChannel);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  await channel.send(message);
}
