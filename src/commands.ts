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
        .addStringOption((option) =>
          option
            .setName("start_time")
            .setDescription("Start in Brisbane time: YYYY-MM-DD HH:mm")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("finish_time")
            .setDescription("Finish in Brisbane time: YYYY-MM-DD HH:mm")
            .setRequired(true),
        )
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
        )
        .addBooleanOption((option) =>
          option
            .setName("test_event")
            .setDescription("Use Stripe test mode; no real money is charged")
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("ticket_close_time")
            .setDescription("Optional sales close: YYYY-MM-DD HH:mm Brisbane time")
            .setRequired(false),
        ),
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
