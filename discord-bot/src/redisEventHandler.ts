import { redisClient } from "./lib/redis";
import { Client } from "discord.js";

export async function redisEventHandler(client: Client) {
  redisClient.subscribe("member:join", (message) => {
    const { campus_user_id, club_id } = JSON.parse(message);
    // const guild = client.guilds.cache.get(club_id);
    // if (!guild) return;
    // const member = guild.members.cache.get(campus_user_id);
    // if (!member) return;
    console.log(campus_user_id, club_id);
  });
}
