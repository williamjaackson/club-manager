import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online")
    .toJSON(),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  switch (interaction.commandName) {
    case "ping":
      await interaction.reply({
        content: `Pong! ${interaction.client.ws.ping}ms`,
        ephemeral: true,
      });
      return;
    default:
      await interaction.reply({
        content: "That command is not implemented.",
        ephemeral: true,
      });
  }
}
