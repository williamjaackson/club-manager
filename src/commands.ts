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
        .setDescription("Create a new event announcement")
        .addAttachmentOption((option) =>
          option
            .setName("artwork")
            .setDescription("Optional image shown below the announcement")
            .setRequired(false),
        )
        .addNumberOption((option) =>
          option
            .setName("ticket_price")
            .setDescription("AUD ticket price; omit for an RSVP-only event")
            .setMinValue(0.5)
            .setMaxValue(100_000)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName("ticket_limit")
            .setDescription("Maximum paid tickets; omit for unlimited")
            .setMinValue(1)
            .setMaxValue(100_000)
            .setRequired(false),
        ),
    )
    .toJSON(),
];
