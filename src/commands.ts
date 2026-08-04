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
    .setName("ticket")
    .setDescription("Manage held tickets for paid events")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("hold")
        .setDescription("Hold a seat for a member so nobody else can take it")
        .addUserOption((option) =>
          option
            .setName("member")
            .setDescription("Member the seat is held for")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("event")
            .setDescription("Paste the event announcement link")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("for").setDescription("Hold duration such as 30m, 12h, or 2d"),
        )
        .addStringOption((option) =>
          option
            .setName("until")
            .setDescription("Hold until YYYY-MM-DD HH:mm Brisbane time"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("release")
        .setDescription("Release a held seat")
        .addUserOption((option) =>
          option
            .setName("member")
            .setDescription("Member whose held seat is released")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("event")
            .setDescription("Paste the event announcement link")
            .setRequired(true),
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("coupon")
    .setDescription("Give a member a discount coupon for paid events")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("give")
        .setDescription("DM a member a percent-off coupon")
        .addUserOption((option) =>
          option
            .setName("member")
            .setDescription("Member who receives the coupon")
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("percent")
            .setDescription("Discount percentage (1-100)")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("event")
            .setDescription("Announcement link to limit the coupon to one event"),
        )
        .addStringOption((option) =>
          option
            .setName("expires")
            .setDescription("Expiry as YYYY-MM-DD HH:mm Brisbane time"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List coupons, newest first, with management actions"),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("reimbursement")
    .setDescription("Submit and manage receipt reimbursements")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand.setName("create").setDescription("Submit a receipt for reimbursement"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("config")
        .setDescription("Set the payout details used for your reimbursements"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List reimbursements; without options it shows your own")
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("Filter every member's reimbursements by status")
            .addChoices(
              { name: "pending", value: "pending" },
              { name: "submitted", value: "submitted" },
              { name: "paid", value: "paid" },
            ),
        )
        .addUserOption((option) =>
          option
            .setName("member")
            .setDescription("Show a specific member's reimbursements"),
        ),
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
