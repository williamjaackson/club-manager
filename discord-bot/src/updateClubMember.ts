import { Client, Guild, GuildMember, Role } from "discord.js";
import { supabase } from "./lib/database";
import config from "../config.json";

export async function processLeave(member: GuildMember) {
  const role = await member.guild.roles.fetch(config.roleId);
  if (!role) throw Error("Role not found.");

  await member.roles.remove(role);
}

export async function processJoin(member: GuildMember) {
  const role = await member.guild.roles.fetch(config.roleId);
  if (!role) throw Error("Role not found.");

  const { data: discordUserRecord } = await supabase
    .from("discord_users")
    .select("*")
    .eq("discord_user_id", member.id)
    .single();

  const { data: campusUserRecord } = await supabase
    .from("campus_users")
    .select("*")
    .eq("student_number", discordUserRecord.student_number)
    .single();

  // check if the user already has the connected role
  if (!member.roles.cache.has(config.roleId)) {
    // only send the message if the user is newly getting connected
    await member
      .send(
        `**Thank you for joining the Griffith ICT Club on CampusGroups!**
You've been given club-member access on the discord, and have now been connected as:
\`\`\`
${campusUserRecord.first_name} ${campusUserRecord.last_name}
\`\`\`
-# This will only ever be viewable by verified students, or staff members.`
      )
      .catch(() => {});
  }

  await member.roles.add(role);
}

// export async function updateClubMember(
//   prevMember: GuildMember | undefined,
//   newMember: GuildMember | undefined
// ) {
//   if (prevMember) await processLeave(prevMember);
//   if (newMember) await processJoin(newMember);
// }
