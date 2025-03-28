import { Client, GatewayIntentBits } from "discord.js";
import { redisClient } from "./lib/redis";
import { redisEventHandler } from "./redisEventHandler";
import { connectEventHandler } from "./connectEventHandler";
import { deployCommands } from "./commands";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", async (client: Client<true>) => {
  console.log(`Logged in as ${client.user.tag}`);
  await redisEventHandler(client);
  await connectEventHandler(client);
});

console.log("Starting bot...");

deployCommands(client);

client.login(process.env.DISCORD_TOKEN);
redisClient
  .connect()
  .catch((err) => {
    console.error("Failed to connect to Redis:", err);
  })
  .then(async () => {
    console.log("Connected to Redis");
  });
