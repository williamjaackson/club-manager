import { Client, Guild, GuildMember, Role } from "discord.js";
import { sql } from "./lib/database";
import config from "../config.json";

export async function processLeave(member: GuildMember) {
  const role = await member.guild.roles.fetch(config.roleId);
  if (!role) throw Error("Role not found.");

  await member.roles.remove(role);
  console.log("Removed role from member", member.id);
}

export async function processJoin(member: GuildMember) {
  const role = await member.guild.roles.fetch(config.roleId);
  if (!role) throw Error("Role not found.");

  const [campusUserRecord] = await sql`
    SELECT * FROM campus_users
    JOIN discord_users ON campus_users.student_number = discord_users.student_number
    WHERE discord_users.discord_user_id = ${member.id}
  `;

  await member.send(`**Thank you for joining the Griffith ICT Club on CampusGroups!**
You've been given club-member access on the discord, and have now been connected as:
\`\`\`
${campusUserRecord.first_name} ${campusUserRecord.last_name}
\`\`\`
-# This will only ever be viewable by verified students, or staff members.`);

  await member.roles.add(role);
  console.log("Added role to member", member.id);
}

// export async function updateClubMember(
//   prevMember: GuildMember | undefined,
//   newMember: GuildMember | undefined
// ) {
//   if (prevMember) await processLeave(prevMember);
//   if (newMember) await processJoin(newMember);
// }
