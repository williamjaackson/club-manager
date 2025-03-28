import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import config from "../../config.json";
import { sql } from "../lib/database";

export const data = new SlashCommandBuilder()
  .setName("sync-roles")
  .setDescription("Sync roles from the campus groups")
  .setContexts([InteractionContextType.Guild])
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({
    withResponse: true,
    flags: MessageFlags.Ephemeral,
  });

  const members = await interaction.guild!.members.fetch();

  async function syncRoles(member: GuildMember) {
    const hasRole = member.roles.cache.has(config.roleId);

    // check if the user is a member on campus groups
    const [memberRecord] = await sql`
      SELECT * FROM campus_members
      JOIN campus_users ON campus_users.campus_user_id = campus_members.campus_user_id
      JOIN discord_users ON discord_users.student_number = campus_users.student_number
      WHERE discord_users.discord_user_id = ${member.id}
    `;

    if (!memberRecord && !hasRole) return;
    if (memberRecord && hasRole) return;

    if (!hasRole) {
      await member.roles.add(config.roleId);
    } else {
      await member.roles.remove(config.roleId);
    }

    return member.id;
  }

  const results = [];
  // first 2 members for testing
  const limitedMembers = Array.from(members.values()).slice(0, 2);
  for (const member of limitedMembers) {
    const result = await syncRoles(member);
    if (result) results.push(result);
  }

  await interaction.editReply({
    content: `Changed roles for ${results.length} members.`,
    files: [
      new AttachmentBuilder(Buffer.from(JSON.stringify(results, null, 2)), {
        name: "results.json",
      }),
    ],
  });

  // const channel: TextChannel = interaction.options.getChannel("channel", true);

  // const btn_link = new ButtonBuilder()
  //   .setCustomId("flow:connect:0")
  //   .setLabel("Connect sNumber")
  //   .setEmoji(config.emoji)
  //   .setStyle(ButtonStyle.Secondary);

  // const btn_exempt = new ButtonBuilder()
  //   .setCustomId("flow:exempt:0")
  //   .setLabel("Request Exemption")
  //   .setStyle(ButtonStyle.Danger);

  // const row = new ActionRowBuilder().addComponents(btn_link, btn_exempt);

  // const embed = new EmbedBuilder()
  //   .setTitle("Connect your Griffith sNumber")
  //   .setDescription(
  //     "To access the rest of this server,\nYou need to connect your __Griffith sNumber__.\nClick the button below to get started."
  //   )
  //   .addFields({
  //     name: "Don't Have an sNumber?",
  //     value:
  //       "You can apply for an exemption if:\n" +
  //       "• You are a student of a different university,\n" +
  //       "• You are a past student of Griffith University,\n" +
  //       "• You need access to this server for another reason.",
  //   })
  //   .setThumbnail(interaction.client.user?.displayAvatarURL())
  //   .setColor(0x2b2d31)
  //   .setFooter({
  //     text: "Griffith Connect • Powered by Griffith ICT Club <https://www.griffithict.com/>",
  //   });

  // await channel.send({
  //   embeds: [embed],
  //   components: [row as ActionRowBuilder<ButtonBuilder>],
  // });

  // await interaction.editReply({
  //   content: "Setup complete!",
  // });
}
