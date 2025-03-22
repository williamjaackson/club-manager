import { sql } from "./lib/database";
import { redisClient } from "./lib/redis";
import { Client } from "discord.js";
import config from "../config.json";

export async function redisEventHandler(client: Client) {
  redisClient.subscribe("member:join", async (message) => {
    const { campus_user_id, club_id } = JSON.parse(message);

    const clubArea = club_id === "24236" ? "Brisbane/Online" : "Gold Coast";

    const [discordUserRecord] = await sql`
      SELECT * FROM discord_users
      JOIN campus_users ON discord_users.student_number = campus_users.student_number
      WHERE campus_users.campus_user_id = ${campus_user_id}
    `;

    const [campusUserRecord] = await sql`
      SELECT * FROM campus_users
      WHERE campus_user_id = ${campus_user_id}
    `;

    if (!discordUserRecord) {
      console.log("Campus user does not have a discord account.");
      return;
    }

    const discordUser = await client.users.fetch(
      discordUserRecord.discord_user_id
    );

    if (discordUser.id !== "817515772317925407") {
      console.log("TESTING, WILL NOT DM");
      return;
    }

    await discordUser.send(`**Thank you for joining the Griffith ICT Club (${clubArea}) on CampusGroups!**
You've been given club-member access on the discord, and have now been connected as:
\`\`\`
${campusUserRecord.first_name} ${campusUserRecord.last_name}
\`\`\`
-# This will only ever be viewable by verified students, or staff members.`);

    const guild = await client.guilds.fetch(config.guildId);
    const role = await guild.roles.fetch(config.roleId);

    if (!guild || !role) {
      console.log("Guild or role not found");
      return;
    }

    const discordMember = await guild.members.fetch(discordUser.id);

    await discordMember.roles.add(role);

    console.log(campus_user_id, club_id);
  });

  redisClient.subscribe("member:leave", async (message) => {
    // when the user leaves, check if the old member has the role, if so, remove it.
    const { campus_user_id, club_id } = JSON.parse(message);

    // const guild = await client.guilds.fetch(config.guildId);
    // const role = await guild.roles.fetch(config.roleId);

    // if (!guild || !role) {
    //   console.log("Guild or role not found");
    //   return;
    // const { campus_user_id, club_id } = JSON.parse(message);
    // console.log(campus_user_id, club_id);
  });
}
