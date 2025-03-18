import { Client, GatewayIntentBits } from "discord.js";
import { redisClient } from "./lib/redis";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", (client: Client<true>) => {
  console.log(`Logged in as ${client.user.tag}`);
});

console.log("Starting bot...");

client.login(process.env.DISCORD_TOKEN).then(() => {
  redisClient
    .connect()
    .catch((err) => {
      console.error("Failed to connect to Redis:", err);
    })
    .then(() => {
      console.log("Connected to Redis");
    });
});
