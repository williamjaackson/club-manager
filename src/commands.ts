import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("event")
    .setDescription("Create and manage club events")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a new event announcement"),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Reply to an event announcement with a reminder")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("announcement")
        .setDescription("Paste the event announcement link")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Reminder text; mentions such as @everyone are allowed")
        .setMaxLength(1_800)
        .setRequired(true),
    )
    .toJSON(),
];
