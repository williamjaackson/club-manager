import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", (client: Client<true>) => {
  console.log(`Logged in as ${client.user.tag}`);
});

console.log("Starting bot...");
client.login(process.env.DISCORD_TOKEN);