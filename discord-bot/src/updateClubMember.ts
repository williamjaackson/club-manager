import { Client, Guild, GuildMember, Role } from "discord.js";
import { sql } from "./lib/database";
import config from "../config.json";

export async function processLeave(member: GuildMember) {
  const role = await member.guild.roles.fetch(config.roleId);
  if (!role) throw Error("Role not found.");

  await member.roles.remove(role);
}

export async function processJoin(member: GuildMember) {
  const role = await member.guild.roles.fetch(config.roleId);
  if (!role) throw Error("Role not found.");

  const [campusUserRecord] = await sql`
    SELECT * FROM campus_users
    JOIN discord_users ON campus_users.student_number = discord_users.student_number
    WHERE discord_users.discord_user_id = ${member.id}
  `;

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
