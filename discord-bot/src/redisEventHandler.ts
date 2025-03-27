import { sql } from "./lib/database";
import { redisClient } from "./lib/redis";
import { Client } from "discord.js";
import config from "../config.json";
import { processJoin, processLeave } from "./updateClubMember";

export async function redisEventHandler(client: Client) {
  redisClient.subscribe("member:join", async (message) => {
    const { campus_user_id, club_id } = JSON.parse(message);

    const [discordUserRecord] = await sql`
      SELECT * FROM discord_users
      JOIN campus_users ON discord_users.student_number = campus_users.student_number
      WHERE campus_users.campus_user_id = ${campus_user_id}
    `;

    if (!discordUserRecord) {
      console.log(
        "member:join",
        campus_user_id,
        club_id,
        "Campus user does not have a discord account."
      );
      return;
    }

    const guild = await client.guilds.fetch(config.guildId);
    if (!guild) {
      console.log("Guild not found");
      return;
    }

    const discordMember = await guild.members.fetch(
      discordUserRecord.discord_user_id
    );

    if (!discordMember) {
      console.log("Discord member not found");
      return;
    }

    console.log("Processing join for", campus_user_id, club_id);
    await processJoin(discordMember);
  });

  redisClient.subscribe("member:leave", async (message) => {
    const { campus_user_id, club_id } = JSON.parse(message);

    const [discordUserRecord] = await sql`
        SELECT * FROM discord_users
        JOIN campus_users ON discord_users.student_number = campus_users.student_number
        WHERE campus_users.campus_user_id = ${campus_user_id}
      `;

    if (!discordUserRecord) {
      console.log(
        "member:leave",
        club_id,
        "Campus user does not have a discord account."
      );
      return;
    }

    const guild = await client.guilds.fetch(config.guildId);
    if (!guild) {
      console.log("Guild not found");
      return;
    }

    const discordMember = await guild.members.fetch(
      discordUserRecord.discord_user_id
    );

    if (!discordMember) {
      console.log("Discord member not found");
      return;
    }

    await processLeave(discordMember);
  });
}
