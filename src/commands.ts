import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
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
      subcommand.setName("create").setDescription("Create a new event announcement"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List events, newest first, with management actions"),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure Club Manager for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new ContextMenuCommandBuilder()
    .setName("Edit Event")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new ContextMenuCommandBuilder()
    .setName("Close Event")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
