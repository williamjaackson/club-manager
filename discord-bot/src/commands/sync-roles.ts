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

  const discordMembers = await interaction.guild!.members.fetch();
  const campusMembers = await sql`
    SELECT * FROM campus_members
    JOIN campus_users ON campus_users.campus_user_id = campus_members.campus_user_id
    JOIN discord_users ON discord_users.student_number = campus_users.student_number
  `;

  const discordMembersMap = new Map(
    discordMembers.map((member) => [member.id, member])
  );

  const campusMembersMap = new Map(
    campusMembers.map((member) => [member.discord_user_id, member])
  );

  async function syncRoles(
    member: GuildMember | undefined,
    campusMember: Record<string, any> | undefined
  ) {
    if (!member) return;
    const hasRole = member.roles.cache.has(config.roleId);

    if (!campusMember && !hasRole) return;
    if (campusMember && hasRole) return;

    if (!hasRole) {
      await member.roles.add(config.roleId);
      return "Added role";
    } else {
      await member.roles.remove(config.roleId);
      return "Removed role";
    }
  }

  const results = new Map<string, string>();
  // for testing, only use this discord member: 817515772317925407, 874415216186757181
  // const testDiscordMembers = ["817515772317925407", "874415216186757181"];
  // const testDiscordMembersMap = new Map(
  // testDiscordMembers.map((id) => [id, discordMembersMap.get(id)])
  // );
  for (const [discordId, discordMember] of discordMembersMap.entries()) {
    // if (!testDiscordMembers.includes(discordId)) continue;

    const campusMember = campusMembersMap.get(discordId);
    // if () continue;

    const result = await syncRoles(discordMember, campusMember);
    if (result) results.set(discordId, result);
  }

  await interaction.editReply({
    content: `Changed roles for ${results.size} members.`,
    files: [
      new AttachmentBuilder(
        Buffer.from(JSON.stringify(Object.fromEntries(results), null, 2)),
        {
          name: "results.json",
        }
      ),
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
