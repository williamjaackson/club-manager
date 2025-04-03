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
import { supabase } from "../lib/database";

export const data = new SlashCommandBuilder()
  .setName("sync-roles")
  .setDescription("Sync roles from the campus groups")
  .setContexts([InteractionContextType.Guild])
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: "This command is currently disabled.",
    ephemeral: true,
  });
  // await interaction.deferReply({
  //   withResponse: true,
  //   flags: MessageFlags.Ephemeral,
  // });

  // const discordMembers = await interaction.guild!.members.fetch();
  // const campusMembers = await sql`
  //   SELECT * FROM campus_members
  //   JOIN campus_users ON campus_users.campus_user_id = campus_members.campus_user_id
  //   JOIN discord_users ON discord_users.student_number = campus_users.student_number
  // `;

  // const discordMembersMap = new Map(
  //   discordMembers.map((member) => [member.id, member])
  // );

  // const campusMembersMap = new Map(
  //   campusMembers.map((member) => [member.discord_user_id, member])
  // );

  // async function syncRoles(
  //   member: GuildMember | undefined,
  //   campusMember: Record<string, any> | undefined
  // ) {
  //   if (!member) return;
  //   const hasRole = member.roles.cache.has(config.roleId);

  //   if (!campusMember && !hasRole) return;
  //   if (campusMember && hasRole) return;

  //   if (!hasRole) {
  //     await member.roles.add(config.roleId);
  //     return "Added role";
  //   } else {
  //     await member.roles.remove(config.roleId);
  //     return "Removed role";
  //   }
  // }

  // const results = new Map<string, string>();
  // for (const [discordId, discordMember] of discordMembersMap.entries()) {
  //   const campusMember = campusMembersMap.get(discordId);

  //   const result = await syncRoles(discordMember, campusMember);
  //   if (result) results.set(discordId, result);
  // }

  // await interaction.editReply({
  //   content: `Changed roles for ${results.size} members.`,
  //   files: [
  //     new AttachmentBuilder(
  //       Buffer.from(JSON.stringify(Object.fromEntries(results), null, 2)),
  //       {
  //         name: "results.json",
  //       }
  //     ),
  //   ],
  // });
}
